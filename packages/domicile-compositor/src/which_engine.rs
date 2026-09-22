//! Whether the page saying hello is served by the engine this compositor is
//! joined to, or by one that replaced it.
//!
//! **Nothing in the C ABI says the engine went away.** `domicile_engine.h` has
//! four callbacks — configure, frame, released, displays — and none of them is
//! a disconnect; the `mojo::Remote` behind them has no disconnect handler set,
//! so a browser that died leaves the event queue silent rather than saying
//! anything into it. Giving the ABI one is a change to `domicile_engine.cc`,
//! which is the fork, and this compositor cannot make it.
//!
//! So the engine is recognized by the process serving its page instead. The
//! shell's control channel is dialed by the BROWSER process — `ControlChannel`
//! lives there, `packages/domicile-engine/src/components/domicile/browser/control_channel.h`
//! says so where it declares itself — so `SO_PEERCRED` on that connection is
//! the kernel's word for which browser this desktop is talking to, stamped at
//! `connect(2)` and not something a page can claim. A hello from another pid
//! is another engine.
//!
//! **A reloaded page is the case this exists to NOT fire on.** `domicile
//! load-shell` makes the same browser bind a new control channel, so a hello
//! arrives with the same pid and nothing is re-dialed — which is what keeps
//! the promise THE-DOMICILE-BINARY.md makes about swapping a shell: the
//! compositor never hears about it and the windows never move. Several pages
//! at once, which is what one browser window per CRTC means, are the same
//! browser and answer the same way.
//!
//! **The two wrong answers are not equally expensive, and that is why this is
//! the pid.** Missing a new engine leaves every window on the page and
//! permanently blank, because the ids the compositor submits against belong to
//! a mojo graph that no longer exists and nothing anywhere refuses them.
//! Rejoining when nothing changed costs a re-brokered sink and a re-imported
//! buffer per window, and the windows keep the frame they had — see
//! `EngineSession::reconnect`, which puts each one back up. So the reading
//! that is trusted is the one that cannot quietly say "same engine": a pid
//! that changed is a different process, full stop, and only pid reuse inside
//! one restart could say otherwise.

/// Whether the page saying hello is served by an engine other than the one
/// this compositor joined.
///
/// `joined` is the process that served the last page to say hello, or `None`
/// before any has — the first page of a run is the engine this compositor
/// dialed at startup, so there is nothing to rejoin.
///
/// `saying_hello` is `None` where the kernel would not give the credential,
/// which is an attribution lost rather than an engine replaced: rejoining on a
/// reading that is not there would take every window down over a missing pid.
pub fn another_engine(joined: Option<i32>, saying_hello: Option<i32>) -> bool {
    match (joined, saying_hello) {
        (Some(joined), Some(saying_hello)) => joined != saying_hello,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_page_of_a_run_is_the_engine_that_was_dialed() {
        assert!(!another_engine(None, Some(4321)));
    }

    #[test]
    fn a_page_the_same_browser_reloaded_is_the_same_engine() {
        // `domicile load-shell`: a new control channel from the browser that
        // was already serving, which is a desktop swapping its shell rather
        // than losing its engine.
        assert!(!another_engine(Some(4321), Some(4321)));
    }

    #[test]
    fn a_page_another_browser_is_serving_is_another_engine() {
        assert!(another_engine(Some(4321), Some(4322)));
    }

    #[test]
    fn a_credential_the_kernel_would_not_give_is_not_an_engine_that_changed() {
        assert!(!another_engine(Some(4321), None));
    }
}
