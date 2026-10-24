//! A Wayland capture client's side of a cast: what it may capture into, and
//! which of its buffers the cast fills.
//!
//! A cast fills a client's buffers as it fills PipeWire's (see
//! [`crate::casting`]). Capturing a frame lends the cast the frame's buffer,
//! and the cast fills it once there is damage the client has not seen.
//! Generic over the buffer so the rules are tested without a client.

use crate::casting::{BufferId, Offered, Pixel, StreamFormat};

/// What a client is told it may capture into.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Constraints {
    pub size: (u32, u32),
    pub shm: Vec<Pixel>,
    /// Each dmabuf layout, with the modifiers it may have.
    pub dmabufs: Vec<(Pixel, Vec<u64>)>,
}

/// What a buffer a client captures into holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layout {
    Shm {
        pixel: Pixel,
        size: (u32, u32),
    },
    Dmabuf {
        pixel: Pixel,
        size: (u32, u32),
        modifier: u64,
    },
}

/// What the cast hears of a capture, in order.
#[derive(Debug, PartialEq, Eq)]
pub enum Lending {
    /// The buffers hold this format now, and every buffer added before is
    /// gone.
    Format(StreamFormat),
    Added(BufferId),
    Lent(BufferId),
}

/// One cast's client buffers.
pub struct Taking<B> {
    /// `None` until the cast starts.
    constraints: Option<Constraints>,
    /// Whether a dmabuf's modifier must be one offered. A `wlr-screencopy`
    /// client is offered no modifiers, so it may bring any.
    checks_modifiers: bool,
    format: Option<StreamFormat>,
    buffers: Vec<(B, BufferId)>,
    next: u32,
    capturing: Option<BufferId>,
}

impl<B: Clone + PartialEq> Taking<B> {
    pub fn new(checks_modifiers: bool) -> Self {
        Self {
            constraints: None,
            checks_modifiers,
            format: None,
            buffers: Vec::new(),
            next: 0,
            capturing: None,
        }
    }

    /// The cast started at `size`, offering `offered`.
    pub fn started(&mut self, size: (u32, u32), offered: &[Offered]) -> Constraints {
        let mut constraints = Constraints {
            size,
            shm: Vec::new(),
            dmabufs: Vec::new(),
        };
        for offered in offered {
            match offered {
                Offered::Shm { pixel } => constraints.shm.push(*pixel),
                Offered::Dmabuf { pixel, modifiers } => {
                    constraints.dmabufs.push((*pixel, modifiers.clone()));
                }
            }
        }
        self.constraints = Some(constraints.clone());
        constraints
    }

    /// What the client was last told, if the cast has started.
    pub fn constraints(&self) -> Option<&Constraints> {
        self.constraints.as_ref()
    }

    /// The source changed size. Returns the new constraints, and whether the
    /// capture under way fails for it.
    pub fn resized(&mut self, size: (u32, u32)) -> (Constraints, bool) {
        let constraints = self
            .constraints
            .as_mut()
            .expect("a cast resizes once started");
        constraints.size = size;
        (constraints.clone(), self.capturing.take().is_some())
    }

    /// Lends the cast `buffer`, laid out as `layout`. `None` when the buffer
    /// is not one the client was told it may use.
    pub fn capture(&mut self, buffer: B, layout: Layout) -> Option<Vec<Lending>> {
        let format = self.fitting(layout)?;
        let mut lending = Vec::new();
        if self.format != Some(format) {
            self.format = Some(format);
            self.buffers.clear();
            lending.push(Lending::Format(format));
        }
        let id = match self.buffers.iter().find(|(known, _)| *known == buffer) {
            Some((_, id)) => *id,
            None => {
                let id = BufferId(self.next);
                self.next += 1;
                self.buffers.push((buffer, id));
                lending.push(Lending::Added(id));
                id
            }
        };
        lending.push(Lending::Lent(id));
        self.capturing = Some(id);
        Some(lending)
    }

    /// The cast filled `buffer`. Returns the client's buffer, if a capture
    /// still waits on it.
    pub fn filled(&mut self, buffer: BufferId) -> Option<B> {
        if self.capturing != Some(buffer) {
            return None;
        }
        self.capturing = None;
        self.buffers
            .iter()
            .find(|(_, id)| *id == buffer)
            .map(|(known, _)| known.clone())
    }

    /// The capture under way was given up. Returns the buffer to take back
    /// from the cast, which forgets it.
    pub fn abandoned(&mut self) -> Option<BufferId> {
        let id = self.capturing.take()?;
        self.buffers.retain(|(_, known)| *known != id);
        Some(id)
    }

    /// The stream format `layout` is, if it is one the client may use.
    fn fitting(&self, layout: Layout) -> Option<StreamFormat> {
        let constraints = self.constraints.as_ref()?;
        let (pixel, size, modifier) = match layout {
            Layout::Shm { pixel, size } => {
                constraints.shm.contains(&pixel).then_some(())?;
                (pixel, size, None)
            }
            Layout::Dmabuf {
                pixel,
                size,
                modifier,
            } => {
                let (_, modifiers) = constraints
                    .dmabufs
                    .iter()
                    .find(|(offered, _)| *offered == pixel)?;
                (!self.checks_modifiers || modifiers.contains(&modifier)).then_some(())?;
                (pixel, size, Some(modifier))
            }
        };
        (size == constraints.size).then_some(StreamFormat {
            pixel,
            size,
            modifier,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHM: Layout = Layout::Shm {
        pixel: Pixel::Bgrx,
        size: (4, 2),
    };

    fn offered() -> Vec<Offered> {
        vec![
            Offered::Dmabuf {
                pixel: Pixel::Bgra,
                modifiers: vec![7],
            },
            Offered::Shm { pixel: Pixel::Bgrx },
        ]
    }

    fn started(checks_modifiers: bool) -> Taking<&'static str> {
        let mut taking = Taking::new(checks_modifiers);
        taking.started((4, 2), &offered());
        taking
    }

    fn dmabuf(modifier: u64) -> Layout {
        Layout::Dmabuf {
            pixel: Pixel::Bgra,
            size: (4, 2),
            modifier,
        }
    }

    fn format(layout: Layout) -> StreamFormat {
        match layout {
            Layout::Shm { pixel, size } => StreamFormat {
                pixel,
                size,
                modifier: None,
            },
            Layout::Dmabuf {
                pixel,
                size,
                modifier,
            } => StreamFormat {
                pixel,
                size,
                modifier: Some(modifier),
            },
        }
    }

    #[test]
    fn a_client_is_offered_the_casts_size_and_formats() {
        assert_eq!(
            Taking::<&str>::new(true).started((4, 2), &offered()),
            Constraints {
                size: (4, 2),
                shm: vec![Pixel::Bgrx],
                dmabufs: vec![(Pixel::Bgra, vec![7])],
            }
        );
    }

    #[test]
    fn a_buffer_is_added_once_and_lent_for_each_capture() {
        let mut taking = started(true);

        assert_eq!(
            taking.capture("a", SHM),
            Some(vec![
                Lending::Format(format(SHM)),
                Lending::Added(BufferId(0)),
                Lending::Lent(BufferId(0)),
            ])
        );
        assert_eq!(taking.filled(BufferId(0)), Some("a"));
        assert_eq!(
            taking.capture("b", SHM),
            Some(vec![
                Lending::Added(BufferId(1)),
                Lending::Lent(BufferId(1))
            ])
        );
        assert_eq!(taking.filled(BufferId(1)), Some("b"));
        assert_eq!(
            taking.capture("a", SHM),
            Some(vec![Lending::Lent(BufferId(0))])
        );
    }

    #[test]
    fn another_format_forgets_every_buffer() {
        let mut taking = started(true);
        taking.capture("a", SHM).expect("fits");
        taking.filled(BufferId(0));

        assert_eq!(
            taking.capture("a", dmabuf(7)),
            Some(vec![
                Lending::Format(format(dmabuf(7))),
                Lending::Added(BufferId(1)),
                Lending::Lent(BufferId(1)),
            ])
        );
    }

    #[test]
    fn a_buffer_the_client_was_not_offered_does_not_fit() {
        let mut taking = started(true);

        let small = Layout::Shm {
            pixel: Pixel::Bgrx,
            size: (2, 2),
        };
        let unoffered = Layout::Shm {
            pixel: Pixel::Bgra,
            size: (4, 2),
        };
        assert_eq!(taking.capture("a", small), None);
        assert_eq!(taking.capture("a", unoffered), None);
        assert_eq!(taking.capture("a", dmabuf(8)), None);
        assert_eq!(
            Taking::new(true).capture("a", SHM),
            None,
            "before the start"
        );
    }

    #[test]
    fn a_wlr_client_may_bring_any_modifier() {
        assert!(started(false).capture("a", dmabuf(8)).is_some());
    }

    #[test]
    fn a_resize_fails_the_capture_under_way_and_takes_the_new_size() {
        let mut taking = started(true);
        taking.capture("a", SHM).expect("fits");

        let (constraints, failed) = taking.resized((8, 4));

        assert_eq!(constraints.size, (8, 4));
        assert!(failed);
        assert_eq!(taking.filled(BufferId(0)), None, "nothing waits on it");
        assert_eq!(taking.capture("a", SHM), None, "the old size");
    }

    #[test]
    fn an_abandoned_capture_gives_its_buffer_back_and_forgets_it() {
        let mut taking = started(true);
        taking.capture("a", SHM).expect("fits");

        assert_eq!(taking.abandoned(), Some(BufferId(0)));
        assert_eq!(taking.abandoned(), None);
        assert_eq!(
            taking.capture("a", SHM),
            Some(vec![
                Lending::Added(BufferId(1)),
                Lending::Lent(BufferId(1))
            ])
        );
    }
}
