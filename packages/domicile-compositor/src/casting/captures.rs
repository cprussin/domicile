//! The engine's display captures that monitor and region streams draw from.
//!
//! One capture per display, shared by every stream that shows it, at the
//! display's mode size. A capture stops when its last stream ends. Each keeps
//! its newest frame; see [`crate::casting::captured`] for which frames hold
//! the engine's buffer.

use std::collections::{HashMap, HashSet};

use crate::casting::captured::Kept;
use crate::casting::gpu::Snapshot;
use crate::casting::pacing::Rect;
use crate::casting::StreamId;
use crate::engine::CaptureId;

/// What captures need from the engine. The engine session in the compositor;
/// a fake in tests.
pub trait Capturer {
    /// Starts capturing `display` at `size`, at most `max_fps` a second.
    fn start(&mut self, display: i64, size: (u32, u32), max_fps: u32) -> Result<CaptureId, String>;
    fn resize(&mut self, capture: CaptureId, size: (u32, u32));
    /// Stops a capture. The engine releases its held frames.
    fn stop(&mut self, capture: CaptureId);
    /// Gives a frame's buffer back to the engine.
    fn release(&mut self, capture: CaptureId, frame: u64);
}

/// A display's newest frame.
pub struct Frame {
    pub snapshot: Snapshot,
    /// The part of the frame that shows the display, in frame pixels.
    pub content: Rect,
}

/// Every running capture, by display.
#[derive(Default)]
pub struct Captures {
    running: HashMap<i64, Running>,
}

struct Running {
    capture: CaptureId,
    size: (u32, u32),
    streams: HashSet<StreamId>,
    frame: Option<Frame>,
    /// The engine's frame `frame` samples, if it is sampled in place.
    held: Option<u64>,
}

impl Captures {
    /// Makes `stream` show exactly `displays`, each wanted at its size.
    /// Starts, resizes and stops captures to match.
    ///
    /// On an error, `stream` shows nothing; the caller ends it.
    pub fn show(
        &mut self,
        stream: StreamId,
        displays: &[(i64, (u32, u32))],
        max_fps: u32,
        capturer: &mut dyn Capturer,
    ) -> Result<(), String> {
        for &(display, size) in displays {
            match self.running.get_mut(&display) {
                Some(running) => {
                    if running.size != size {
                        running.size = size;
                        capturer.resize(running.capture, size);
                    }
                    running.streams.insert(stream);
                }
                None => match capturer.start(display, size, max_fps) {
                    Ok(capture) => {
                        self.running.insert(
                            display,
                            Running {
                                capture,
                                size,
                                streams: HashSet::from([stream]),
                                frame: None,
                                held: None,
                            },
                        );
                    }
                    Err(why) => {
                        self.forget(stream, capturer);
                        return Err(why);
                    }
                },
            }
        }
        let shown: HashSet<i64> = displays.iter().map(|&(display, _)| display).collect();
        self.leave(stream, |display| !shown.contains(&display), capturer);
        Ok(())
    }

    /// `stream` ended. Stops captures it alone showed.
    pub fn forget(&mut self, stream: StreamId, capturer: &mut dyn Capturer) {
        self.leave(stream, |_| true, capturer);
    }

    /// The display `capture` shows, if it still runs.
    pub fn display_of(&self, capture: CaptureId) -> Option<i64> {
        self.running
            .iter()
            .find(|(_, running)| running.capture == capture)
            .map(|(&display, _)| display)
    }

    /// The streams that show `display`.
    pub fn streams_of(&self, display: i64) -> Vec<StreamId> {
        self.running
            .get(&display)
            .map(|running| running.streams.iter().copied().collect())
            .unwrap_or_default()
    }

    /// `display`'s newest frame.
    pub fn frame(&self, display: i64) -> Option<&Frame> {
        self.running.get(&display)?.frame.as_ref()
    }

    /// Keeps `frame` of `capture` as its display's newest, and gives back
    /// the buffer the engine no longer needs to hold. A stale capture's frame
    /// goes straight back.
    pub fn keep(
        &mut self,
        capture: CaptureId,
        id: u64,
        frame: Frame,
        kept: Kept,
        capturer: &mut dyn Capturer,
    ) {
        let Some(running) = self
            .running
            .values_mut()
            .find(|running| running.capture == capture)
        else {
            capturer.release(capture, id);
            return;
        };
        running.frame = Some(frame);
        let held = match kept {
            Kept::Copied => {
                capturer.release(capture, id);
                None
            }
            Kept::Sampled => Some(id),
        };
        if let Some(before) = std::mem::replace(&mut running.held, held) {
            capturer.release(capture, before);
        }
    }

    /// The engine ended `capture`. Returns the streams that showed it.
    pub fn ended(&mut self, capture: CaptureId) -> Vec<StreamId> {
        let Some(display) = self.display_of(capture) else {
            return Vec::new();
        };
        self.running
            .remove(&display)
            .map(|running| running.streams.into_iter().collect())
            .unwrap_or_default()
    }

    /// Takes `stream` off the displays `leaving` picks, and stops captures no
    /// stream shows.
    fn leave(
        &mut self,
        stream: StreamId,
        leaving: impl Fn(i64) -> bool,
        capturer: &mut dyn Capturer,
    ) {
        self.running.retain(|&display, running| {
            if leaving(display) {
                running.streams.remove(&stream);
            }
            let used = !running.streams.is_empty();
            if !used {
                capturer.stop(running.capture);
            }
            used
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{Capturer, Captures, Frame};
    use crate::casting::captured::Kept;
    use crate::casting::gpu::Snapshot;
    use crate::casting::StreamId;
    use crate::engine::CaptureId;

    /// What the engine was asked, in order.
    #[derive(Debug, PartialEq)]
    enum Asked {
        Start(i64, (u32, u32)),
        Resize(CaptureId, (u32, u32)),
        Stop(CaptureId),
        Release(CaptureId, u64),
    }

    /// An engine that numbers captures from 1 and refuses display 9.
    #[derive(Default)]
    struct FakeCapturer {
        asked: Vec<Asked>,
        next: CaptureId,
    }

    impl Capturer for FakeCapturer {
        fn start(&mut self, display: i64, size: (u32, u32), _: u32) -> Result<CaptureId, String> {
            self.asked.push(Asked::Start(display, size));
            if display == 9 {
                return Err("no window shows display 9".into());
            }
            self.next += 1;
            Ok(self.next)
        }
        fn resize(&mut self, capture: CaptureId, size: (u32, u32)) {
            self.asked.push(Asked::Resize(capture, size));
        }
        fn stop(&mut self, capture: CaptureId) {
            self.asked.push(Asked::Stop(capture));
        }
        fn release(&mut self, capture: CaptureId, frame: u64) {
            self.asked.push(Asked::Release(capture, frame));
        }
    }

    const FIRST: StreamId = StreamId(1);
    const SECOND: StreamId = StreamId(2);
    const SIZE: (u32, u32) = (1920, 1080);

    fn frame() -> Frame {
        Frame {
            snapshot: Snapshot::Pixels {
                bytes: vec![0; 4],
                stride: 4,
                alpha: false,
                size: (1, 1),
            },
            content: (0, 0, 1, 1),
        }
    }

    #[test]
    fn streams_of_one_display_share_its_capture() {
        let (mut captures, mut engine) = (Captures::default(), FakeCapturer::default());

        captures.show(FIRST, &[(1, SIZE)], 60, &mut engine).unwrap();
        captures
            .show(SECOND, &[(1, SIZE)], 60, &mut engine)
            .unwrap();

        assert_eq!(engine.asked, [Asked::Start(1, SIZE)]);
        assert_eq!(captures.display_of(1), Some(1));
        let mut streams = captures.streams_of(1);
        streams.sort_by_key(|stream| stream.0);
        assert_eq!(streams, [FIRST, SECOND]);
    }

    #[test]
    fn a_capture_stops_with_its_last_stream() {
        let (mut captures, mut engine) = (Captures::default(), FakeCapturer::default());
        captures.show(FIRST, &[(1, SIZE)], 60, &mut engine).unwrap();
        captures
            .show(SECOND, &[(1, SIZE)], 60, &mut engine)
            .unwrap();

        captures.forget(FIRST, &mut engine);
        assert_eq!(engine.asked.len(), 1);
        captures.forget(SECOND, &mut engine);

        assert_eq!(engine.asked[1..], [Asked::Stop(1)]);
        assert_eq!(captures.display_of(1), None);
    }

    #[test]
    fn a_new_mode_resizes_the_capture_and_a_display_left_behind_stops() {
        let (mut captures, mut engine) = (Captures::default(), FakeCapturer::default());
        captures
            .show(FIRST, &[(1, SIZE), (2, SIZE)], 60, &mut engine)
            .unwrap();

        captures
            .show(FIRST, &[(1, (2560, 1440))], 60, &mut engine)
            .unwrap();

        assert_eq!(
            engine.asked[2..],
            [Asked::Resize(1, (2560, 1440)), Asked::Stop(2)]
        );
    }

    #[test]
    fn a_refused_capture_leaves_the_stream_showing_nothing() {
        let (mut captures, mut engine) = (Captures::default(), FakeCapturer::default());

        let refused = captures.show(FIRST, &[(1, SIZE), (9, SIZE)], 60, &mut engine);

        assert!(refused.is_err());
        assert_eq!(engine.asked.last(), Some(&Asked::Stop(1)));
        assert!(captures.streams_of(1).is_empty());
    }

    #[test]
    fn a_copied_frame_goes_back_at_once_and_a_sampled_one_when_replaced() {
        let (mut captures, mut engine) = (Captures::default(), FakeCapturer::default());
        captures.show(FIRST, &[(1, SIZE)], 60, &mut engine).unwrap();

        captures.keep(1, 10, frame(), Kept::Copied, &mut engine);
        captures.keep(1, 11, frame(), Kept::Sampled, &mut engine);
        assert_eq!(engine.asked[1..], [Asked::Release(1, 10)]);
        captures.keep(1, 12, frame(), Kept::Sampled, &mut engine);

        assert_eq!(engine.asked[2..], [Asked::Release(1, 11)]);
        assert!(captures.frame(1).is_some());
    }

    #[test]
    fn a_frame_of_a_stopped_capture_goes_straight_back() {
        let (mut captures, mut engine) = (Captures::default(), FakeCapturer::default());

        captures.keep(5, 10, frame(), Kept::Sampled, &mut engine);

        assert_eq!(engine.asked, [Asked::Release(5, 10)]);
    }

    #[test]
    fn a_capture_the_engine_ended_names_its_streams_and_is_gone() {
        let (mut captures, mut engine) = (Captures::default(), FakeCapturer::default());
        captures.show(FIRST, &[(1, SIZE)], 60, &mut engine).unwrap();

        assert_eq!(captures.ended(1), [FIRST]);

        assert_eq!(captures.display_of(1), None);
        assert!(captures.frame(1).is_none());
    }
}
