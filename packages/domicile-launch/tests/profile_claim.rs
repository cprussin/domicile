//! Which profile a desktop takes while others are running.

use domicile_launch::profile_claim::claim;

#[test]
fn the_first_desktop_takes_the_kept_profile() {
    let state = tempfile::tempdir().expect("a directory");
    // The state home does not exist yet, as on a first run.
    let kept = state.path().join("domicile").join("profile");

    assert_eq!(claim(&kept).expect("it is claimed").path, kept);
}

#[test]
fn a_desktop_beside_a_running_one_takes_the_next_profile() {
    let state = tempfile::tempdir().expect("a directory");
    let kept = state.path().join("profile");

    let first = claim(&kept).expect("it is claimed");
    let second = claim(&kept).expect("it is claimed");
    let third = claim(&kept).expect("it is claimed");

    assert_eq!(first.path, kept);
    assert_eq!(second.path, state.path().join("profile-2"));
    assert_eq!(third.path, state.path().join("profile-3"));
}

#[test]
fn a_profile_a_desktop_let_go_of_is_taken_again() {
    let state = tempfile::tempdir().expect("a directory");
    let kept = state.path().join("profile");

    drop(claim(&kept).expect("it is claimed"));

    assert_eq!(claim(&kept).expect("it is claimed").path, kept);
}
