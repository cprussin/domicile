//! ScreenCast restore tokens: which sources an application may cast again
//! without asking.
//!
//! The portal hands the application's frontend a token as `restore_data`.
//! A token names windows by their client's app id and title, since host ids
//! do not survive a restart; monitors by `wl_output` name; and regions by a
//! rectangle on the monitor they are mostly on. Tokens for `persist_mode` 2 are saved to a file
//! under `$XDG_STATE_HOME/domicile/`; tokens for mode 1 live as long as the
//! compositor. See `packages/domicile-compositor/src/portals/README.md`.

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

/// A source a grant names.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Shared {
    Window {
        /// The client's own app id (`xdg_toplevel.set_app_id`).
        app_id: String,
        title: String,
    },
    Monitor {
        /// Its `wl_output` name.
        name: String,
    },
    /// A rectangle in logical pixels, kept relative to a monitor so it
    /// follows that monitor when the desktop is rearranged.
    Region {
        monitor: String,
        /// From the monitor's top-left corner.
        offset: (i32, i32),
        size: (i32, i32),
    },
}

/// A monitor on the desktop, in logical pixels.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Placed {
    pub name: String,
    pub position: (i32, i32),
    pub size: (i32, i32),
}

/// A source a grant may match.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Open {
    /// A window: its host id, then [`Shared::Window`]'s fields.
    Window {
        id: String,
        app_id: String,
        title: String,
    },
    Monitor(Placed),
}

/// A source a grant matched.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Restored {
    /// A window, by host id.
    Window(String),
    /// A monitor, by `wl_output` name.
    Monitor(String),
    /// A rectangle of the desktop, in logical pixels.
    Region {
        position: (i32, i32),
        size: (i32, i32),
    },
}

impl Shared {
    /// The region at `position` and `size`, kept on the monitor of
    /// `monitors` it overlaps most. `None` when it overlaps none.
    pub fn region(position: (i32, i32), size: (i32, i32), monitors: &[Placed]) -> Option<Shared> {
        let overlap = |monitor: &Placed| {
            let width = (position.0 + size.0).min(monitor.position.0 + monitor.size.0)
                - position.0.max(monitor.position.0);
            let height = (position.1 + size.1).min(monitor.position.1 + monitor.size.1)
                - position.1.max(monitor.position.1);
            i64::from(width.max(0)) * i64::from(height.max(0))
        };
        let monitor = monitors
            .iter()
            .filter(|monitor| overlap(monitor) > 0)
            .max_by_key(|monitor| overlap(monitor))?;
        Some(Shared::Region {
            monitor: monitor.name.clone(),
            offset: (
                position.0 - monitor.position.0,
                position.1 - monitor.position.1,
            ),
            size,
        })
    }
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

    /// The sources `token` names, if it is one of ours.
    pub fn recall(&self, token: &str) -> Option<&[Shared]> {
        self.running
            .get(token)
            .or_else(|| self.saved.get(token))
            .map(Vec::as_slice)
    }

    /// Grant `sources` for `persist`, replacing `restored`, the token the
    /// application came back with. Returns the token to hand out: `restored`
    /// again when there was one, else `fresh()`. `None` for [`Persist::No`].
    pub fn grant(
        &mut self,
        persist: Persist,
        restored: Option<&str>,
        sources: Vec<Shared>,
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
                self.running.insert(token.clone(), sources);
            }
            (Persist::Saved, Some(token)) => {
                self.saved.insert(token.clone(), sources);
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

/// The open sources `shared` names, in its order, or `None` when any is
/// not open.
///
/// A window matches on app id and title. Titles change (a browser's names its
/// page), so a window whose title moved on matches by app id alone, unless
/// another window of that app id still has the title. Each window matches
/// once. A monitor matches by name, and a region by its monitor.
pub fn matched(shared: &[Shared], open: &[Open]) -> Option<Vec<Restored>> {
    let mut taken: Vec<&str> = Vec::new();
    let mut restored = Vec::new();
    for wanted in shared {
        match wanted {
            Shared::Window { app_id, title } => {
                let free: Vec<(&String, &String)> = open
                    .iter()
                    .filter_map(|source| match source {
                        Open::Window {
                            id,
                            app_id: open_app_id,
                            title,
                        } if open_app_id == app_id && !taken.contains(&id.as_str()) => {
                            Some((id, title))
                        }
                        _ => None,
                    })
                    .collect();
                let (id, _) = free
                    .iter()
                    .find(|(_, open_title)| *open_title == title)
                    .or_else(|| free.first())?;
                taken.push(id);
                restored.push(Restored::Window(id.to_string()));
            }
            Shared::Monitor { name } => {
                monitor(open, name)?;
                restored.push(Restored::Monitor(name.clone()));
            }
            Shared::Region {
                monitor: name,
                offset,
                size,
            } => {
                let placed = monitor(open, name)?;
                restored.push(Restored::Region {
                    position: (placed.position.0 + offset.0, placed.position.1 + offset.1),
                    size: *size,
                });
            }
        }
    }
    Some(restored)
}

/// The plugged-in monitor named `name`.
fn monitor<'a>(open: &'a [Open], name: &str) -> Option<&'a Placed> {
    open.iter().find_map(|source| match source {
        Open::Monitor(placed) if placed.name == name => Some(placed),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared(app_id: &str, title: &str) -> Shared {
        Shared::Window {
            app_id: app_id.into(),
            title: title.into(),
        }
    }

    fn open(id: &str, app_id: &str, title: &str) -> Open {
        Open::Window {
            id: id.into(),
            app_id: app_id.into(),
            title: title.into(),
        }
    }

    fn window(id: &str) -> Restored {
        Restored::Window(id.into())
    }

    /// A 1920x1080 monitor, and a 1280x800 one to its right.
    fn monitors() -> Vec<Placed> {
        vec![
            Placed {
                name: "drm-1".into(),
                position: (0, 0),
                size: (1920, 1080),
            },
            Placed {
                name: "drm-2".into(),
                position: (1920, 0),
                size: (1280, 800),
            },
        ]
    }

    fn plugged(monitors: Vec<Placed>) -> Vec<Open> {
        monitors.into_iter().map(Open::Monitor).collect()
    }

    #[test]
    fn a_window_matches_on_app_id_and_title_first() {
        let open = [
            open("app-1", "org.gnome.TextEditor", "Todo"),
            open("app-2", "org.gnome.TextEditor", "Notes"),
        ];

        assert_eq!(
            matched(&[shared("org.gnome.TextEditor", "Notes")], &open),
            Some(vec![window("app-2")])
        );
    }

    #[test]
    fn a_window_whose_title_moved_on_matches_by_app_id() {
        let open = [open("app-1", "firefox", "Another page")];

        assert_eq!(
            matched(&[shared("firefox", "A page")], &open),
            Some(vec![window("app-1")])
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
    fn a_monitor_matches_by_name() {
        assert_eq!(
            matched(
                &[Shared::Monitor {
                    name: "drm-2".into()
                }],
                &plugged(monitors())
            ),
            Some(vec![Restored::Monitor("drm-2".into())])
        );
        assert_eq!(
            matched(
                &[Shared::Monitor {
                    name: "drm-3".into()
                }],
                &plugged(monitors())
            ),
            None,
            "unplugged"
        );
    }

    #[test]
    fn a_region_is_kept_on_the_monitor_it_is_mostly_on_and_follows_it() {
        let region = Shared::region((1800, 100), (300, 200), &monitors());
        assert_eq!(
            region,
            Some(Shared::Region {
                monitor: "drm-2".into(),
                offset: (-120, 100),
                size: (300, 200),
            })
        );
        let moved = vec![
            Placed {
                name: "drm-2".into(),
                position: (0, 0),
                size: (1280, 800),
            },
            Placed {
                name: "drm-1".into(),
                position: (1280, 0),
                size: (1920, 1080),
            },
        ];

        assert_eq!(
            matched(&[region.expect("on a monitor")], &plugged(moved)),
            Some(vec![Restored::Region {
                position: (-120, 100),
                size: (300, 200),
            }])
        );
    }

    #[test]
    fn a_region_on_no_monitor_cannot_be_kept() {
        assert_eq!(Shared::region((0, 2000), (10, 10), &monitors()), None);
        assert_eq!(
            matched(
                &[Shared::Region {
                    monitor: "drm-3".into(),
                    offset: (0, 0),
                    size: (10, 10),
                }],
                &plugged(monitors())
            ),
            None
        );
    }

    #[test]
    fn a_saved_grant_of_each_kind_round_trips() {
        let directory = tempfile::tempdir().expect("a directory");
        let file = directory.path().join("grants.json");
        let kept = vec![
            shared("a", "b"),
            Shared::Monitor {
                name: "drm-1".into(),
            },
            Shared::Region {
                monitor: "drm-2".into(),
                offset: (5, 6),
                size: (7, 8),
            },
        ];
        Grants::load(file.clone())
            .expect("no file yet")
            .grant(Persist::Saved, None, kept.clone(), || "t1".into())
            .expect("written");

        assert_eq!(
            Grants::load(file).expect("read").recall("t1"),
            Some(&kept[..])
        );
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
        let file = directory.path().join("domicile/screen-cast-grants.v2.json");
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
        let file = directory.path().join("domicile/screen-cast-grants.v2.json");
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
