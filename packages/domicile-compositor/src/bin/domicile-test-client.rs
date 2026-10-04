//! The test Wayland client's binary target. The code is in
//! `domicile-test-client`.
//!
//! Declared in this package so cargo builds it before this package's tests.

fn main() -> std::process::ExitCode {
    domicile_test_client::run(std::env::args_os().skip(1))
}
