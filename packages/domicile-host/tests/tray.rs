//! What a StatusNotifierItem's properties become in the tray.

use std::fs;
use std::path::Path;

use domicile_host::tray::{address, item, method, Pixmap, Properties, Registry, Status, TrayIcons};
use domicile_protocol::{TrayAction, TrayItem};

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

fn icons_in(dir: &Path) -> TrayIcons {
    TrayIcons::new(vec![dir.to_path_buf()])
}

fn properties() -> Properties {
    Properties {
        id: "nm-applet".into(),
        title: String::new(),
        tooltip: String::new(),
        status: Status::Active,
        icon_name: String::new(),
        icon_pixmaps: Vec::new(),
        attention_icon_name: String::new(),
        attention_pixmaps: Vec::new(),
        icon_theme_path: String::new(),
    }
}

/// One opaque red pixel, as StatusNotifierItem sends it: ARGB, big-endian.
fn red_pixel(size: i32) -> Pixmap {
    Pixmap {
        width: size,
        height: size,
        argb: [0xff, 0xff, 0x00, 0x00].repeat((size * size) as usize),
    }
}

mod addresses {
    use super::*;

    #[test]
    fn a_bus_name_is_answered_at_the_specs_path() {
        // KDE's registration: the item's own well-known name, and the path the
        // spec says every item is at.
        assert_eq!(
            address("org.kde.StatusNotifierItem-4071-1", ":1.9"),
            (
                "org.kde.StatusNotifierItem-4071-1".into(),
                "/StatusNotifierItem".into()
            )
        );
    }

    #[test]
    fn a_path_is_answered_by_whoever_registered_it() {
        // libappindicator's: a path of its own choosing, on the connection
        // that made the call.
        assert_eq!(
            address("/org/ayatana/NotificationItem/nm_applet", ":1.42"),
            (
                ":1.42".into(),
                "/org/ayatana/NotificationItem/nm_applet".into()
            )
        );
    }

    #[test]
    fn a_name_with_a_path_after_it_is_both() {
        assert_eq!(
            address(":1.42/org/blueman/sni", ":1.9"),
            (":1.42".into(), "/org/blueman/sni".into())
        );
    }
}

mod items {
    use super::*;

    #[test]
    fn a_passive_item_is_not_in_the_tray() {
        // The spec's word for an icon with nothing to say right now, which
        // every tray hides.
        let dir = data_dir(&[]);
        let passive = Properties {
            status: Status::Passive,
            ..properties()
        };

        assert_eq!(item("an-id", passive, &mut icons_in(dir.path())), None);
    }

    #[test]
    fn the_title_is_the_tooltip_then_the_title_then_the_id() {
        let dir = data_dir(&[]);
        let mut icons = icons_in(dir.path());
        let title = |properties: Properties, icons: &mut TrayIcons| {
            item("an-id", properties, icons).map(|told| told.title)
        };

        assert_eq!(
            title(
                Properties {
                    title: "Network".into(),
                    tooltip: "Wired connection 1".into(),
                    ..properties()
                },
                &mut icons
            ),
            Some("Wired connection 1".into())
        );
        assert_eq!(
            title(
                Properties {
                    title: "Network".into(),
                    ..properties()
                },
                &mut icons
            ),
            Some("Network".into())
        );
        assert_eq!(title(properties(), &mut icons), Some("nm-applet".into()));
    }

    #[test]
    fn an_item_that_names_itself_nothing_is_titled_by_its_id() {
        // The one label that is always there, so a shell never draws an
        // unlabeled button.
        let dir = data_dir(&[]);
        let nameless = Properties {
            id: String::new(),
            ..properties()
        };

        assert_eq!(
            item(
                ":1.9/StatusNotifierItem",
                nameless,
                &mut icons_in(dir.path())
            )
            .map(|told| told.title),
            Some(":1.9/StatusNotifierItem".into())
        );
    }

    #[test]
    fn a_named_icon_is_found_where_status_icons_are() {
        // nm-applet's icons are `status` icons, not `apps` ones, which is the
        // one directory a launcher never looks in.
        let dir = data_dir(&[("icons/hicolor/22x22/status/nm-signal-75.png", b"wifi")]);
        let named = Properties {
            icon_name: "nm-signal-75".into(),
            ..properties()
        };

        assert_eq!(
            item("an-id", named, &mut icons_in(dir.path())),
            Some(TrayItem {
                id: "an-id".into(),
                title: "nm-applet".into(),
                icon: Some("data:image/png;base64,d2lmaQ==".into()),
            })
        );
    }

    #[test]
    fn the_items_own_theme_path_is_looked_in_first() {
        // Where an application that ships its icons privately says they are.
        let dir = data_dir(&[("icons/hicolor/22x22/status/sync.png", b"system")]);
        let own = data_dir(&[("hicolor/22x22/status/sync.png", b"own")]);
        let named = Properties {
            icon_name: "sync".into(),
            icon_theme_path: own.path().to_string_lossy().into_owned(),
            ..properties()
        };

        assert_eq!(
            item("an-id", named, &mut icons_in(dir.path())).and_then(|told| told.icon),
            Some("data:image/png;base64,b3du".into())
        );
    }

    #[test]
    fn a_pixmap_is_drawn_when_no_name_is_found() {
        let dir = data_dir(&[]);
        let pictured = Properties {
            icon_name: "nothing-installed-this".into(),
            icon_pixmaps: vec![red_pixel(1)],
            ..properties()
        };

        let icon = item("an-id", pictured, &mut icons_in(dir.path()))
            .and_then(|told| told.icon)
            .expect("the pixmap, drawn");
        assert!(icon.starts_with("data:image/png;base64,iVBORw0KGgo"));
    }

    /// The picture an item sending `pixmaps` is drawn with.
    fn drawn(pixmaps: Vec<Pixmap>) -> Option<String> {
        let dir = data_dir(&[]);
        let pictured = Properties {
            icon_pixmaps: pixmaps,
            ..properties()
        };
        item("an-id", pictured, &mut icons_in(dir.path())).and_then(|told| told.icon)
    }

    #[test]
    fn the_smallest_pixmap_big_enough_is_drawn() {
        // Scaled down rather than up, and not further down than it has to be.
        assert_eq!(
            drawn(vec![red_pixel(16), red_pixel(64), red_pixel(48)]),
            drawn(vec![red_pixel(48)])
        );
    }

    #[test]
    fn with_none_big_enough_the_biggest_is_drawn() {
        assert_eq!(
            drawn(vec![red_pixel(16), red_pixel(22)]),
            drawn(vec![red_pixel(22)])
        );
    }

    #[test]
    fn a_pixmap_whose_bytes_do_not_add_up_is_passed_over() {
        let short = Pixmap {
            argb: vec![0xff; 3],
            ..red_pixel(1)
        };

        assert_eq!(drawn(vec![short.clone()]), None);
        assert_eq!(
            drawn(vec![short, red_pixel(16)]),
            drawn(vec![red_pixel(16)])
        );
    }

    #[test]
    fn an_item_needing_attention_shows_its_attention_icon() {
        let dir = data_dir(&[
            ("icons/hicolor/22x22/status/mail.png", b"calm"),
            ("icons/hicolor/22x22/status/mail-new.png", b"new"),
        ]);
        let urgent = Properties {
            status: Status::NeedsAttention,
            icon_name: "mail".into(),
            attention_icon_name: "mail-new".into(),
            ..properties()
        };

        assert_eq!(
            item("an-id", urgent, &mut icons_in(dir.path())).and_then(|told| told.icon),
            Some("data:image/png;base64,bmV3".into())
        );
    }

    #[test]
    fn an_item_needing_attention_with_no_attention_icon_shows_its_own() {
        let dir = data_dir(&[("icons/hicolor/22x22/status/mail.png", b"calm")]);
        let urgent = Properties {
            status: Status::NeedsAttention,
            icon_name: "mail".into(),
            ..properties()
        };

        assert_eq!(
            item("an-id", urgent, &mut icons_in(dir.path())).and_then(|told| told.icon),
            Some("data:image/png;base64,Y2FsbQ==".into())
        );
    }

    #[test]
    fn an_item_with_no_picture_is_still_in_the_tray() {
        // A shell can still label it, and click it.
        let dir = data_dir(&[]);

        assert_eq!(
            item("an-id", properties(), &mut icons_in(dir.path())),
            Some(TrayItem {
                id: "an-id".into(),
                title: "nm-applet".into(),
                icon: None,
            })
        );
    }
}

mod statuses {
    use super::*;

    #[test]
    fn the_specs_three_words_are_read() {
        assert_eq!(Status::from_wire("Passive"), Status::Passive);
        assert_eq!(Status::from_wire("Active"), Status::Active);
        assert_eq!(Status::from_wire("NeedsAttention"), Status::NeedsAttention);
    }

    #[test]
    fn a_word_the_spec_does_not_have_is_shown() {
        // An item that misspells its status still asked to be in a tray, and
        // hiding it would be the one reading that loses an icon.
        assert_eq!(Status::from_wire("active"), Status::Active);
    }
}

mod registry {
    use super::*;

    fn shown(id: &str) -> TrayItem {
        TrayItem {
            id: id.into(),
            title: id.into(),
            icon: None,
        }
    }

    /// A registry holding the two items every test below starts from: one
    /// registered by well-known name and one by path.
    fn two() -> Registry {
        let mut registry = Registry::default();
        registry.register("org.kde.SNI-1", ":1.9", "/StatusNotifierItem");
        registry.register(":1.42", ":1.42", "/org/ayatana/nm");
        registry
    }

    #[test]
    fn an_item_is_named_by_its_bus_and_its_path() {
        let mut registry = Registry::default();

        assert_eq!(
            registry.register("org.kde.SNI-1", ":1.9", "/StatusNotifierItem"),
            Some("org.kde.SNI-1/StatusNotifierItem".to_string())
        );
    }

    #[test]
    fn an_item_registered_twice_is_one_item() {
        // An application that restarts its tray code registers again on the
        // same connection, and two icons for it would be one too many.
        let mut registry = two();

        assert_eq!(registry.register(":1.42", ":1.42", "/org/ayatana/nm"), None);
    }

    #[test]
    fn nothing_is_shown_until_it_has_been_read() {
        // Registered is not drawable: the properties come after.
        assert_eq!(two().items(), vec![]);
    }

    #[test]
    fn items_are_shown_in_the_order_they_registered() {
        let mut registry = two();
        registry.show(":1.42/org/ayatana/nm", Some(shown("b")));
        registry.show("org.kde.SNI-1/StatusNotifierItem", Some(shown("a")));

        assert_eq!(registry.items(), vec![shown("a"), shown("b")]);
    }

    #[test]
    fn a_passive_item_is_held_but_not_shown() {
        let mut registry = two();
        registry.show("org.kde.SNI-1/StatusNotifierItem", None);

        assert_eq!(registry.items(), vec![]);
        assert_eq!(
            registry.address("org.kde.SNI-1/StatusNotifierItem"),
            Some(("org.kde.SNI-1".into(), "/StatusNotifierItem".into()))
        );
    }

    #[test]
    fn a_signal_is_matched_by_the_connection_that_sent_it() {
        // A signal names its sender by unique name, which is not the name an
        // item registered by well-known name is known by.
        let registry = two();

        assert_eq!(
            registry.sent_by(":1.9", "/StatusNotifierItem"),
            vec!["org.kde.SNI-1/StatusNotifierItem".to_string()]
        );
        assert_eq!(registry.sent_by(":1.9", "/elsewhere"), Vec::<String>::new());
    }

    #[test]
    fn a_connection_that_goes_takes_its_items_with_it() {
        let mut registry = two();
        registry.show(":1.42/org/ayatana/nm", Some(shown("b")));

        assert_eq!(
            registry.vanished(":1.42"),
            vec![":1.42/org/ayatana/nm".to_string()]
        );
        assert_eq!(registry.items(), vec![]);
        assert_eq!(registry.address(":1.42/org/ayatana/nm"), None);
    }

    #[test]
    fn a_well_known_name_that_goes_takes_its_item_with_it() {
        let mut registry = two();

        assert_eq!(
            registry.vanished("org.kde.SNI-1"),
            vec!["org.kde.SNI-1/StatusNotifierItem".to_string()]
        );
    }

    #[test]
    fn a_well_known_name_that_changes_hands_is_heard_from_its_new_owner() {
        // The item's signals arrive from whichever connection holds its name
        // now, and matching the old one would freeze its icon.
        let mut registry = two();

        registry.moved("org.kde.SNI-1", ":1.77");

        assert_eq!(
            registry.sent_by(":1.77", "/StatusNotifierItem"),
            vec!["org.kde.SNI-1/StatusNotifierItem".to_string()]
        );
        assert_eq!(
            registry.sent_by(":1.9", "/StatusNotifierItem"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn every_item_is_listed_by_id() {
        assert_eq!(
            two().ids(),
            vec![
                "org.kde.SNI-1/StatusNotifierItem".to_string(),
                ":1.42/org/ayatana/nm".to_string()
            ]
        );
    }
}

mod actions {
    use super::*;

    #[test]
    fn each_button_is_the_specs_method() {
        assert_eq!(method(TrayAction::Primary), "Activate");
        assert_eq!(method(TrayAction::Secondary), "SecondaryActivate");
        assert_eq!(method(TrayAction::Context), "ContextMenu");
    }
}
