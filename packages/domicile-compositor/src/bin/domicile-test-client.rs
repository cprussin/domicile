//! The stand-in Wayland client, built where the tests that spawn it are.
//!
//! Nothing of the client is here — it is all `domicile-test-client`, whose
//! `lib.rs` says what it is and why it exists. What is here is the *target*,
//! and it is here because cargo builds a package's binaries whenever it builds
//! that package's tests: with this, `cargo test -p domicile-compositor` has a
//! client to start, and without it the tests passed or failed according to
//! which cargo command someone had run before them.

fn main() -> std::process::ExitCode {
    domicile_test_client::run(std::env::args_os().skip(1))
}
