//! A screen recording's file and timer. The compositor runs the recording
//! itself (`domicile-recorder`); see `docs/PORTALS.md`.

use std::path::{Path, PathBuf};

use crate::screenshot::Taken;
use crate::user_dirs::user_dir;

/// `Screen recordings` in the videos folder `user_dirs` (the contents of
/// `user-dirs.dirs`) names, else in `~/Videos`.
pub fn recordings_dir(user_dirs: Option<&str>, home: &Path) -> PathBuf {
    user_dir(user_dirs, "XDG_VIDEOS_DIR", home, "Videos").join("Screen recordings")
}

/// A recording's file name, without its extension.
pub fn file_name(started: Taken) -> String {
    format!(
        "Screen recording from {:04}-{:02}-{:02} {:02}-{:02}-{:02}",
        started.year, started.month, started.day, started.hour, started.minute, started.second
    )
}

/// How long a recording has recorded, as a [`CapturingKind::Recording`]
/// lists it.
///
/// [`CapturingKind::Recording`]: domicile_protocol::CapturingKind::Recording
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Timer {
    /// Recorded until `running_since_ms`, or until the pause.
    pub recorded_ms: u64,
    /// When it last started or resumed, in Unix milliseconds. `None` while
    /// paused.
    pub running_since_ms: Option<u64>,
}

impl Timer {
    /// A timer that started at `now_ms`.
    pub fn started(now_ms: u64) -> Timer {
        Timer {
            recorded_ms: 0,
            running_since_ms: Some(now_ms),
        }
    }

    /// The timer paused at `now_ms`. A paused timer stays as it is.
    pub fn paused(self, now_ms: u64) -> Timer {
        match self.running_since_ms {
            Some(since) => Timer {
                recorded_ms: self.recorded_ms + now_ms.saturating_sub(since),
                running_since_ms: None,
            },
            None => self,
        }
    }

    /// The timer resumed at `now_ms`. A running timer stays as it is.
    pub fn resumed(self, now_ms: u64) -> Timer {
        match self.running_since_ms {
            Some(_) => self,
            None => Timer {
                recorded_ms: self.recorded_ms,
                running_since_ms: Some(now_ms),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recordings_go_in_the_videos_folder_user_dirs_names() {
        let home = Path::new("/home/me");
        assert_eq!(
            recordings_dir(Some("XDG_VIDEOS_DIR=\"$HOME/Films\""), home),
            Path::new("/home/me/Films/Screen recordings")
        );
        assert_eq!(
            recordings_dir(None, home),
            Path::new("/home/me/Videos/Screen recordings")
        );
    }

    #[test]
    fn a_recording_is_named_for_when_it_started() {
        assert_eq!(
            file_name(Taken {
                year: 2026,
                month: 10,
                day: 5,
                hour: 9,
                minute: 3,
                second: 7,
            }),
            "Screen recording from 2026-10-05 09-03-07"
        );
    }

    #[test]
    fn a_pause_keeps_what_was_recorded_and_a_resume_runs_on_from_it() {
        let timer = Timer::started(1_000);
        assert_eq!(
            timer,
            Timer {
                recorded_ms: 0,
                running_since_ms: Some(1_000)
            }
        );

        let paused = timer.paused(3_500);
        assert_eq!(
            paused,
            Timer {
                recorded_ms: 2_500,
                running_since_ms: None
            }
        );
        assert_eq!(paused.paused(9_000), paused);

        let resumed = paused.resumed(10_000);
        assert_eq!(
            resumed,
            Timer {
                recorded_ms: 2_500,
                running_since_ms: Some(10_000)
            }
        );
        assert_eq!(resumed.resumed(12_000), resumed);
    }
}
