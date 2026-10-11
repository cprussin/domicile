//! The pages listening for passphrases the lock did not take, across every
//! chrome connection. A page listens with `SystemRequest::UnlockRefusals`; the
//! compositor sends each refusal. See `docs/LOCK.md`.

use std::time::Duration;

use domicile_protocol::{SystemEvent, UnlockRefusal};

use crate::fanout::Fanout;

/// Every page listening for refusals.
pub type UnlockRefusals = Fanout<Refused>;

/// A passphrase the lock did not take, and how long it refuses the next one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Refused {
    pub refusal: UnlockRefusal,
    /// Refused passphrases, wrong or unverifiable, since the desktop last
    /// opened.
    pub failures: u32,
    pub retry_in: Duration,
}

impl Refused {
    /// The event a listening page hears.
    pub(crate) fn event(&self) -> SystemEvent {
        SystemEvent::UnlockRefused {
            refusal: self.refusal,
            failures: self.failures,
            retry_in_ms: u64::try_from(self.retry_in.as_millis()).expect("a wait fits a u64"),
        }
    }
}
