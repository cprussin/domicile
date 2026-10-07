//! Keeps a monitor's captured frame for the streams that show it.
//!
//! A shared memory frame is copied out, so its buffer goes back to the engine
//! at once. A dmabuf frame is sampled where it is, so its buffer is held until
//! the next frame replaces it.

use std::os::fd::AsRawFd as _;

use smithay::backend::allocator::dmabuf::{Dmabuf, DmabufFlags};
use smithay::backend::allocator::{Fourcc, Modifier};
use smithay::backend::renderer::gles::GlesRenderer;
use smithay::backend::renderer::ImportDma as _;

use crate::casting::gpu::{FillError, Snapshot};
use crate::casting::negotiation::BYTES_PER_PIXEL;
use crate::engine::{CapturedFrame, CapturedPixels};

/// DRM fourccs of the engine's captures.
const ARGB8888: u32 = 0x3432_5241;
const XRGB8888: u32 = 0x3432_5258;
const ABGR8888: u32 = 0x3432_4241;
const XBGR8888: u32 = 0x3432_4258;

/// Whether a frame's buffer must stay with the compositor.
#[derive(Debug, PartialEq, Eq)]
pub enum Kept {
    /// Copied out: give the buffer back now.
    Copied,
    /// Sampled in place: hold the buffer until the next frame.
    Sampled,
}

/// Keeps `frame`'s pixels.
pub fn snapshot(
    frame: &CapturedFrame,
    renderer: Option<&mut GlesRenderer>,
) -> Result<(Snapshot, Kept), FillError> {
    match &frame.pixels {
        CapturedPixels::Shm { fd, stride } => {
            let stride = *stride as usize;
            let length = stride * frame.size.1 as usize;
            // SAFETY: maps `length` bytes of the engine's frame for reading;
            // unmapped below.
            let mapped = unsafe {
                libc::mmap(
                    std::ptr::null_mut(),
                    length,
                    libc::PROT_READ,
                    libc::MAP_SHARED,
                    fd.0.as_raw_fd(),
                    0,
                )
            };
            if mapped == libc::MAP_FAILED {
                return Err(FillError::Map(std::io::Error::last_os_error()));
            }
            // SAFETY: the mapping is `length` readable bytes until unmapped.
            let bytes = unsafe { std::slice::from_raw_parts(mapped.cast::<u8>(), length) };
            let kept = pixels(bytes, stride, frame.size, frame.fourcc);
            // SAFETY: the mapping made above, no longer borrowed.
            unsafe { libc::munmap(mapped, length) };
            Ok((kept?, Kept::Copied))
        }
        CapturedPixels::Dmabuf { modifier, planes } => {
            let fourcc =
                Fourcc::try_from(frame.fourcc).map_err(|_| FillError::Format(frame.fourcc))?;
            let mut builder = Dmabuf::builder(
                (frame.size.0 as i32, frame.size.1 as i32),
                fourcc,
                Modifier::from(*modifier),
                DmabufFlags::empty(),
            );
            for (index, plane) in planes.iter().enumerate() {
                let fd = plane.fd.0.try_clone().map_err(FillError::Map)?;
                builder.add_plane(fd, index as u32, plane.offset, plane.stride);
            }
            let dmabuf = builder.build().ok_or(FillError::Dmabuf)?;
            let texture = renderer
                .ok_or(FillError::NoGpu)?
                .import_dmabuf(&dmabuf, None)?;
            Ok((Snapshot::Texture(texture), Kept::Sampled))
        }
    }
}

/// A `Bgra` copy of a frame in shared memory, rows packed.
fn pixels(
    bytes: &[u8],
    stride: usize,
    size: (u32, u32),
    fourcc: u32,
) -> Result<Snapshot, FillError> {
    let (alpha, swap) = match fourcc {
        ARGB8888 => (true, false),
        XRGB8888 => (false, false),
        ABGR8888 => (true, true),
        XBGR8888 => (false, true),
        other => return Err(FillError::Format(other)),
    };
    let row = size.0 as usize * BYTES_PER_PIXEL as usize;
    let mut packed: Vec<u8> = (0..size.1 as usize)
        .flat_map(|y| &bytes[y * stride..y * stride + row])
        .copied()
        .collect();
    if swap {
        packed
            .as_chunks_mut::<{ BYTES_PER_PIXEL as usize }>()
            .0
            .iter_mut()
            .for_each(|pixel| pixel.swap(0, 2));
    }
    Ok(Snapshot::Pixels {
        bytes: packed,
        stride: row,
        alpha,
        size,
    })
}

#[cfg(test)]
mod tests {
    use super::{pixels, ABGR8888, ARGB8888, XBGR8888};
    use crate::casting::gpu::{FillError, Snapshot};

    /// A 2x1 frame with a padding byte pair a row: red, then green, in the
    /// byte order of `fourcc`'s `R G B A` positions.
    fn frame(red_first: bool) -> Vec<u8> {
        let (red, green) = if red_first {
            ([255, 0, 0, 200], [0, 255, 0, 200])
        } else {
            ([0, 0, 255, 200], [0, 255, 0, 200])
        };
        [red.as_slice(), green.as_slice(), &[0xee, 0xee]].concat()
    }

    fn kept(snapshot: Snapshot) -> (Vec<u8>, usize, bool, (u32, u32)) {
        let Snapshot::Pixels {
            bytes,
            stride,
            alpha,
            size,
        } = snapshot
        else {
            panic!("a shared memory frame is kept on the CPU");
        };
        (bytes, stride, alpha, size)
    }

    #[test]
    fn a_bgra_frame_is_kept_as_it_is_less_its_padding() {
        let snapshot = pixels(&frame(false), 10, (2, 1), ARGB8888).expect("kept");

        assert_eq!(
            kept(snapshot),
            ([0, 0, 255, 200, 0, 255, 0, 200].to_vec(), 8, true, (2, 1))
        );
    }

    #[test]
    fn an_rgba_frame_is_turned_to_bgra() {
        let snapshot = pixels(&frame(true), 10, (2, 1), ABGR8888).expect("kept");

        assert_eq!(kept(snapshot).0, [0, 0, 255, 200, 0, 255, 0, 200]);
    }

    #[test]
    fn a_frame_without_alpha_says_so() {
        let snapshot = pixels(&frame(true), 10, (2, 1), XBGR8888).expect("kept");

        assert!(!kept(snapshot).2);
    }

    #[test]
    fn a_format_the_engine_does_not_capture_in_is_refused() {
        assert!(matches!(
            pixels(&frame(true), 10, (2, 1), 0x3231_564e),
            Err(FillError::Format(0x3231_564e))
        ));
    }
}
