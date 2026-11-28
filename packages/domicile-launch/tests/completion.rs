//! Tests for tab completion: `domicile completions --complete`.

use domicile_launch::commands::COMMANDS;
use domicile_launch::completion::{complete, Completion, CompletionShell, Sources};
use domicile_launch::shell_usage::{next_words, Word};
use domicile_protocol::{
    AgentReach, ConnectedAgent, KnownAgents, ListedWindow, RememberedAgent, ShellCommandHelp,
};

fn words(said: &[&str]) -> Vec<String> {
    said.iter().map(|word| word.to_string()).collect()
}

fn window(id: &str, title: &str) -> ListedWindow {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "kind": "native",
        "title": title,
        "app": null,
        "pid": null,
        "size": null,
        "focused": false,
        "urgent": false,
        "url": null,
        "private": false,
        "engine_id": null,
    }))
    .expect("a window")
}

fn agents() -> KnownAgents {
    KnownAgents {
        connected: vec![ConnectedAgent {
            session: 3,
            agent: "Claude".to_string(),
            reach: AgentReach::Desk,
        }],
        remembered: vec![RememberedAgent {
            agent: "Codex".to_string(),
            last_used_ms: 0,
        }],
    }
}

fn shell_commands() -> Vec<ShellCommandHelp> {
    [
        ("focus left|right|up|down", "Move focus."),
        ("focus parent|child", "Focus the parent or child."),
        ("fullscreen toggle [global]", "Fullscreen the window."),
        ("workspace <name>", "Go to a workspace."),
        ("move window <window> to <name>", "Move a window."),
    ]
    .map(|(usage, description)| ShellCommandHelp {
        usage: usage.to_string(),
        description: description.to_string(),
        window: usage.starts_with("fullscreen"),
    })
    .to_vec()
}

/// Completes with a desktop that has two windows, an agent and a shell.
fn completed(before: &[&str], current: &str) -> Completion {
    complete(
        &words(before),
        current,
        &Sources {
            windows: &|| vec![window("a1", "Notes"), window("b2", "Mail")],
            displays: &Vec::new,
            agents: &agents,
            profiles: &|| vec![("work".to_string(), "Work".to_string())],
            shell_commands: &shell_commands,
            shell_values: &|typed| match typed {
                [said] if said == "workspace" => vec!["mail".to_string(), "code".to_string()],
                _ => panic!("the shell was asked to complete {typed:?}"),
            },
            programs: &|start| {
                ["kill", "kitty"]
                    .into_iter()
                    .filter(|program| program.starts_with(start))
                    .map(str::to_string)
                    .collect()
            },
        },
    )
}

fn values(completion: Completion) -> Vec<String> {
    match completion {
        Completion::Values(values) => values.into_iter().map(|(value, _)| value).collect(),
        other => panic!("{other:?} is not values"),
    }
}

#[test]
fn the_first_word_is_every_command_with_its_summary() {
    let Completion::Values(listed) = completed(&[], "") else {
        panic!("no commands");
    };
    assert_eq!(listed.len(), COMMANDS.len());
    assert!(listed.contains(&(
        "list-windows".to_string(),
        "List native and browser windows".to_string()
    )));
}

#[test]
fn a_start_narrows_the_commands() {
    assert_eq!(values(completed(&[], "list-w")), ["list-windows"]);
}

#[test]
fn a_dash_first_offers_the_run_flags() {
    assert_eq!(values(completed(&[], "--c")), ["--config"]);
}

#[test]
fn a_path_first_is_a_shell_to_run() {
    assert_eq!(completed(&[], "./"), Completion::Files);
    assert_eq!(completed(&["--config"], ""), Completion::Files);
}

#[test]
fn window_commands_offer_window_ids_with_their_titles() {
    assert_eq!(
        completed(&["close-window", "--window"], ""),
        Completion::Values(vec![
            ("a1".to_string(), "Notes".to_string()),
            ("b2".to_string(), "Mail".to_string()),
        ])
    );
}

#[test]
fn a_flag_is_offered_where_it_goes_and_then_its_value() {
    assert_eq!(values(completed(&["focus-window"], "--")), ["--agent"]);
    assert_eq!(values(completed(&["focus-window", "--agent"], "")), ["3"]);
    assert_eq!(
        values(completed(&["focus-window", "--agent", "3"], "")),
        ["a1", "b2"]
    );
}

#[test]
fn a_listing_offers_json_and_nothing_after_it() {
    assert_eq!(values(completed(&["list-windows"], "")), ["--json"]);
    assert!(values(completed(&["list-windows", "--json"], "")).is_empty());
}

#[test]
fn agent_names_are_the_remembered_ones_and_sessions_the_connected_ones() {
    assert_eq!(values(completed(&["forget-agent"], "")), ["Codex"]);
    assert_eq!(values(completed(&["stop-agent"], "")), ["3"]);
}

#[test]
fn open_completes_its_flags_their_values_and_then_a_path() {
    assert_eq!(values(completed(&["open", "--profile"], "")), ["work"]);
    assert_eq!(
        values(completed(&["open", "--reuse"], "")),
        ["focus", "navigate", "new"]
    );
    assert_eq!(completed(&["open"], "~/"), Completion::Files);
}

#[test]
fn exec_completes_a_program_then_its_files() {
    assert_eq!(values(completed(&["exec"], "ki")), ["kill", "kitty"]);
    assert_eq!(completed(&["exec", "kitty"], ""), Completion::Files);
}

#[test]
fn configure_display_completes_changes_and_their_values() {
    assert!(values(completed(&["configure-display", "DP-1"], "")).contains(&"hdr".to_string()));
    assert_eq!(
        values(completed(&["configure-display", "DP-1", "hdr"], "")),
        ["off", "on"]
    );
    assert!(
        !values(completed(&["configure-display", "DP-1", "hdr", "on"], ""))
            .contains(&"hdr".to_string())
    );
}

#[test]
fn set_log_level_completes_a_level_then_subsystems() {
    assert!(values(completed(&["set-log-level"], "")).contains(&"debug".to_string()));
    assert!(!values(completed(&["set-log-level", "debug"], "")).is_empty());
    assert_eq!(values(completed(&["set-log-level"], "--")), ["--reset"]);
}

#[test]
fn help_and_completions_complete_what_they_take() {
    assert_eq!(values(completed(&["help"], "list-w")), ["list-windows"]);
    assert_eq!(
        values(completed(&["completions"], "")),
        ["bash", "elvish", "fish", "nushell", "powershell", "zsh"]
    );
}

#[test]
fn send_shell_completes_the_running_shells_commands() {
    let Completion::Values(first) = completed(&["send-shell"], "") else {
        panic!("no shell commands");
    };
    assert_eq!(
        first,
        [
            ("focus", "Move focus."),
            ("fullscreen", "Fullscreen the window."),
            ("move", "Move a window."),
            ("workspace", "Go to a workspace."),
        ]
        .map(|(word, about)| (word.to_string(), about.to_string()))
    );
    assert_eq!(
        values(completed(&["send-shell", "focus"], "")),
        ["child", "down", "left", "parent", "right", "up"]
    );
    assert_eq!(
        values(completed(&["send-shell", "fullscreen", "toggle"], "")),
        ["global"]
    );
}

#[test]
fn send_shell_fills_a_window_placeholder_with_window_ids() {
    assert_eq!(
        values(completed(&["send-shell", "move", "window"], "")),
        ["a1", "b2"]
    );
    assert_eq!(
        values(completed(&["send-shell", "move", "window", "a1"], "")),
        ["to"]
    );
}

#[test]
fn send_shell_asks_the_shell_for_placeholders_only_it_knows() {
    assert_eq!(
        values(completed(&["send-shell", "workspace"], "")),
        ["code", "mail"]
    );
    assert_eq!(
        values(completed(&["send-shell", "workspace"], "m")),
        ["mail"]
    );
}

#[test]
fn the_answer_is_printed_kind_first_then_a_line_per_value() {
    assert_eq!(Completion::Files.printed(), "files\n");
    assert_eq!(
        Completion::Values(vec![("a1".to_string(), "Notes".to_string())]).printed(),
        "values\na1\tNotes\n"
    );
}

#[test]
fn a_usage_offers_each_choice_and_skips_optional_words() {
    let typed = words(&["fullscreen"]);
    assert_eq!(
        next_words("fullscreen toggle [global]", &typed),
        [Word::Literal("toggle".to_string())]
    );
    assert_eq!(
        next_words("overview [show|hide]", &words(&["overview"])),
        [
            Word::Literal("show".to_string()),
            Word::Literal("hide".to_string())
        ]
    );
    assert_eq!(
        next_words("keymap next|<name>", &words(&["keymap"])),
        [
            Word::Literal("next".to_string()),
            Word::Placeholder("name".to_string())
        ]
    );
    assert_eq!(
        next_words(
            "virtual-monitor add [<width>x<height>]",
            &words(&["virtual-monitor", "add"])
        ),
        [Word::Placeholder("width".to_string())]
    );
    assert!(next_words("split h|v", &words(&["layout"])).is_empty());
}

#[test]
fn every_shell_has_a_script_that_runs_complete() {
    for shell in CompletionShell::ALL {
        assert!(
            shell.script().contains("domicile completions")
                && shell.script().contains("--complete="),
            "{}'s script does not ask domicile",
            shell.name()
        );
    }
}

#[test]
fn a_shell_command_on_a_window_takes_one_after_its_first_word() {
    assert_eq!(
        values(completed(&["send-shell", "fullscreen"], "--w")),
        ["--window"]
    );
    assert_eq!(
        values(completed(&["send-shell", "fullscreen", "--window"], "")),
        ["a1", "b2"]
    );
    assert_eq!(
        values(completed(
            &["send-shell", "fullscreen", "--window", "a1"],
            ""
        )),
        ["toggle"]
    );
    assert!(values(completed(
        &["send-shell", "fullscreen", "--window", "a1", "toggle"],
        "--w"
    ))
    .is_empty());
    // At the end too.
    assert_eq!(
        values(completed(&["send-shell", "fullscreen", "toggle"], "--w")),
        ["--window"]
    );
    assert_eq!(
        values(completed(
            &["send-shell", "fullscreen", "toggle", "--window"],
            ""
        )),
        ["a1", "b2"]
    );
    assert!(values(completed(&["send-shell", "workspace"], "--w")).is_empty());
    assert!(values(completed(&["send-shell"], "--w")).is_empty());
}

#[test]
fn window_acts_take_a_window_flag_and_devtools_also_the_shell() {
    assert_eq!(
        values(completed(&["close-window"], "")),
        ["--agent", "--window"]
    );
    assert_eq!(
        values(completed(
            &["accessibility-act", "--window", "a1", "ref1"],
            ""
        )),
        ["click", "focus", "set-text"]
    );
    assert_eq!(
        values(completed(&["devtools", "--window"], "")),
        ["a1", "b2", "shell"]
    );
}
