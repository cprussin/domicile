//! The GlobalShortcuts portal's sessions, their bound chords, and the chords
//! the user chose per application.
//!
//! The compositor's `portals::global_shortcuts` takes the calls off D-Bus and
//! keeps this. The shell grabs each [`BoundShortcut`] and reports a press by
//! its id. Choices are saved per app id, so an application that binds the
//! same shortcuts again gets them without a dialog. See
//! `docs/architecture/PORTALS.md`.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};

use domicile_protocol::{
    BoundShortcut, ChosenTrigger, ProposedShortcut, ShortcutsDialog, TakenChord,
};

/// A shortcut an application asks for: its id, description and preferred
/// trigger.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asked {
    pub id: String,
    pub description: String,
    pub preferred: Option<String>,
}

/// A session's shortcut as `BindShortcuts` and `ListShortcuts` report it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Listed {
    pub id: String,
    pub description: String,
    /// `None` when the user cleared it.
    pub trigger: Option<String>,
}

/// A call named a session this backend never created, or one already closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("no GlobalShortcuts session is open under this handle")]
pub struct NoSession;

/// Every open session, and the choices saved for each application.
#[derive(Debug, Default)]
pub struct GlobalShortcuts {
    next_id: u32,
    sessions: BTreeMap<String, Session>,
    saved: Saved,
}

#[derive(Debug)]
struct Session {
    app_id: String,
    shortcuts: Vec<Bound>,
}

/// A session's shortcut, and its id among the [`BoundShortcut`]s when it has
/// a trigger.
#[derive(Debug)]
struct Bound {
    listed: Listed,
    id: Option<u32>,
}

impl GlobalShortcuts {
    /// Sessions start from `saved`.
    pub fn new(saved: Saved) -> Self {
        GlobalShortcuts {
            saved,
            ..GlobalShortcuts::default()
        }
    }

    /// `CreateSession`: a session for `app_id` with nothing bound.
    pub fn create(&mut self, session: String, app_id: String) {
        self.sessions.insert(
            session,
            Session {
                app_id,
                shortcuts: Vec::new(),
            },
        );
    }

    /// The session closed; its chords go with it.
    pub fn close(&mut self, session: &str) {
        self.sessions.remove(session);
    }

    /// Bind `asked` from the saved choices, when the user chose a trigger
    /// for every one of them before. `None` when the user must review them.
    pub fn restore(
        &mut self,
        session: &str,
        asked: &[Asked],
    ) -> Result<Option<Vec<Listed>>, NoSession> {
        let app_id = &self.session(session)?.app_id;
        let chosen = self.saved.0.get(app_id);
        let restored = asked
            .iter()
            .map(|ask| {
                chosen
                    .and_then(|chosen| chosen.get(&ask.id))
                    .map(|trigger| ChosenTrigger {
                        id: ask.id.clone(),
                        trigger: trigger.clone(),
                    })
            })
            .collect::<Option<Vec<_>>>();
        restored
            .map(|chose| self.bind(session, asked, &chose))
            .transpose()
    }

    /// The dialog that reviews `asked`. Each proposes the saved choice, else
    /// the application's preferred trigger.
    pub fn review(&self, session: &str, asked: &[Asked]) -> Result<ShortcutsDialog, NoSession> {
        let app_id = &self.session(session)?.app_id;
        let chosen = self.saved.0.get(app_id);
        let shortcuts = asked
            .iter()
            .map(|ask| ProposedShortcut {
                id: ask.id.clone(),
                description: ask.description.clone(),
                trigger: match chosen.and_then(|chosen| chosen.get(&ask.id)) {
                    Some(trigger) => trigger.clone(),
                    None => ask.preferred.clone(),
                },
            })
            .collect();
        let taken = self
            .saved
            .0
            .iter()
            .filter(|(other, _)| *other != app_id)
            .flat_map(|(other, chosen)| {
                chosen.values().flatten().map(|chord| TakenChord {
                    chord: chord.clone(),
                    app_id: other.clone(),
                })
            })
            .collect();
        Ok(ShortcutsDialog { shortcuts, taken })
    }

    /// The session's shortcuts as asks, for reviewing them again.
    pub fn current(&self, session: &str) -> Result<Vec<Asked>, NoSession> {
        Ok(self
            .session(session)?
            .shortcuts
            .iter()
            .map(|bound| Asked {
                id: bound.listed.id.clone(),
                description: bound.listed.description.clone(),
                preferred: bound.listed.trigger.clone(),
            })
            .collect())
    }

    /// Bind `asked` to the triggers the user `chose`, replacing what the
    /// session held, and save them for its application. A shortcut the
    /// answer leaves out is cleared.
    pub fn bind(
        &mut self,
        session: &str,
        asked: &[Asked],
        chose: &[ChosenTrigger],
    ) -> Result<Vec<Listed>, NoSession> {
        let next_id = &mut self.next_id;
        let held = self.sessions.get_mut(session).ok_or(NoSession)?;
        held.shortcuts = asked
            .iter()
            .map(|ask| {
                let trigger = chose
                    .iter()
                    .find(|chosen| chosen.id == ask.id)
                    .and_then(|chosen| chosen.trigger.clone());
                let id = trigger.is_some().then(|| {
                    *next_id += 1;
                    *next_id
                });
                Bound {
                    listed: Listed {
                        id: ask.id.clone(),
                        description: ask.description.clone(),
                        trigger,
                    },
                    id,
                }
            })
            .collect();
        let saving = self.saved.0.entry(held.app_id.clone()).or_default();
        for bound in &held.shortcuts {
            saving.insert(bound.listed.id.clone(), bound.listed.trigger.clone());
        }
        self.list(session)
    }

    /// `ListShortcuts`.
    pub fn list(&self, session: &str) -> Result<Vec<Listed>, NoSession> {
        Ok(self
            .session(session)?
            .shortcuts
            .iter()
            .map(|bound| bound.listed.clone())
            .collect())
    }

    /// Every chord held, for the shell to grab.
    pub fn bound(&self) -> Vec<BoundShortcut> {
        self.sessions
            .values()
            .flat_map(|held| {
                held.shortcuts.iter().filter_map(|bound| {
                    bound
                        .id
                        .zip(bound.listed.trigger.clone())
                        .map(|(id, chord)| BoundShortcut {
                            id,
                            app_id: held.app_id.clone(),
                            chord,
                        })
                })
            })
            .collect()
    }

    /// The session and shortcut id the [`BoundShortcut`] `id` fires.
    pub fn pressed(&self, id: u32) -> Option<(String, String)> {
        self.sessions.iter().find_map(|(session, held)| {
            held.shortcuts
                .iter()
                .find(|bound| bound.id == Some(id))
                .map(|bound| (session.clone(), bound.listed.id.clone()))
        })
    }

    /// The application `session` was created for.
    pub fn app_id(&self, session: &str) -> Result<&str, NoSession> {
        Ok(&self.session(session)?.app_id)
    }

    /// The choices to write back after a [`GlobalShortcuts::bind`].
    pub fn saved(&self) -> &Saved {
        &self.saved
    }

    fn session(&self, session: &str) -> Result<&Session, NoSession> {
        self.sessions.get(session).ok_or(NoSession)
    }
}

/// The triggers the user chose, by app id then shortcut id. `None` is a
/// trigger the user cleared.
#[derive(Debug, Default, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Saved(BTreeMap<String, BTreeMap<String, Option<String>>>);

impl Saved {
    /// Read `file`. A file that does not exist is no choices yet.
    pub fn load(file: &Path) -> io::Result<Saved> {
        match std::fs::read(file) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(io::Error::other),
            Err(why) if why.kind() == io::ErrorKind::NotFound => Ok(Saved::default()),
            Err(why) => Err(why),
        }
    }

    /// Write to `file` whole, through a temporary file beside it, creating
    /// its directory.
    pub fn store(&self, file: &Path) -> io::Result<()> {
        let directory = file
            .parent()
            .ok_or_else(|| io::Error::other("the choices' file has no directory"))?;
        std::fs::create_dir_all(directory)?;
        let partial = file.with_extension("json.partial");
        std::fs::write(
            &partial,
            serde_json::to_vec(self).map_err(io::Error::other)?,
        )?;
        std::fs::rename(partial, file)
    }
}

/// Where the choices are kept: `$XDG_STATE_HOME/domicile/global-shortcuts.json`,
/// else under `~/.local/state`. `None` when neither is set absolute.
pub fn saved_file(state_home: Option<&str>, home: Option<&str>) -> Option<PathBuf> {
    let absolute = |value: &str| {
        let path = PathBuf::from(value);
        path.is_absolute().then_some(path)
    };
    state_home
        .and_then(absolute)
        .or_else(|| {
            home.and_then(absolute)
                .map(|home| home.join(".local").join("state"))
        })
        .map(|state| state.join("domicile").join("global-shortcuts.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SESSION: &str = "/org/freedesktop/portal/desktop/session/1_7/s";
    const APP: &str = "org.example.App";

    fn asked(id: &str, preferred: Option<&str>) -> Asked {
        Asked {
            id: id.into(),
            description: format!("{id} described"),
            preferred: preferred.map(Into::into),
        }
    }

    fn chose(id: &str, trigger: Option<&str>) -> ChosenTrigger {
        ChosenTrigger {
            id: id.into(),
            trigger: trigger.map(Into::into),
        }
    }

    fn listed(id: &str, trigger: Option<&str>) -> Listed {
        Listed {
            id: id.into(),
            description: format!("{id} described"),
            trigger: trigger.map(Into::into),
        }
    }

    fn open() -> GlobalShortcuts {
        let mut shortcuts = GlobalShortcuts::default();
        shortcuts.create(SESSION.into(), APP.into());
        shortcuts
    }

    #[test]
    fn a_review_proposes_what_the_application_prefers_and_flags_other_apps_chords() {
        let mut shortcuts = open();
        shortcuts.create("other".into(), "org.example.Other".into());
        shortcuts
            .bind(
                "other",
                &[asked("mute", None)],
                &[chose("mute", Some("Ctrl+Alt+m"))],
            )
            .expect("open");

        assert_eq!(
            shortcuts.review(
                SESSION,
                &[asked("talk", Some("CTRL+ALT+t")), asked("mute", None)]
            ),
            Ok(ShortcutsDialog {
                shortcuts: vec![
                    ProposedShortcut {
                        id: "talk".into(),
                        description: "talk described".into(),
                        trigger: Some("CTRL+ALT+t".into()),
                    },
                    ProposedShortcut {
                        id: "mute".into(),
                        description: "mute described".into(),
                        trigger: None,
                    },
                ],
                taken: vec![TakenChord {
                    chord: "Ctrl+Alt+m".into(),
                    app_id: "org.example.Other".into(),
                }],
            })
        );
    }

    #[test]
    fn a_chosen_trigger_is_bound_and_a_cleared_one_is_listed_without_one() {
        let mut shortcuts = open();
        let asks = [asked("talk", None), asked("mute", None)];

        assert_eq!(
            shortcuts.bind(
                SESSION,
                &asks,
                &[chose("talk", Some("Ctrl+Alt+t")), chose("mute", None)]
            ),
            Ok(vec![
                listed("talk", Some("Ctrl+Alt+t")),
                listed("mute", None)
            ])
        );
        assert_eq!(
            shortcuts.bound(),
            [BoundShortcut {
                id: 1,
                app_id: APP.into(),
                chord: "Ctrl+Alt+t".into(),
            }]
        );
        assert_eq!(shortcuts.pressed(1), Some((SESSION.into(), "talk".into())));
        assert_eq!(
            shortcuts.list(SESSION),
            Ok(vec![
                listed("talk", Some("Ctrl+Alt+t")),
                listed("mute", None)
            ])
        );
    }

    #[test]
    fn an_application_binding_what_it_bound_before_needs_no_review() {
        let mut first = open();
        first
            .bind(
                SESSION,
                &[asked("talk", None)],
                &[chose("talk", Some("Ctrl+Alt+t"))],
            )
            .expect("open");
        let mut later = GlobalShortcuts::new(first.saved().clone());
        later.create("later".into(), APP.into());

        assert_eq!(
            later.restore("later", &[asked("talk", Some("Ctrl+t"))]),
            Ok(Some(vec![listed("talk", Some("Ctrl+Alt+t"))]))
        );
        assert_eq!(later.bound().len(), 1);
    }

    #[test]
    fn a_new_shortcut_is_reviewed_with_the_saved_ones_proposed_as_chosen() {
        let mut shortcuts = open();
        shortcuts
            .bind(
                SESSION,
                &[asked("talk", None)],
                &[chose("talk", Some("Ctrl+Alt+t"))],
            )
            .expect("open");
        let asks = [asked("talk", Some("Ctrl+t")), asked("mute", None)];

        assert_eq!(shortcuts.restore(SESSION, &asks), Ok(None));
        let review = shortcuts.review(SESSION, &asks).expect("open");
        assert_eq!(review.shortcuts[0].trigger.as_deref(), Some("Ctrl+Alt+t"));
        assert_eq!(review.taken, [], "its own chords are no conflict");
    }

    #[test]
    fn a_closed_session_lets_go_of_its_chords() {
        let mut shortcuts = open();
        shortcuts
            .bind(
                SESSION,
                &[asked("talk", None)],
                &[chose("talk", Some("Ctrl+Alt+t"))],
            )
            .expect("open");

        shortcuts.close(SESSION);

        assert_eq!(shortcuts.bound(), []);
        assert_eq!(shortcuts.pressed(1), None);
        assert_eq!(shortcuts.list(SESSION), Err(NoSession));
    }

    #[test]
    fn a_rebound_session_holds_only_its_new_chords_under_new_ids() {
        let mut shortcuts = open();
        let asks = [asked("talk", None)];
        shortcuts
            .bind(SESSION, &asks, &[chose("talk", Some("Ctrl+Alt+t"))])
            .expect("open");
        shortcuts
            .bind(SESSION, &asks, &[chose("talk", Some("Ctrl+Alt+y"))])
            .expect("open");

        assert_eq!(
            shortcuts.bound(),
            [BoundShortcut {
                id: 2,
                app_id: APP.into(),
                chord: "Ctrl+Alt+y".into(),
            }]
        );
        assert_eq!(
            shortcuts.current(SESSION),
            Ok(vec![asked("talk", Some("Ctrl+Alt+y"))])
        );
    }

    #[test]
    fn a_session_never_created_is_refused() {
        let mut shortcuts = GlobalShortcuts::default();

        assert_eq!(shortcuts.restore(SESSION, &[]), Err(NoSession));
        assert_eq!(shortcuts.review(SESSION, &[]), Err(NoSession));
        assert_eq!(shortcuts.bind(SESSION, &[], &[]), Err(NoSession));
    }

    #[test]
    fn choices_survive_a_round_trip_through_their_file() {
        let dir = tempfile::tempdir().expect("a directory");
        let file = dir.path().join("domicile").join("global-shortcuts.json");
        let mut shortcuts = open();
        shortcuts
            .bind(
                SESSION,
                &[asked("talk", None)],
                &[chose("talk", Some("Ctrl+Alt+t"))],
            )
            .expect("open");

        assert_eq!(
            Saved::load(&file).expect("absent is empty"),
            Saved::default()
        );
        shortcuts.saved().store(&file).expect("written");
        assert_eq!(Saved::load(&file).expect("read"), *shortcuts.saved());
    }

    #[test]
    fn the_file_is_under_the_state_home() {
        assert_eq!(
            saved_file(Some("/state"), Some("/home/u")),
            Some(PathBuf::from("/state/domicile/global-shortcuts.json"))
        );
        assert_eq!(
            saved_file(Some("relative"), Some("/home/u")),
            Some(PathBuf::from(
                "/home/u/.local/state/domicile/global-shortcuts.json"
            ))
        );
        assert_eq!(saved_file(None, None), None);
    }
}
