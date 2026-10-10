//! What a client's buffer must be for a shot to be copied into it.
//!
//! A shot's bytes are blue, green, red, alpha (see
//! [`domicile_host::screenshot::Shot`]), which is `wl_shm`'s `argb8888` and
//! `xrgb8888` on a little-endian machine. Rows are packed, so the buffer's
//! stride must be four bytes a pixel and a shot copies in one piece.

use smithay::reexports::wayland_server::protocol::wl_shm::Format;
use smithay::wayland::shm::BufferData;

/// The `wl_shm` formats a capture offers.
pub const FORMATS: [Format; 2] = [Format::Argb8888, Format::Xrgb8888];

/// The stride of a shot `width` pixels across.
pub fn stride(width: u32) -> u32 {
    width * 4
}

/// Whether a shm buffer laid out as `data` takes a shot `size` big.
pub fn fits(data: &BufferData, size: (u32, u32)) -> bool {
    FORMATS.contains(&data.format)
        && (data.width, data.height) == (size.0 as i32, size.1 as i32)
        && data.stride == stride(size.0) as i32
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
    fn a_buffer_fits_in_either_format_at_the_shots_size_and_stride() {
        assert!(fits(&laid_out(Format::Argb8888, 3, 2, 12), (3, 2)));
        assert!(fits(&laid_out(Format::Xrgb8888, 3, 2, 12), (3, 2)));
    }

    #[test]
    fn a_buffer_of_another_format_size_or_stride_does_not_fit() {
        assert!(!fits(&laid_out(Format::Rgb565, 3, 2, 12), (3, 2)));
        assert!(!fits(&laid_out(Format::Argb8888, 2, 2, 8), (3, 2)));
        assert!(!fits(&laid_out(Format::Argb8888, 3, 3, 12), (3, 2)));
        assert!(!fits(&laid_out(Format::Argb8888, 3, 2, 16), (3, 2)));
    }
}
