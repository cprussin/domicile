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
//! The two below it are the other half of what an inhibitor is worth, and
//! they are about a *window* rather than about a request: whether a surface is
//! one this desktop shows is the compositor's own reading, and neither a
//! window appearing under an inhibitor taken before it nor a window closed on
//! a client that is still running is anything `crate::idle` can be asked
//! about.
//!
//! Read off the compositor's own log rather than off the connectors, because
//! the connectors are the *engine's* and no engine is attached here. The line
//! is the edge into dark, which is where the decision is; `e2e` and the
//! machine-with-a-screen check in `ROADMAP.md` are what watch glass go off.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

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
/// inhibitor is the compositor noticing that the client is gone. Two things
/// do — the window going and the surface going — and the second line below is
/// what either of them says, where the clock coming round says something
/// else. So a compositor which leaked the inhibitor fails here rather than
/// passing a timeout later.
///
/// Two, because a client that dies takes its window with it: the connection is
/// cleaned up object by object and the `xdg_toplevel` goes with the rest, so
/// which of them reaches the answer first is a fact about smithay's cleanup
/// rather than about this desktop. Both are the right answer and this check
/// does not pick one.
#[test]
fn a_film_holds_the_screens_on_until_the_client_playing_it_is_gone() {
    let compositor = Compositor::started_with(A_DESK_THAT_BLANKS);
    compositor.wait_for_log("nobody is at this desktop; its screens go dark");

    let film = compositor.client_with("film", &["--hold-the-screens-on"]);
    compositor.wait_for_log("a client is holding this desktop awake");

    drop(film);
    compositor.wait_for_log("this desktop's screens go dark");
}

/// An inhibitor arriving before the window it belongs to holds nothing until
/// the window is there.
///
/// Both halves of the same claim, in one run and in the only order that can
/// show them. The client takes its inhibitor on a surface with no role — which
/// the protocol allows and a desktop must not honor — and then asks for a
/// window on that same surface. So the line below can only be said by a desk
/// that was **still dark** when the window arrived: a compositor that let the
/// bare surface hold would have come back on the request and had no edge left
/// for the window, and one that never noticed the window would still be dark
/// now.
#[test]
fn an_inhibitor_taken_before_a_window_holds_nothing_until_the_window_is_there() {
    let compositor = Compositor::started_with(A_DESK_THAT_BLANKS);
    compositor.wait_for_log("nobody is at this desktop; its screens go dark");

    let _film = compositor.client_with("film", &["--hold-the-screens-on-before-it-has-a-window"]);

    compositor
        .wait_for_log("a window appeared under an inhibitor; this desktop's screens come back on");
}

/// A window closed under an inhibitor stops holding, though its client is
/// still there.
///
/// A window is not the client that had it, and this is the only check that can
/// tell the two apart: the client is asked to close by the chrome, destroys
/// its `xdg_toplevel` and keeps the connection, so the surface is alive, the
/// inhibitor is alive, and the only thing that changed is that this desktop
/// has no window for it. A client that *died* reaches the same line by the
/// same path, which is why the last assertion is that this one did not.
#[test]
fn the_screens_go_dark_when_the_window_holding_them_on_is_closed() {
    let compositor = Compositor::started_with(A_DESK_THAT_BLANKS);
    compositor.wait_for_log("nobody is at this desktop; its screens go dark");

    let mut chrome = compositor.chrome();
    let mut film =
        compositor.client_with("film", &["--hold-the-screens-on", "--outlive-its-window"]);
    compositor.wait_for_log("a client is holding this desktop awake");

    let appeared = chrome
        .wait_for(|message| matches!(message, HostMessage::AppAppeared { .. }))
        .expect("the film's window is announced to the chrome");
    let HostMessage::AppAppeared { app_id, .. } = appeared else {
        unreachable!("the wait matched on this variant")
    };
    chrome
        .say(&ChromeMessage::CloseApp { app_id })
        .expect("the chrome socket takes a close");

    compositor.wait_for_log(
        "the window holding this desktop awake is gone; this desktop's screens go dark",
    );
    assert!(
        film.is_running(),
        "the client outlived its window, so what let the screens go was the window and not a death",
    );
}
