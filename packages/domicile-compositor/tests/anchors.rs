//! `domicile_anchor_v1`: a window asking to be laid out at a named place in
//! the page. See `docs/architecture/WINDOW-COMPOSITING.md#anchored-windows`.

mod running;

use domicile_protocol::HostMessage;

use crate::running::Compositor;

const ONE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }
"#;

/// A window anchored before its first frame names its anchor right after it
/// appears, so the shell never lays it out anywhere else.
#[test]
fn a_window_anchored_before_it_draws_names_its_anchor_as_it_appears() {
    let compositor = Compositor::started_with(ONE_DISPLAY);
    let mut chrome = compositor.chrome();
    let _client = compositor.client_with("an anchored window", &["--anchor", "bar"]);

    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("the window is announced");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };
    let next = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAnchored { .. }))
        .expect("its anchor is announced");

    assert_eq!(
        next,
        HostMessage::AppAnchored {
            app_id,
            anchor: Some("bar".to_string()),
        }
    );
}
