//! Records a screen cast to a WebM file: the cast's video node and, when it
//! has one, its sound node, from PipeWire.
//!
//! The compositor starts `domicile-recorder` for each screen recording and
//! controls it over stdin, one [`Command`] a line. A pause stops the
//! pipeline's clock, so the file has no gap where the recording was paused.
//! See `docs/PORTALS.md`.

pub mod args;
pub mod command;
pub mod pipeline;
pub mod recording;
