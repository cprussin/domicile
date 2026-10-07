//! A stand-in for the engine's display captures: each frame is one color.
//!
//! `DOMICILE_CAST_TEST_PATTERN` turns it on when no engine is connected, so
//! monitor and region casts can be checked without one. See
//! `docs/COMPOSITOR-DEBUGGING.md`.

use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::os::fd::OwnedFd;
use std::sync::Arc;

use crate::casting::Capturer;
use crate::engine::{CaptureId, CapturedFrame, CapturedPixels, SharedFd};

/// Each pixel, as `DRM_FORMAT_ARGB8888` lays it out: blue, green, red, alpha.
const COLOR: [u8; 4] = [32, 64, 96, 255];

const ARGB8888: u32 = 0x3432_5241;

/// Captures that draw [`COLOR`].
#[derive(Default)]
pub struct TestPattern {
    /// Each running capture's size.
    running: HashMap<CaptureId, (u32, u32)>,
    next_capture: CaptureId,
    next_frame: u64,
}

impl TestPattern {
    /// A frame for each running capture.
    pub fn frames(&mut self) -> Vec<(CaptureId, u64, CapturedFrame)> {
        let running: Vec<_> = self.running.iter().map(|(&id, &size)| (id, size)).collect();
        running
            .into_iter()
            .map(|(capture, size)| {
                self.next_frame += 1;
                (capture, self.next_frame, frame(size))
            })
            .collect()
    }
}

impl Capturer for TestPattern {
    fn start(&mut self, _: i64, size: (u32, u32), _: u32) -> Result<CaptureId, String> {
        self.next_capture += 1;
        self.running.insert(self.next_capture, size);
        Ok(self.next_capture)
    }

    fn resize(&mut self, capture: CaptureId, size: (u32, u32)) {
        self.running.insert(capture, size);
    }

    fn stop(&mut self, capture: CaptureId) {
        self.running.remove(&capture);
    }

    // Each frame has its own memory, freed when the streams drop it.
    fn release(&mut self, _: CaptureId, _: u64) {}
}

/// A frame of `size` in [`COLOR`], in a new `memfd`.
fn frame(size: (u32, u32)) -> CapturedFrame {
    // SAFETY: a valid name, and flags the kernel defines.
    let raw = unsafe { libc::memfd_create(c"domicile-test-pattern".as_ptr(), libc::MFD_CLOEXEC) };
    assert!(
        raw >= 0,
        "memfd_create: {}",
        std::io::Error::last_os_error()
    );
    // SAFETY: a new fd that nothing else owns.
    let fd = unsafe { <OwnedFd as std::os::fd::FromRawFd>::from_raw_fd(raw) };
    File::from(fd.try_clone().expect("a memfd clones"))
        .write_all(&COLOR.repeat((size.0 * size.1) as usize))
        .expect("a memfd takes writes");
    CapturedFrame {
        pixels: CapturedPixels::Shm {
            fd: SharedFd(Arc::new(fd)),
            stride: size.0 * 4,
        },
        size,
        fourcc: ARGB8888,
        content: (0, 0, size.0 as i32, size.1 as i32),
        damage: None,
    }
}

#[cfg(test)]
mod tests {
    use std::fs::File;
    use std::os::unix::fs::FileExt;

    use super::{TestPattern, COLOR};
    use crate::casting::Capturer;
    use crate::engine::CapturedPixels;

    #[test]
    fn each_running_capture_gets_a_frame_of_its_size_in_the_color() {
        let mut pattern = TestPattern::default();
        let first = pattern.start(1, (4, 2), 60).expect("started");
        let second = pattern.start(2, (8, 8), 60).expect("started");
        pattern.resize(first, (2, 2));
        pattern.stop(second);

        let frames = pattern.frames();

        assert_eq!(frames.len(), 1);
        let (capture, _, frame) = &frames[0];
        assert_eq!(capture, &first);
        assert_eq!(frame.size, (2, 2));
        assert_eq!(frame.content, (0, 0, 2, 2));
        let CapturedPixels::Shm { fd, stride } = &frame.pixels else {
            panic!("shm pixels");
        };
        assert_eq!(*stride, 8);
        let mut bytes = vec![0; 16];
        File::from(fd.0.try_clone().expect("cloned"))
            .read_exact_at(&mut bytes, 0)
            .expect("read");
        assert_eq!(bytes, COLOR.repeat(4));
    }

    #[test]
    fn frames_are_numbered_in_order() {
        let mut pattern = TestPattern::default();
        pattern.start(1, (1, 1), 60).expect("started");

        let first = pattern.frames()[0].1;
        let second = pattern.frames()[0].1;

        assert!(second > first);
    }
}
