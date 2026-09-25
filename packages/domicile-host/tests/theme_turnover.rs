//! The order a desk turns over in: the chromes, then -- once every chrome has
//! captured the frame its wipe starts from -- the windows, then word that the
//! windows have repainted.

use domicile_host::theme_turnover::{Step, Turnover};
use domicile_protocol::Theme;

#[test]
fn the_windows_wait_for_every_chrome_to_capture() {
    let (mut turnover, step) = Turnover::begin(Theme::Light, ["left", "right"]);
    assert_eq!(step, Step::Wait);

    assert_eq!(turnover.captured(&"left", Theme::Light), Step::Wait);
    assert_eq!(turnover.captured(&"right", Theme::Light), Step::Announce);
}

#[test]
fn a_desk_with_no_chrome_turns_its_windows_at_once() {
    let (_, step) = Turnover::<&str>::begin(Theme::Light, []);
    assert_eq!(step, Step::Announce);
}

#[test]
fn a_capture_for_another_theme_is_not_counted() {
    // A capture that was in flight when the theme moved again is a frame
    // held for a turnover that no longer exists.
    let (mut turnover, _) = Turnover::begin(Theme::Light, ["left"]);
    assert_eq!(turnover.captured(&"left", Theme::Dark), Step::Wait);
}

#[test]
fn a_chrome_that_never_captures_holds_the_windows_only_until_the_deadline() {
    // An old shell, or one whose page is not a ThemeProvider at all, never
    // sends a capture. Its windows still turn -- late, and without a wipe.
    let (mut turnover, _) = Turnover::begin(Theme::Light, ["left"]);
    assert_eq!(turnover.capture_deadline(), Step::Announce);
}

#[test]
fn the_desk_is_turned_once_every_window_has_repainted() {
    let (mut turnover, _) = Turnover::<&str>::begin(Theme::Light, []);
    assert_eq!(
        turnover.announced(["app-1".to_string(), "app-2".to_string()]),
        Step::Wait
    );

    assert_eq!(turnover.repainted("app-1"), Step::Wait);
    assert_eq!(turnover.repainted("app-2"), Step::Turned);
}

#[test]
fn a_desk_with_no_windows_is_turned_as_soon_as_it_is_announced() {
    let (mut turnover, _) = Turnover::<&str>::begin(Theme::Light, []);
    assert_eq!(turnover.announced([]), Step::Turned);
}

#[test]
fn a_window_that_never_repaints_holds_the_desk_only_until_the_deadline() {
    let (mut turnover, _) = Turnover::<&str>::begin(Theme::Light, []);
    turnover.announced(["app-1".to_string()]);
    assert_eq!(turnover.repaint_deadline(), Step::Turned);
}

#[test]
fn each_deadline_only_ends_its_own_phase() {
    // Both are timers armed on the compositor's loop, and one can outlive its
    // phase: the capture deadline firing while the windows repaint must not
    // cut their repaint short, and the repaint deadline firing while chromes
    // still capture must not turn the windows before they have.
    let (mut capturing, _) = Turnover::begin(Theme::Light, ["left"]);
    assert_eq!(capturing.repaint_deadline(), Step::Wait);

    let (mut repainting, _) = Turnover::<&str>::begin(Theme::Light, []);
    repainting.announced(["app-1".to_string()]);
    assert_eq!(repainting.capture_deadline(), Step::Wait);
}

#[test]
fn a_repaint_before_the_announcement_is_not_counted() {
    // A window committing while the chromes are still capturing drew the
    // theme it already had.
    let (mut turnover, _) = Turnover::begin(Theme::Light, ["left"]);
    assert_eq!(turnover.repainted("app-1"), Step::Wait);
    assert_eq!(turnover.captured(&"left", Theme::Light), Step::Announce);
    assert_eq!(turnover.announced(["app-1".to_string()]), Step::Wait);
}
