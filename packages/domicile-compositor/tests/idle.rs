//! A timeout edited on disk is the timeout the desktop blanks on.
//!
//! `crate::idle` decides *when* a desktop nobody is at goes dark, and its unit
//! tests own that arithmetic. What they cannot reach is the clock itself: the
//! timeout arrives from a config file, and the source that asks it is a calloop
//! timer armed in `run` — so whether an edited timeout is the one the desktop
//! then blanks on is a claim about a running compositor and nothing smaller.
//!
//! The hard direction on purpose. A desk that stated no timeout at startup has
//! *no timer at all*, deliberately: a desktop that never blanks should not wake
//! anything. So a reload that adds one has to arm a source that was never
//! inserted, which is the case a reload that merely stored the new number
//! cannot do anything about — and the case a re-armed clock gets wrong by
//! doing nothing.
//!
//! The film at the foot of this file is here for the same kind of reason: an
//! inhibitor is a real client binding a real global, and whether a client that
//! *died* still holds one is a question about a connection being cleaned up.
//! Neither is arithmetic, and neither can be asked of `crate::idle` alone.
//!
//! Read off the compositor's own log rather than off the connectors, because
//! the connectors are the *engine's* and no engine is attached here. The line
//! is the edge into dark, which is where the decision is; `e2e` and the
//! machine-with-a-screen check in `ROADMAP.md` are what watch glass go off.

mod running;

use crate::running::Compositor;

/// A desk that never blanks, which is what saying nothing about idle means.
const NOBODY_MENTIONED_IDLE: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]
"#;

/// The same desk, told to turn its screens off after a second alone.
///
/// A second because a check should not wait longer than it has to, and the
/// config's own validation refuses zero — so this is the shortest timeout a
/// desk can state, and it is the number `Idle` is handed rather than one this
/// file rounds.
const A_DESK_THAT_BLANKS: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]

[idle]
blank_after_seconds = 1
"#;

/// The same desk again, waiting longer.
///
/// A second timeout rather than none at all, so the edit is a *changed* clock
/// rather than a removed one — the case where a desktop goes on blanking and
/// the state still has to agree with the glass.
const A_DESK_THAT_BLANKS_LATER: &str = r#"
[[output.displays]]
name = "left"
size = [1920, 1080]

[idle]
blank_after_seconds = 30
"#;

#[test]
fn a_timeout_added_on_disk_blanks_a_desk_that_had_no_clock() {
    let compositor = Compositor::started_with(NOBODY_MENTIONED_IDLE);

    compositor.reconfigure(A_DESK_THAT_BLANKS);

    compositor.wait_for_log("nobody is at this desktop; its screens go dark");
}

/// A desk edited while its screens are off gets them back.
///
/// The clock is replaced by the edit, and the clock being replaced is the only
/// thing that knew the screens were off: `Idle::after` builds a desktop that
/// has just been stirred. Keeping the old `dark` instead is not the fix — it
/// would be a compositor that believes the screens are on, which is what
/// `Idle::stirred` answers `ComeBack` from, so the *next* hand on the desk
/// would relight nothing and the desk would stay dark through every keystroke
/// until something else stated its connectors.
///
/// So the glass is put back where the state says it is. Asserted on the log
/// for the reason the check above is: the connectors are the engine's, and
/// there is no engine here.
#[test]
fn a_timeout_edited_while_the_screens_are_off_turns_them_back_on() {
    let compositor = Compositor::started_with(A_DESK_THAT_BLANKS);
    compositor.wait_for_log("nobody is at this desktop; its screens go dark");

    compositor.reconfigure(A_DESK_THAT_BLANKS_LATER);

    compositor.wait_for_log("the idle timeout changed while the screens were off");
}

/// A film holds the screens on, and a film whose process died does not.
///
/// The one claim in this area that nothing smaller can make: `crate::idle`'s
/// own tests hand it an inhibitor and a flag saying whether the client is
/// still there, and both of those are this compositor's readings of a real
/// `zwp_idle_inhibit_manager_v1` — the global has to be advertised, the
/// request has to reach `Idle`, and a client's death has to be noticed by
/// something. A unit test cannot tell whether any of that was wired up.
///
/// Both edges are asserted on a desk that is **already dark**, which is the
/// ordinary way a film starts and the harder direction: the answer changes
/// with no hand anywhere near the desk.
///
/// The client is killed rather than asked to stop, because that is the case
/// worth proving: a player that crashes sends no
/// `zwp_idle_inhibitor_v1.destroy`, so the only thing that can let go of its
/// inhibitor is the compositor noticing that the connection is gone. That path
/// is the only one that says this second line — the clock coming round says
/// something else — so a compositor which leaked the inhibitor fails here
/// rather than passing a timeout later.
#[test]
fn a_film_holds_the_screens_on_until_the_client_playing_it_is_gone() {
    let compositor = Compositor::started_with(A_DESK_THAT_BLANKS);
    compositor.wait_for_log("nobody is at this desktop; its screens go dark");

    let film = compositor.client_with("film", &["--hold-the-screens-on"]);
    compositor.wait_for_log("a client is holding this desktop awake");

    drop(film);
    compositor.wait_for_log("the client holding this desktop awake is gone");
}
