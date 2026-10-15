//! Tests that the chrome receives the config's `shell_options`, on connect and
//! after an edit, without the compositor reading them.

mod running;

use domicile_protocol::HostMessage;

use crate::running::Compositor;

const A_DESK_WITH_A_12_HOUR_CLOCK: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "shell_options": { "clock": { "format": "12h" } }
}
"#;

const THE_SAME_DESK_WITH_GAPS: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "shell_options": { "clock": { "format": "12h" }, "gaps": 4 }
}
"#;

fn shell_config(message: &HostMessage) -> bool {
    matches!(message, HostMessage::ShellConfig { .. })
}

/// The options a `shell_config` carries, parsed.
fn options(message: &HostMessage) -> serde_json::Value {
    let HostMessage::ShellConfig { options, .. } = message else {
        unreachable!("the wait matched on the variant");
    };
    serde_json::from_str(options).expect("the options are JSON text")
}

#[test]
fn the_shell_s_options_reach_the_chrome_and_follow_an_edit() {
    let compositor = Compositor::started_with(A_DESK_WITH_A_12_HOUR_CLOCK);
    let mut chrome = compositor.chrome();

    let told = chrome
        .wait_for(shell_config)
        .expect("the options ride with the handshake");
    assert_eq!(
        options(&told),
        serde_json::json!({ "clock": { "format": "12h" } })
    );

    compositor.reconfigure(THE_SAME_DESK_WITH_GAPS);

    let told = chrome
        .wait_for(shell_config)
        .expect("the chrome is told the options the edit set");
    assert_eq!(
        options(&told),
        serde_json::json!({ "clock": { "format": "12h" }, "gaps": 4 })
    );
}
