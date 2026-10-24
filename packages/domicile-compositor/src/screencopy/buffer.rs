//! What a client's buffer holds, as a cast's frames are laid out.
//!
//! A cast's pixels are blue, green, red and a fourth byte (see
//! [`Pixel`]), which is `wl_shm`'s `argb8888` and `xrgb8888` on a
//! little-endian machine. Rows are packed, so an shm buffer's stride must be
//! four bytes a pixel and a frame copies in one piece.

use smithay::backend::allocator::Buffer as _;
use smithay::reexports::wayland_server::protocol::wl_buffer::WlBuffer;
use smithay::reexports::wayland_server::protocol::wl_shm::Format;
use smithay::wayland::dmabuf::get_dmabuf;
use smithay::wayland::shm::{with_buffer_contents, BufferData};

use super::taking::Layout;
use crate::casting::{fourcc, Pixel};

/// The stride of an shm frame `width` pixels across.
pub fn stride(width: u32) -> u32 {
    width * 4
}

/// The `wl_shm` format `pixel` is.
pub fn shm_format(pixel: Pixel) -> Format {
    match pixel {
        Pixel::Bgra => Format::Argb8888,
        Pixel::Bgrx => Format::Xrgb8888,
    }
}

/// What `buffer` holds, or `None` for a buffer no cast fills.
pub fn layout_of(buffer: &WlBuffer) -> Option<Layout> {
    if let Ok(dmabuf) = get_dmabuf(buffer) {
        let format = dmabuf.format();
        let pixel = [Pixel::Bgrx, Pixel::Bgra]
            .into_iter()
            .find(|&pixel| fourcc(pixel) == format.code as u32)?;
        let size = dmabuf.size();
        return Some(Layout::Dmabuf {
            pixel,
            size: (size.w as u32, size.h as u32),
            modifier: format.modifier.into(),
        });
    }
    // A bad map has already disconnected the client.
    with_buffer_contents(buffer, |_, _, data| shm_layout(&data))
        .ok()
        .flatten()
}

/// What an shm buffer laid out as `data` holds, if a cast fills it.
fn shm_layout(data: &BufferData) -> Option<Layout> {
    let pixel = match data.format {
        Format::Argb8888 => Pixel::Bgra,
        Format::Xrgb8888 => Pixel::Bgrx,
        _ => return None,
    };
    let size = (
        u32::try_from(data.width).ok()?,
        u32::try_from(data.height).ok()?,
    );
    (data.stride == stride(size.0) as i32).then_some(Layout::Shm { pixel, size })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn laid_out(format: Format, width: i32, height: i32, stride: i32) -> BufferData {
        BufferData {
            offset: 0,
            width,
            height,
            stride,
            format,
        }
    }

    #[test]
    fn a_packed_buffer_of_either_format_is_filled() {
        assert_eq!(
            shm_layout(&laid_out(Format::Argb8888, 3, 2, 12)),
            Some(Layout::Shm {
                pixel: Pixel::Bgra,
                size: (3, 2)
            })
        );
        assert_eq!(
            shm_layout(&laid_out(Format::Xrgb8888, 3, 2, 12)),
            Some(Layout::Shm {
                pixel: Pixel::Bgrx,
                size: (3, 2)
            })
        );
    }

    #[test]
    fn a_buffer_of_another_format_or_stride_is_not() {
        assert_eq!(shm_layout(&laid_out(Format::Rgb565, 3, 2, 12)), None);
        assert_eq!(shm_layout(&laid_out(Format::Argb8888, 3, 2, 16)), None);
    }
}
