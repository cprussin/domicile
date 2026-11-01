//! Keeps video timestamps strictly increasing.
//!
//! `av1parse` drops a frame stamped the same as the one before it, and every
//! later frame that refers to it then fails to decode until the next key
//! frame. A cast at full rate sometimes delivers two frames with one stamp.

/// The last timestamp let through, in nanoseconds.
#[derive(Debug, Default)]
pub struct Stamps {
    last: Option<u64>,
}

impl Stamps {
    /// `pts`, or one nanosecond after the last timestamp when `pts` is not
    /// later than it.
    pub fn next(&mut self, pts: u64) -> u64 {
        let next = self.last.map_or(pts, |last| pts.max(last + 1));
        self.last = Some(next);
        next
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn later_timestamps_pass_unchanged() {
        let mut stamps = Stamps::default();

        assert_eq!([stamps.next(10), stamps.next(20)], [10, 20]);
    }

    #[test]
    fn a_repeated_timestamp_moves_one_nanosecond_later() {
        let mut stamps = Stamps::default();
        stamps.next(10);

        assert_eq!([stamps.next(10), stamps.next(10)], [11, 12]);
    }

    #[test]
    fn an_earlier_timestamp_moves_after_the_last() {
        let mut stamps = Stamps::default();
        stamps.next(10);

        assert_eq!(stamps.next(5), 11);
    }
}
