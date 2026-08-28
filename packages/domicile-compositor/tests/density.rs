//! The HiDPI chain, from a chrome's `devicePixelRatio` to the frame it gets
//! back.
//!
//! Ported from `scripts/e2e-hidpi.sh`, deleted in the change that added this
//! file. `desktop.rs`'s `a_density_one_chrome_reports_is_described_to_the_others`
//! is the first link and stays there: it is about what the *chromes* are told,
//! and every chrome hearing a density one of them reported is its own rule.
//! This is the rest of the chain, which needs a real Wayland client.
//!
//! Break any link and a screenshot looks the same — slightly soft text — so
//! each is asserted where it can be seen rather than at the end.
//!
//! # What was uncovered, measured before this file was written
//!
//! Whole workspace, `--no-fail-fast`, each mutation applied on its own:
//!
//! | mutation | killed by |
//! |---|---|
//! | `set_output_scale` drops the chrome's density | `desktop.rs`, already |
//! | `set_output`'s client-visible `Scale::Integer(scale)` forced to 1 | **nothing** |
//! | `AppFrame`'s `scale` forced to 1 | **nothing** |
//! | the resize path's `logical_size` replaced by the raw pixels | **nothing** |
//! | `set_output`'s mode given the logical size rather than the physical one | **nothing** |
//!
//! Four of the five links after the first had no cover at all. Two are worth
//! spelling out, and they are the same split twice.
//!
//! `outputs.rs` does catch a client-visible scale forced to 1, but at
//! `restate_output` — the *described*-desktop path. The density a chrome
//! reports drives `set_output` instead, and that site had nothing.
//!
//! `screens.rs`'s `a_mode_is_the_logical_size_in_physical_pixels` does catch a
//! mode that is not the logical size times the scale, but it pins
//! `Advertised::mode()`'s arithmetic. That `set_output` *calls* it, rather than
//! passing the logical size straight through, is a different claim at a
//! different site, and that one had nothing either. A mode left at the logical
//! size is an `xdg_output.logical_size` of half the desktop: every client told
//! the screen is half the size the chrome lays out against.
//!
//! That link was missing from a first version of this file, which called the
//! chain five links and ported four of the script's five verdicts.
//!
//! A window-following desktop on purpose: `set_output_scale` refuses a chrome's
//! density on a described one, which is `desktop.rs`'s
//! `a_described_desktop_refuses_a_chromes_density`, and there would be no
//! chain to follow.
//!
//! # One check, not two
//!
//! A second was written here and deleted for killing nothing: it started a
//! real client and asserted it redrew at `set_buffer_scale(2)`, which is the
//! script's own third phase. Measured — with it deleted, all four mutations
//! above are still killed by the one below, and it was the sole killer of
//! none.
//!
//! The reason is that the links are chained rather than parallel. The frame's
//! `scale` *is* the buffer scale the client set, so a compositor that
//! advertises the wrong density produces a client that draws at the wrong one
//! and a frame that reports it; there is no mutation that breaks the redraw
//! and leaves the frame right. What that costs is a sharper failure message
//! for one case, which is not coverage — the rule this migration applies
//! everywhere else applies to its own output too.

mod running;

use domicile_protocol::{ChromeMessage, HostMessage};

use crate::running::Compositor;

/// A desktop with no configured displays, so the chrome's density is what sets
/// the scale.
///
/// The size is stated rather than defaulted because the mode assertion below
/// spells the same numbers doubled — 900x600 at density 2 is a 1800x1200 mode
/// — and does not read them from here. Two copies of one number that have to
/// be edited together, which is worth having in one file rather than leaving
/// the expectation here and the config in `domicile-config`'s default.
///
/// Measured, since an earlier version of this sentence claimed the opposite:
/// defaulted, the check *fails* — 1280x800 gives a 2560x1600 mode against a
/// hardcoded 1800x1200. It does not go quietly vacuous.
const FOLLOWING: &str = r#"{ "compositor": { "nested_size": [900, 600] } }"#;

/// The density the chrome reports, and what the client should draw at.
const DENSITY: f64 = 2.0;

/// A chrome past the handshake that has reported [`DENSITY`].
///
/// Waited for through the compositor's own log rather than by sleeping: the
/// client below has to start *after* the scale is advertised, because a client
/// that binds the output first is told scale 1 and only learns better on the
/// next change — which is a race this check has no reason to run.
fn a_chrome_reporting_two(compositor: &Compositor) -> domicile_test_chrome::Chrome {
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(|message| matches!(message, HostMessage::Displays { .. }))
        .expect("the desktop rides with the handshake");
    chrome
        .say(&ChromeMessage::SetDevicePixelRatio { ratio: DENSITY })
        .expect("the chrome reports its density");
    chrome
        .wait_for(|message| match message {
            HostMessage::Displays { displays } => displays.iter().any(|display| display.scale == 2),
            _ => false,
        })
        .expect("the compositor takes the density up and says so");
    chrome
}

/// The mode grows with the density, the frame carries it, and the size the
/// chrome lays out in is the buffer's pixels divided by it.
///
/// The payoff, and the one a screenshot cannot show. The chrome sizes its
/// canvas from `scale` and lays out — and maps every pointer coordinate
/// through — the size in `app_resized`. Reported as the buffer's own pixels,
/// the picture is right and every click lands at half the position it should.
///
/// Three assertions and three sources for the numbers in them, which is worth
/// keeping straight because only one pair is compared against each other.
///
/// The mode is the *desktop's*, so it is literals that have to agree with
/// [`FOLLOWING`]. The scale is the *chrome's*, so the `2` here is a literal
/// that has to agree with [`DENSITY`] — and with the one in
/// [`a_chrome_reporting_two`]. Only the buffer's size is the *client's*, and
/// that is the one compared rather than spelled: `width` against `size[0]`
/// times [`DENSITY`], so a client that redrew at another size still proves the
/// same thing.
///
/// The frame and the resize read off one commit: `app_resized` rides ahead of
/// the frame, so a wait for the frame is a wait for both.
#[test]
fn the_mode_and_the_frame_carry_the_density_and_the_size_is_logical() {
    let compositor = Compositor::started_with(FOLLOWING);
    let mut chrome = a_chrome_reporting_two(&compositor);
    let mut client = compositor.client("app");

    // The mode first, and read from the client rather than from the chrome:
    // it is the half of the advertisement a buffer scale cannot speak for, and
    // the only place it is visible. A mode is physical pixels, so raising the
    // density has to raise it — left at the logical size, `xdg_output` reports
    // half the desktop and every client is told the screen is half the size
    // the chrome lays out against.
    //
    // Its own assertion rather than a second check: it fails for the same
    // reason as the rest of this one — a density that did not reach the output
    // — and a second compositor would buy nothing.
    assert!(
        client.wait_for_trace(&format!(".mode(3, {}, {},", 900 * 2, 600 * 2), 1),
        "the mode did not grow with the density, so every client computes a \
         desktop half the size the chrome is laid out at; it traced:\n{}",
        client.trace()
    );

    let framed = chrome
        .wait_for(|message| matches!(message, HostMessage::AppFrame { scale: 2, .. }))
        .expect(
            "no frame reached the chrome carrying the density it reported, so it has no size to \
             make its canvas",
        );
    let HostMessage::AppFrame { app_id, width, .. } = framed else {
        unreachable!("the wait matched on this variant")
    };

    let resized = chrome
        .wait_for(|message| matches!(message, HostMessage::AppResized { .. }))
        .expect("the chrome is told the size to lay the element out at");
    let HostMessage::AppResized { size, .. } = resized else {
        unreachable!("the wait matched on this variant")
    };

    assert_eq!(
        size[0] * DENSITY,
        f64::from(width),
        "the window {app_id} committed {width} device pixels across and the chrome was told to \
         lay it out at {} — at density {DENSITY} that is the buffer's own pixels rather than \
         logical units, so every pointer coordinate would be off by the scale",
        size[0]
    );
}
