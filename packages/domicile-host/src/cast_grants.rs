//! ScreenCast restore tokens: which windows an application may cast again
//! without asking.
//!
//! The portal hands the application's frontend a token as `restore_data`.
//! A token names windows by their client's app id and title, since host ids
//! do not survive a restart. Tokens for `persist_mode` 2 are saved to a file
//! under `$XDG_STATE_HOME/domicile/`; tokens for mode 1 live as long as the
//! compositor. See `docs/architecture/PORTALS.md`.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// How long a grant lasts: the portal's `persist_mode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Persist {
    /// Not kept.
    No,
    /// Kept while the compositor runs.
    WhileRunning,
    /// Kept until revoked.
    Saved,
}

impl Persist {
    /// The mode an application asked for, or `None` for one the spec does
    /// not define.
    pub fn from_mode(mode: u32) -> Option<Persist> {
        match mode {
            0 => Some(Persist::No),
            1 => Some(Persist::WhileRunning),
            2 => Some(Persist::Saved),
            _ => None,
        }
    }

    /// The `persist_mode` this is.
    pub fn mode(self) -> u32 {
        match self {
            Persist::No => 0,
            Persist::WhileRunning => 1,
            Persist::Saved => 2,
        }
    }
}

/// A window a grant names.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Shared {
    /// The client's own app id (`xdg_toplevel.set_app_id`).
    pub app_id: String,
    pub title: String,
}

/// An open window a grant may match: its host id, then [`Shared`]'s fields.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Open {
    pub id: String,
    pub app_id: String,
    pub title: String,
}

/// The tokens handed out.
#[derive(Debug, Default)]
pub struct Grants {
    /// Where [`Persist::Saved`] tokens are written. `None` keeps them in
    /// memory.
    file: Option<PathBuf>,
    running: HashMap<String, Vec<Shared>>,
    saved: HashMap<String, Vec<Shared>>,
}

impl Grants {
    /// The grants saved in `file`, which may not exist yet.
    pub fn load(file: PathBuf) -> io::Result<Grants> {
        let saved = match fs::read(&file) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(why) if why.kind() == io::ErrorKind::NotFound => HashMap::new(),
            Err(why) => return Err(why),
        };
        Ok(Grants {
            file: Some(file),
            running: HashMap::new(),
            saved,
        })
    }

    /// The windows `token` names, if it is one of ours.
    pub fn recall(&self, token: &str) -> Option<&[Shared]> {
        self.running
            .get(token)
            .or_else(|| self.saved.get(token))
            .map(Vec::as_slice)
    }

    /// Grant `windows` for `persist`, replacing `restored`, the token the
    /// application came back with. Returns the token to hand out: `restored`
    /// again when there was one, else `fresh()`. `None` for [`Persist::No`].
    pub fn grant(
        &mut self,
        persist: Persist,
        restored: Option<&str>,
        windows: Vec<Shared>,
        fresh: impl FnOnce() -> String,
    ) -> io::Result<Option<String>> {
        let was_saved = restored.is_some_and(|token| self.saved.contains_key(token));
        if let Some(token) = restored {
            self.running.remove(token);
            self.saved.remove(token);
        }
        let token = match persist {
            Persist::No => None,
            Persist::WhileRunning | Persist::Saved => {
                Some(restored.map_or_else(fresh, str::to_string))
            }
        };
        match (persist, &token) {
            (Persist::WhileRunning, Some(token)) => {
                self.running.insert(token.clone(), windows);
            }
            (Persist::Saved, Some(token)) => {
                self.saved.insert(token.clone(), windows);
            }
            _ => {}
        }
        if was_saved || persist == Persist::Saved {
            self.save()?;
        }
        Ok(token)
    }

    /// Write the saved tokens, through a temporary file so a reader never
    /// sees half of one.
    fn save(&self) -> io::Result<()> {
        let Some(file) = &self.file else {
            return Ok(());
        };
        if let Some(directory) = file.parent() {
            fs::create_dir_all(directory)?;
        }
        let temporary = file.with_extension("tmp");
        fs::write(&temporary, serde_json::to_vec(&self.saved)?)?;
        fs::rename(&temporary, file)
    }
}

/// The host ids of the open windows `shared` names, in its order, or `None`
/// when any is not open.
///
/// A window matches on app id and title. Titles change (a browser's names its
/// page), so a window whose title moved on matches by app id alone, unless
/// another window of that app id still has the title. Each window matches
/// once.
pub fn matched(shared: &[Shared], open: &[Open]) -> Option<Vec<String>> {
    let mut taken: Vec<&str> = Vec::new();
    for wanted in shared {
        let free = |window: &&Open| window.app_id == wanted.app_id && !taken.contains(&&*window.id);
        let found = open
            .iter()
            .filter(free)
            .find(|window| window.title == wanted.title)
            .or_else(|| open.iter().find(free))?;
        taken.push(&found.id);
    }
    Some(taken.into_iter().map(str::to_string).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared(app_id: &str, title: &str) -> Shared {
        Shared {
            app_id: app_id.into(),
            title: title.into(),
        }
    }

    fn open(id: &str, app_id: &str, title: &str) -> Open {
        Open {
            id: id.into(),
            app_id: app_id.into(),
            title: title.into(),
        }
    }

    #[test]
    fn a_window_matches_on_app_id_and_title_first() {
        let open = [
            open("app-1", "org.gnome.TextEditor", "Todo"),
            open("app-2", "org.gnome.TextEditor", "Notes"),
        ];

        assert_eq!(
            matched(&[shared("org.gnome.TextEditor", "Notes")], &open),
            Some(vec!["app-2".to_string()])
        );
    }

    #[test]
    fn a_window_whose_title_moved_on_matches_by_app_id() {
        let open = [open("app-1", "firefox", "Another page")];

        assert_eq!(
            matched(&[shared("firefox", "A page")], &open),
            Some(vec!["app-1".to_string()])
        );
    }

    #[test]
    fn a_grant_naming_a_window_that_is_not_open_matches_nothing() {
        let open = [open("app-1", "firefox", "A page")];

        assert_eq!(
            matched(
                &[shared("firefox", "A page"), shared("firefox", "Two")],
                &open
            ),
            None,
            "one firefox window cannot be both"
        );
        assert_eq!(matched(&[shared("org.gnome.Terminal", "")], &open), None);
    }

    #[test]
    fn a_grant_for_mode_zero_hands_out_no_token() {
        let mut grants = Grants::default();

        assert_eq!(
            grants
                .grant(Persist::No, None, vec![shared("a", "b")], || "t".into())
                .expect("nothing to write"),
            None
        );
    }

    #[test]
    fn a_running_grant_is_recalled_but_never_written() {
        let directory = tempfile::tempdir().expect("a directory");
        let file = directory.path().join("domicile/screen-cast-grants.v1.json");
        let mut grants = Grants::load(file.clone()).expect("no file yet");

        let token = grants
            .grant(Persist::WhileRunning, None, vec![shared("a", "b")], || {
                "t1".into()
            })
            .expect("written");

        assert_eq!(token.as_deref(), Some("t1"));
        assert_eq!(grants.recall("t1"), Some(&[shared("a", "b")][..]));
        assert!(!file.exists());
        assert_eq!(Grants::load(file).expect("no file yet").recall("t1"), None);
    }

    #[test]
    fn a_saved_grant_outlives_the_compositor() {
        let directory = tempfile::tempdir().expect("a directory");
        let file = directory.path().join("domicile/screen-cast-grants.v1.json");
        let mut grants = Grants::load(file.clone()).expect("no file yet");
        grants
            .grant(Persist::Saved, None, vec![shared("a", "b")], || "t1".into())
            .expect("written");

        assert_eq!(
            Grants::load(file).expect("read").recall("t1"),
            Some(&[shared("a", "b")][..])
        );
    }

    #[test]
    fn a_restored_token_is_kept_with_the_windows_as_they_are_now() {
        let directory = tempfile::tempdir().expect("a directory");
        let file = directory.path().join("grants.json");
        let mut grants = Grants::load(file.clone()).expect("no file yet");
        grants
            .grant(Persist::Saved, None, vec![shared("a", "old")], || {
                "t1".into()
            })
            .expect("written");

        let again = grants
            .grant(Persist::Saved, Some("t1"), vec![shared("a", "new")], || {
                unreachable!("the restored token is reused")
            })
            .expect("written");

        assert_eq!(again.as_deref(), Some("t1"));
        assert_eq!(
            Grants::load(file.clone()).expect("read").recall("t1"),
            Some(&[shared("a", "new")][..])
        );

        grants
            .grant(Persist::No, Some("t1"), vec![shared("a", "new")], || {
                "t2".into()
            })
            .expect("written");
        assert_eq!(
            Grants::load(file).expect("read").recall("t1"),
            None,
            "revoked"
        );
    }

    #[test]
    fn only_the_spec_s_persist_modes_are_read() {
        assert_eq!(Persist::from_mode(2), Some(Persist::Saved));
        assert_eq!(Persist::from_mode(3), None);
        assert_eq!(Persist::Saved.mode(), 2);
    }
}
