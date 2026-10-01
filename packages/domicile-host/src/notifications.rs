//! The desk's notifications, as `org.freedesktop.Notifications` is told them
//! and as a shell is told them back.
//!
//! The D-Bus half — owning the name, answering `Notify`, saying
//! `NotificationClosed` and `ActionInvoked` — is `crate::notifications` in
//! `domicile-compositor`, because a bus is not something this crate can have.
//! What it hears is handed here as a [`Notify`], and what comes back is the
//! [`Notification`] a shell draws and what the application has to be told.
//!
//! **A history, not a screen.** A server normally takes a notification down
//! when it expires and says so. Here a notification stays until the user clears
//! it or its application closes it, because the shell keeps a drawer of the
//! recent ones: how long one stays *up* is the shell's, and expiring is not
//! closing.
//!
//! **A picture a page can draw without reading a file**, as the tray's: the
//! spec's image hints, the file a path names, or an icon by name, all become a
//! `data:` URL here.

use std::fs;
use std::path::Path;

use domicile_protocol::{Notification, NotificationAction, Urgency};

use crate::data_url::data_url;
use crate::png::png;
use crate::tray::TrayIcons;

/// How many are kept. The oldest goes when one more arrives: the drawer is of
/// the *recent* ones, and every change sends the whole list to every page.
pub const HISTORY: usize = 100;

/// The action key the spec reserves for a press on the notification itself.
pub const DEFAULT_ACTION: &str = "default";

/// The key the browser gives the button it adds to every Web Notification,
/// which opens its own settings page — a window a desk has no place for. Left
/// out of one the browser sent for a page, and only that: another program may
/// call a button what it likes.
const BROWSER_SETTINGS_ACTION: &str = "settings";

/// The longest side of a picture sent. A notification's image is drawn at a
/// few dozen pixels, and one arriving as raw pixels is encoded with no
/// compression at all — see [`crate::png`] — so a photograph is shrunk first.
const LARGEST_SIDE: i32 = 128;

/// The biggest file read for a picture, for [`LARGEST_SIDE`]'s reason: every
/// change sends every notification's picture to every page.
const LARGEST_FILE: u64 = 256 * 1024;

/// A `Notify` call, as the compositor heard it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Notify {
    pub app_name: String,
    /// The id of a notification this one takes the place of, or `0`.
    pub replaces_id: u32,
    /// A file, a `file://` URI or an icon's name; or empty.
    pub app_icon: String,
    pub summary: String,
    pub body: String,
    /// Keys and labels, alternating, as the spec sends them.
    pub actions: Vec<String>,
    pub hints: Hints,
    /// Milliseconds: `-1` for the server's choice, `0` for never.
    pub expire_timeout: i32,
}

/// The hints a shell has a use for. Every other one is dropped by the
/// compositor as it reads them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Hints {
    /// `0`, `1` or `2`: low, normal, critical.
    pub urgency: Option<u8>,
    /// `image-data`, or one of its two older spellings.
    pub image_data: Option<Image>,
    /// `image-path`: a file, a `file://` URI or an icon's name.
    pub image_path: Option<String>,
    /// `resident`: kept after one of its actions is taken.
    pub resident: bool,
    /// `x-kde-origin-name`: where a notification came from, past the program
    /// that sent it — the site, for a page's Web Notification, which the
    /// browser sends instead of writing it into the body.
    pub origin_name: Option<String>,
}

/// Raw pixels, as the `image-data` hint sends them: rows of RGB or RGBA bytes,
/// each row `rowstride` long.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image {
    pub width: i32,
    pub height: i32,
    pub rowstride: i32,
    pub has_alpha: bool,
    pub bits_per_sample: i32,
    pub channels: i32,
    pub data: Vec<u8>,
}

/// What [`Notifications::notify`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Notified {
    /// The id to answer `Notify` with.
    pub id: u32,
    /// One let go of to make room, which its application is told has
    /// expired.
    pub evicted: Option<u32>,
}

/// Every notification not yet cleared, oldest first.
pub struct Notifications {
    entries: Vec<Entry>,
    /// The id the next new notification is given. Never `0`, which the spec
    /// keeps for "replaces nothing".
    next: u32,
    icons: TrayIcons,
}

struct Entry {
    shown: Notification,
    resident: bool,
}

impl Notifications {
    /// No notifications yet, their icons looked for in `icons`.
    pub fn new(icons: TrayIcons) -> Self {
        Notifications {
            entries: Vec::new(),
            next: 1,
            icons,
        }
    }

    /// Take up `notify`, arrived at `now` (milliseconds since the epoch).
    ///
    /// One that replaces a notification still held keeps its id and moves to
    /// the newest end, because it is news again. One that replaces nothing
    /// held — cleared, or never sent — is a new one, as the spec says.
    pub fn notify(&mut self, notify: Notify, now: u64) -> Notified {
        let replaced = (notify.replaces_id != 0)
            .then(|| {
                self.entries
                    .iter()
                    .position(|entry| entry.shown.id == notify.replaces_id)
            })
            .flatten()
            .map(|at| self.entries.remove(at).shown.id);
        let id = replaced.unwrap_or_else(|| self.fresh_id());
        let entry = Entry {
            resident: notify.hints.resident,
            shown: self.shown(id, notify, now),
        };
        self.entries.push(entry);
        let evicted = (self.entries.len() > HISTORY).then(|| self.entries.remove(0).shown.id);
        Notified { id, evicted }
    }

    /// The application closed `id`. Whether it was held.
    pub fn close(&mut self, id: u32) -> bool {
        !self.dismiss(&[id]).is_empty()
    }

    /// The user cleared `ids`. The ones that were held, in the order asked.
    pub fn dismiss(&mut self, ids: &[u32]) -> Vec<u32> {
        let held: Vec<u32> = ids
            .iter()
            .copied()
            .filter(|id| self.entries.iter().any(|entry| entry.shown.id == *id))
            .collect();
        self.entries.retain(|entry| !held.contains(&entry.shown.id));
        held
    }

    /// The user pressed `action` on `id`: `Some(closed)` where it offered
    /// that action, `closed` being whether it is let go of as a result — every
    /// one is, but a `resident` one.
    pub fn invoke(&mut self, id: u32, action: &str) -> Option<bool> {
        let entry = self.entries.iter().find(|entry| entry.shown.id == id)?;
        let offered = if action == DEFAULT_ACTION {
            entry.shown.clickable
        } else {
            entry
                .shown
                .actions
                .iter()
                .any(|offered| offered.key == action)
        };
        let closed = !entry.resident;
        offered.then(|| {
            if closed {
                self.dismiss(&[id]);
            }
            closed
        })
    }

    /// What a shell is told.
    pub fn items(&self) -> Vec<Notification> {
        self.entries
            .iter()
            .map(|entry| entry.shown.clone())
            .collect()
    }

    /// An id no notification held has, wrapping past `u32::MAX` to `1`.
    fn fresh_id(&mut self) -> u32 {
        let id = self.next;
        self.next = self.next.checked_add(1).unwrap_or(1);
        id
    }

    /// What `notify` is shown as, called `id`.
    fn shown(&mut self, id: u32, notify: Notify, now: u64) -> Notification {
        let from_a_page = notify.hints.origin_name.is_some();
        let pairs: Vec<NotificationAction> = notify
            .actions
            .chunks_exact(2)
            .map(|pair| NotificationAction {
                key: pair[0].clone(),
                label: pair[1].clone(),
            })
            .filter(|action| !(from_a_page && action.key == BROWSER_SETTINGS_ACTION))
            .collect();
        let (default, actions): (Vec<_>, Vec<_>) = pairs
            .into_iter()
            .partition(|action| action.key == DEFAULT_ACTION);
        Notification {
            id,
            icon: self.picture(&notify),
            // A page's notification is from the site, not from the browser
            // that showed it.
            app_name: notify.hints.origin_name.unwrap_or(notify.app_name),
            summary: notify.summary,
            body: notify.body,
            urgency: match notify.hints.urgency {
                Some(0) => Urgency::Low,
                Some(2) => Urgency::Critical,
                _ => Urgency::Normal,
            },
            actions,
            clickable: !default.is_empty(),
            timeout_ms: u32::try_from(notify.expire_timeout).ok(),
            time: now,
        }
    }

    /// The picture `notify` is drawn with, in the spec's order: its pixels,
    /// its `image-path`, then its application's icon. One that cannot be
    /// drawn is passed over for the next.
    fn picture(&mut self, notify: &Notify) -> Option<String> {
        notify
            .hints
            .image_data
            .as_ref()
            .and_then(pixels)
            .or_else(|| {
                notify
                    .hints
                    .image_path
                    .as_deref()
                    .and_then(|named| self.named(named))
            })
            .or_else(|| self.named(&notify.app_icon))
    }

    /// A picture named by a path, a `file://` URI or an icon's name.
    fn named(&mut self, named: &str) -> Option<String> {
        let path = named.strip_prefix("file://").unwrap_or(named);
        if Path::new(path).is_absolute() {
            file(Path::new(path))
        } else {
            self.icons.icon(named, "")
        }
    }
}

/// `image` as a PNG `data:` URL, shrunk to [`LARGEST_SIDE`] — or `None` for
/// pixels that are not eight-bit RGB or RGBA, or that do not add up to their
/// size.
fn pixels(image: &Image) -> Option<String> {
    let channels = usize::try_from(image.channels).ok()?;
    let (width, height, rowstride) = (
        usize::try_from(image.width).ok()?,
        usize::try_from(image.height).ok()?,
        usize::try_from(image.rowstride).ok()?,
    );
    let whole = image.bits_per_sample == 8
        && (channels == 3 || channels == 4)
        && width > 0
        && height > 0
        && rowstride >= width * channels
        && image.data.len() >= rowstride * (height - 1) + width * channels;
    whole.then(|| {
        let side = width.max(height);
        let largest = LARGEST_SIDE as usize;
        let (to_width, to_height) = if side > largest {
            (
                (width * largest / side).max(1),
                (height * largest / side).max(1),
            )
        } else {
            (width, height)
        };
        // Nearest neighbor: a picture drawn a few dozen pixels across has no
        // use for a better filter, and this crate has none.
        let argb: Vec<u8> = (0..to_height)
            .flat_map(|row| {
                let from_row = row * height / to_height;
                (0..to_width).flat_map(move |column| {
                    let at = from_row * rowstride + column * width / to_width * channels;
                    let pixel = &image.data[at..at + channels];
                    let alpha = if channels == 4 { pixel[3] } else { 0xff };
                    [alpha, pixel[0], pixel[1], pixel[2]]
                })
            })
            .collect();
        data_url("image/png", &png(to_width as u32, to_height as u32, &argb))
    })
}

/// The file at `path` as a `data:` URL, typed by what is in it — the browser
/// writes a page's icon to a temporary file with no extension. `None` for a
/// file that is not there, is too big to send, or is not a picture.
fn file(path: &Path) -> Option<String> {
    if fs::metadata(path).ok()?.len() > LARGEST_FILE {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    sniffed(&bytes).map(|mime| data_url(mime, &bytes))
}

/// The type of picture `bytes` are, by their first few.
fn sniffed(bytes: &[u8]) -> Option<&'static str> {
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(256)]);
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if text.trim_start().starts_with("<svg") || text.trim_start().starts_with("<?xml") {
        Some("image/svg+xml")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::PathBuf;

    /// A data directory holding `files`, each a relative path and its bytes.
    fn data_dir(files: &[(&str, &[u8])]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("a directory to write in");
        for (path, bytes) in files {
            let at = dir.path().join(path);
            fs::create_dir_all(at.parent().expect("a parent")).unwrap();
            fs::write(at, bytes).unwrap();
        }
        dir
    }

    fn held(dirs: Vec<PathBuf>) -> Notifications {
        Notifications::new(TrayIcons::new(dirs))
    }

    fn notify(summary: &str) -> Notify {
        Notify {
            app_name: "Firefox".into(),
            summary: summary.into(),
            expire_timeout: -1,
            ..Notify::default()
        }
    }

    fn summaries(notifications: &Notifications) -> Vec<String> {
        notifications
            .items()
            .into_iter()
            .map(|notification| notification.summary)
            .collect()
    }

    /// `width` by `height` opaque red, as `image-data` sends it.
    fn red(width: i32, height: i32, channels: i32) -> Image {
        let pixel: &[u8] = if channels == 4 {
            &[0xff, 0, 0, 0xff]
        } else {
            &[0xff, 0, 0]
        };
        Image {
            width,
            height,
            rowstride: width * channels,
            has_alpha: channels == 4,
            bits_per_sample: 8,
            channels,
            data: pixel.repeat((width * height) as usize),
        }
    }

    /// `width` by `height` opaque red, as the shell is sent it.
    fn red_png(width: u32, height: u32) -> String {
        data_url(
            "image/png",
            &png(
                width,
                height,
                &[0xff, 0xff, 0, 0].repeat((width * height) as usize),
            ),
        )
    }

    const PNG_BYTES: &[u8] = b"\x89PNG\r\n\x1a\n not really the rest of one";

    mod arriving {
        use super::*;

        #[test]
        fn each_is_a_new_id_and_they_are_listed_oldest_first() {
            let mut notifications = held(Vec::new());

            let first = notifications.notify(notify("one"), 10);
            let second = notifications.notify(notify("two"), 20);

            assert_eq!(
                first,
                Notified {
                    id: 1,
                    evicted: None
                }
            );
            assert_eq!(
                second,
                Notified {
                    id: 2,
                    evicted: None
                }
            );
            assert_eq!(summaries(&notifications), ["one", "two"]);
            assert_eq!(
                notifications.items()[1],
                Notification {
                    id: 2,
                    app_name: "Firefox".into(),
                    summary: "two".into(),
                    body: String::new(),
                    icon: None,
                    urgency: Urgency::Normal,
                    actions: Vec::new(),
                    clickable: false,
                    timeout_ms: None,
                    time: 20,
                }
            );
        }

        #[test]
        fn a_replacement_keeps_its_id_and_is_news_again() {
            // A download's progress, or a chat's unread count: one
            // notification said over, rather than one more each time.
            let mut notifications = held(Vec::new());
            notifications.notify(notify("Downloading"), 10);
            notifications.notify(notify("Other"), 20);

            let replaced = notifications.notify(
                Notify {
                    replaces_id: 1,
                    ..notify("Downloaded")
                },
                30,
            );

            assert_eq!(
                replaced,
                Notified {
                    id: 1,
                    evicted: None
                }
            );
            assert_eq!(summaries(&notifications), ["Other", "Downloaded"]);
            assert_eq!(notifications.items()[1].time, 30);
        }

        #[test]
        fn replacing_one_that_is_gone_is_a_new_one() {
            let mut notifications = held(Vec::new());
            notifications.notify(notify("one"), 10);
            notifications.close(1);

            let again = notifications.notify(
                Notify {
                    replaces_id: 1,
                    ..notify("one again")
                },
                20,
            );

            assert_eq!(again.id, 2);
        }

        #[test]
        fn the_oldest_goes_to_make_room() {
            let mut notifications = held(Vec::new());
            for at in 0..HISTORY {
                notifications.notify(notify(&format!("{at}")), at as u64);
            }

            let last = notifications.notify(notify("one too many"), 1_000);

            assert_eq!(last.evicted, Some(1));
            assert_eq!(notifications.items().len(), HISTORY);
            assert_eq!(notifications.items()[0].summary, "1");
        }
    }

    mod read {
        use super::*;

        #[test]
        fn actions_are_pairs_and_default_is_a_press_on_the_whole() {
            let mut notifications = held(Vec::new());

            notifications.notify(
                Notify {
                    actions: ["default", "Open", "reply", "Reply", "half"]
                        .map(String::from)
                        .to_vec(),
                    ..notify("New message")
                },
                0,
            );

            let shown = &notifications.items()[0];
            assert!(shown.clickable);
            // A key with no label after it is a list cut short, and a button
            // with nothing on it is not drawn.
            assert_eq!(
                shown.actions,
                [NotificationAction {
                    key: "reply".into(),
                    label: "Reply".into(),
                }]
            );
        }

        #[test]
        fn urgency_and_timeout_are_the_specs_numbers() {
            let mut notifications = held(Vec::new());
            for (urgency, timeout) in [(Some(0), 0), (Some(2), 5_000), (Some(9), -7), (None, -1)] {
                notifications.notify(
                    Notify {
                        hints: Hints {
                            urgency,
                            ..Hints::default()
                        },
                        expire_timeout: timeout,
                        ..notify("")
                    },
                    0,
                );
            }

            let read: Vec<(Urgency, Option<u32>)> = notifications
                .items()
                .into_iter()
                .map(|shown| (shown.urgency, shown.timeout_ms))
                .collect();
            // An urgency the spec has no word for is the ordinary one, and a
            // timeout below `-1` is the server's choice, as `-1` is.
            assert_eq!(
                read,
                [
                    (Urgency::Low, Some(0)),
                    (Urgency::Critical, Some(5_000)),
                    (Urgency::Normal, None),
                    (Urgency::Normal, None),
                ]
            );
        }
    }

    mod from_a_page {
        use super::*;

        /// A Web Notification, as the browser sends it to a server that
        /// takes `x-kde-origin-name`.
        fn from_the_browser() -> Notify {
            Notify {
                app_name: "Chromium".into(),
                actions: ["0", "Reply", "default", "Activate", "settings", "Settings"]
                    .map(String::from)
                    .to_vec(),
                hints: Hints {
                    origin_name: Some("chat.example.com".into()),
                    ..Hints::default()
                },
                ..notify("New message")
            }
        }

        #[test]
        fn it_is_from_the_site_rather_than_the_browser() {
            let mut notifications = held(Vec::new());

            notifications.notify(from_the_browser(), 0);

            assert_eq!(notifications.items()[0].app_name, "chat.example.com");
        }

        #[test]
        fn the_browsers_own_settings_button_is_left_out() {
            // It opens the browser's settings page, which a desk has no
            // window for.
            let mut notifications = held(Vec::new());

            notifications.notify(from_the_browser(), 0);

            assert_eq!(
                notifications.items()[0].actions,
                [NotificationAction {
                    key: "0".into(),
                    label: "Reply".into(),
                }]
            );
            assert_eq!(notifications.invoke(1, "settings"), None);
        }

        #[test]
        fn a_program_may_still_call_a_button_settings() {
            let mut notifications = held(Vec::new());

            notifications.notify(
                Notify {
                    actions: ["settings", "Settings"].map(String::from).to_vec(),
                    ..notify("Update available")
                },
                0,
            );

            assert_eq!(notifications.items()[0].actions.len(), 1);
        }
    }

    mod pictures {
        use super::*;

        fn icon_of(notifications: &mut Notifications, sent: Notify) -> Option<String> {
            let id = notifications.notify(sent, 0).id;
            notifications
                .items()
                .into_iter()
                .find(|shown| shown.id == id)
                .and_then(|shown| shown.icon)
        }

        #[test]
        fn pixels_are_drawn_as_a_png() {
            let mut notifications = held(Vec::new());
            for channels in [3, 4] {
                let icon = icon_of(
                    &mut notifications,
                    Notify {
                        hints: Hints {
                            image_data: Some(red(2, 2, channels)),
                            ..Hints::default()
                        },
                        ..notify("")
                    },
                );

                assert_eq!(icon, Some(red_png(2, 2)), "{channels} channels");
            }
        }

        #[test]
        fn a_big_picture_is_shrunk_to_the_largest_side() {
            let mut notifications = held(Vec::new());

            let icon = icon_of(
                &mut notifications,
                Notify {
                    hints: Hints {
                        image_data: Some(red(512, 256, 4)),
                        ..Hints::default()
                    },
                    ..notify("")
                },
            );

            assert_eq!(icon, Some(red_png(128, 64)));
        }

        #[test]
        fn pixels_that_do_not_add_up_are_passed_over_for_the_next_picture() {
            let dir = data_dir(&[("icons/hicolor/48x48/apps/firefox.png", PNG_BYTES)]);
            let mut notifications = held(vec![dir.path().to_path_buf()]);
            let mut short = red(4, 4, 4);
            short.data.truncate(10);

            let icon = icon_of(
                &mut notifications,
                Notify {
                    app_icon: "firefox".into(),
                    hints: Hints {
                        image_data: Some(short),
                        ..Hints::default()
                    },
                    ..notify("")
                },
            );

            assert_eq!(icon, Some(data_url("image/png", PNG_BYTES)));
        }

        #[test]
        fn a_file_is_read_by_what_is_in_it_rather_than_its_name() {
            // The browser writes a page's icon to a temporary file with no
            // extension, and names it by path or by `file://` URI.
            let dir = data_dir(&[("chrome-icon-XXXXXX", PNG_BYTES)]);
            let path = dir.path().join("chrome-icon-XXXXXX");
            let mut notifications = held(Vec::new());

            for named in [
                path.display().to_string(),
                format!("file://{}", path.display()),
            ] {
                let by_image_path = icon_of(
                    &mut notifications,
                    Notify {
                        hints: Hints {
                            image_path: Some(named.clone()),
                            ..Hints::default()
                        },
                        ..notify("")
                    },
                );
                let by_app_icon = icon_of(
                    &mut notifications,
                    Notify {
                        app_icon: named.clone(),
                        ..notify("")
                    },
                );

                let expected = Some(data_url("image/png", PNG_BYTES));
                assert_eq!(by_image_path, expected, "image-path {named}");
                assert_eq!(by_app_icon, expected, "app_icon {named}");
            }
        }

        #[test]
        fn a_file_that_is_no_picture_is_none() {
            let dir = data_dir(&[("notes.txt", b"plain words")]);
            let mut notifications = held(Vec::new());

            let icon = icon_of(
                &mut notifications,
                Notify {
                    app_icon: dir.path().join("notes.txt").display().to_string(),
                    ..notify("")
                },
            );

            assert_eq!(icon, None);
        }

        #[test]
        fn a_name_is_looked_for_in_the_icon_theme() {
            let dir = data_dir(&[("icons/hicolor/scalable/apps/thunderbird.svg", b"<svg/>")]);
            let mut notifications = held(vec![dir.path().to_path_buf()]);

            let icon = icon_of(
                &mut notifications,
                Notify {
                    app_icon: "thunderbird".into(),
                    ..notify("")
                },
            );

            assert_eq!(icon, Some(data_url("image/svg+xml", b"<svg/>")));
        }
    }

    mod leaving {
        use super::*;

        fn three() -> Notifications {
            let mut notifications = held(Vec::new());
            for summary in ["one", "two", "three"] {
                notifications.notify(
                    Notify {
                        actions: ["default", "Open"].map(String::from).to_vec(),
                        ..notify(summary)
                    },
                    0,
                );
            }
            notifications
        }

        #[test]
        fn an_application_closes_its_own() {
            let mut notifications = three();

            assert!(notifications.close(2));
            assert!(!notifications.close(2));
            assert_eq!(summaries(&notifications), ["one", "three"]);
        }

        #[test]
        fn the_user_clears_some_or_all() {
            let mut notifications = three();

            assert_eq!(notifications.dismiss(&[3, 9, 1]), [3, 1]);
            assert_eq!(summaries(&notifications), ["two"]);
        }

        #[test]
        fn taking_an_action_lets_it_go() {
            let mut notifications = three();

            assert_eq!(notifications.invoke(1, DEFAULT_ACTION), Some(true));
            assert_eq!(summaries(&notifications), ["two", "three"]);
        }

        #[test]
        fn a_resident_one_stays_after_its_action() {
            let mut notifications = held(Vec::new());
            notifications.notify(
                Notify {
                    actions: ["play", "Play"].map(String::from).to_vec(),
                    hints: Hints {
                        resident: true,
                        ..Hints::default()
                    },
                    ..notify("Now playing")
                },
                0,
            );

            assert_eq!(notifications.invoke(1, "play"), Some(false));
            assert_eq!(summaries(&notifications), ["Now playing"]);
        }

        #[test]
        fn an_action_it_never_offered_is_nothing() {
            // Pressing a notification that offered no `default` is a press
            // on a picture, and an application must not hear a key it never
            // sent.
            let mut notifications = held(Vec::new());
            notifications.notify(notify("Plain"), 0);

            assert_eq!(notifications.invoke(1, DEFAULT_ACTION), None);
            assert_eq!(notifications.invoke(1, "reply"), None);
            assert_eq!(notifications.invoke(9, DEFAULT_ACTION), None);
            assert_eq!(summaries(&notifications), ["Plain"]);
        }
    }
}
