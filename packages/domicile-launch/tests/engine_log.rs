//! Turning the engine's stderr into journal entries.
//!
//! Chromium writes `[pid:tid:time:LEVEL:file:line] message`. Each line becomes
//! an entry at the matching priority, so `journalctl -p err` finds the
//! engine's errors and not its chatter.

use domicile_launch::engine_log::EngineLog;
use domicile_launch::journal::{Entry, Priority};

fn one(line: &str) -> Entry {
    EngineLog::new().entry(line)
}

#[test]
fn a_line_keeps_its_message_and_says_where_it_came_from() {
    assert_eq!(
        one("[875919:875919:0907/043334.201180:ERROR:dbus/bus.cc:405] the bus is gone"),
        Entry {
            identifier: "domicile-engine",
            priority: Priority::Error,
            message: "the bus is gone".to_string(),
            fields: vec![
                ("CODE_FILE", "dbus/bus.cc".to_string()),
                ("CODE_LINE", "405".to_string()),
                ("DOMICILE_PID", "875919".to_string()),
            ],
        }
    );
}

#[test]
fn each_level_maps_to_its_syslog_priority() {
    for (level, priority) in [
        ("VERBOSE1", Priority::Debug),
        ("INFO", Priority::Info),
        ("WARNING", Priority::Warning),
        ("ERROR", Priority::Error),
        ("FATAL", Priority::Critical),
    ] {
        assert_eq!(
            one(&format!("[1:1:1013/000000.000000:{level}:a.cc:1] said")).priority,
            priority,
            "{level}"
        );
    }
}

#[test]
fn the_older_file_and_line_form_is_read_too() {
    // Upstream code paths that format their own prefix still write `file(line)`.
    let entry = one("[1:1:1005/094108.1:FATAL:content/x.cc(12)] gone");
    assert_eq!(
        entry.fields[..2],
        [
            ("CODE_FILE", "content/x.cc".to_string()),
            ("CODE_LINE", "12".to_string()),
        ]
    );
}

#[test]
fn the_shells_console_is_the_shells_log() {
    // A shell author reads `journalctl -t domicile-shell`, not the engine's.
    let entry = one(
        "[1:1:1013/000000.000000:ERROR:CONSOLE:30] \"no layout\", source: domicile://shell/main.js (30)",
    );
    assert_eq!(entry.identifier, "domicile-shell");
    assert_eq!(entry.priority, Priority::Error);
    assert_eq!(
        entry.message,
        "\"no layout\", source: domicile://shell/main.js (30)"
    );
}

#[test]
fn a_shell_loggers_subsystem_is_a_field() {
    // `logger("notifications").error(...)` from the SDK starts its message
    // with the name, so `journalctl DOMICILE_SUBSYSTEM=notifications` finds it.
    let entry = one(
        "[1:1:1013/000000.000000:VERBOSE1:CONSOLE:12] \"[notifications] shown 3\", source: domicile://shell/main.js (12)",
    );
    assert_eq!(entry.priority, Priority::Debug);
    assert!(
        entry
            .fields
            .contains(&("DOMICILE_SUBSYSTEM", "notifications".to_string())),
        "{:?}",
        entry.fields
    );
    let plain = one(
        "[1:1:1013/000000.000000:ERROR:CONSOLE:30] \"no layout\", source: domicile://shell/main.js (30)",
    );
    assert!(
        !plain
            .fields
            .iter()
            .any(|(name, _)| *name == "DOMICILE_SUBSYSTEM"),
        "{:?}",
        plain.fields
    );
}

#[test]
fn a_pages_console_stays_the_engines() {
    let entry =
        one("[1:1:1013/000000.000000:INFO:CONSOLE:3] \"hi\", source: https://example.com/a.js (3)");
    assert_eq!(entry.identifier, "domicile-engine");
}

#[test]
fn a_line_without_a_prefix_continues_the_one_before() {
    // A multi-line message, such as a stack, keeps its priority.
    let mut log = EngineLog::new();
    log.entry(
        "[1:1:1013/000000.000000:ERROR:CONSOLE:30] \"boom\", source: domicile://shell/main.js (30)",
    );
    let next = log.entry("    at main (domicile://shell/main.js:30:5)");
    assert_eq!(next.identifier, "domicile-shell");
    assert_eq!(next.priority, Priority::Error);
    assert_eq!(next.message, "    at main (domicile://shell/main.js:30:5)");
}

#[test]
fn a_line_without_a_prefix_before_any_other_is_a_warning() {
    // A library writing to stderr directly, such as Mesa or Fontconfig. It
    // has no level, and is rare enough to be worth seeing.
    let entry = one("Fontconfig error: no such file");
    assert_eq!(entry.identifier, "domicile-engine");
    assert_eq!(entry.priority, Priority::Warning);
    assert_eq!(entry.fields, []);
}
