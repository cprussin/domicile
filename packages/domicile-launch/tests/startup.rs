//! Tests for the one line a desktop prints when it is up, off a terminal.

use std::path::Path;

use domicile_launch::startup::{up_line, Chosen};

#[test]
fn the_up_line_says_what_the_desktop_chose_and_where_to_reach_it() {
    let started = Chosen {
        version: Some("domicile 1.3.0"),
        shell: Path::new("/desk/shell.js"),
        config: "/home/me/.config/domicile/domicile.json",
        profile: Path::new("/home/me/.local/share/domicile/profile"),
        platform: "drm",
        on_the_cpu: false,
        socket: Path::new("/run/user/1000/domicile-ipc.7.sock"),
    };
    assert_eq!(
        up_line(&started),
        "domicile is up. domicile 1.3.0 · shell /desk/shell.js · \
         config /home/me/.config/domicile/domicile.json · \
         profile /home/me/.local/share/domicile/profile · platform drm · \
         DOMICILE_SOCK=/run/user/1000/domicile-ipc.7.sock"
    );
    assert_eq!(
        up_line(&Chosen {
            version: None,
            on_the_cpu: true,
            ..started
        }),
        "domicile is up. shell /desk/shell.js · \
         config /home/me/.config/domicile/domicile.json · \
         profile /home/me/.local/share/domicile/profile · platform drm · \
         the engine composites on the CPU · \
         DOMICILE_SOCK=/run/user/1000/domicile-ipc.7.sock"
    );
}
