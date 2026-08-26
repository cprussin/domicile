//! A stand-in Wayland client: what a test opens a window with.
//!
//! The binary is `src/main.rs`; this exists so the command line can be tested
//! without a compositor to open a window on. What the window *does* is the
//! business of the checks in `scripts/`, which have one to point at.

pub mod arguments;
