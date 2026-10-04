//! Detects that a new engine replaced the one this compositor joined.
//!
//! The C ABI (`domicile_engine.h`) has no disconnect callback, so a dead
//! browser just goes silent. Instead, the compositor compares the pid of the
//! process that dials each shell control channel. The browser process dials it
//! (see
//! `packages/domicile-engine/src/components/domicile/browser/control_channel.h`),
//! and `SO_PEERCRED` gives a pid the page cannot fake.
//!
//! - `domicile load-shell` and extra pages (one per CRTC) come from the same
//!   browser, so they keep the same pid and do not trigger a rejoin.
//! - Missing a new engine leaves every window blank for good, while a needless
//!   rejoin only re-brokers sinks and re-imports buffers (see
//!   `EngineSession::reconnect`). The pid errs toward rejoining.
//!
//! See "Engine crashes are recovered" in
//! `docs/architecture/THE-DOMICILE-BINARY.md`.

/// Whether the page saying hello comes from a different engine than the one
/// this compositor joined.
///
/// `joined` is the pid that served the last hello, or `None` before the first
/// one. `saying_hello` is `None` when the kernel gave no credential; that
/// counts as the same engine, so a missing pid never takes windows down.
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
        // `domicile load-shell`: a new control channel from the same browser.
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
