//! Copies a crop of a client's shm frame into a stream's shm buffer.

use crate::casting::negotiation::{Pixel, BYTES_PER_PIXEL};
use crate::casting::pacing::Rect;

/// A client's shm frame: its bytes, row stride and whether its fourth byte is
/// alpha (`Argb8888`) or undefined (`Xrgb8888`).
pub struct Client<'a> {
    pub bytes: &'a [u8],
    pub stride: usize,
    pub alpha: bool,
}

/// Copies `crop` of `client` to the top left of `target`, a `pixel` buffer
/// with rows `stride` bytes apart.
///
/// A `Bgra` stream of a client without alpha gets opaque pixels, since the
/// client's fourth byte is undefined.
pub fn copy(client: &Client, crop: Rect, target: &mut [u8], stride: usize, pixel: Pixel) {
    let (x, y, width, height) = crop;
    let row_bytes = width as usize * BYTES_PER_PIXEL as usize;
    let opaque = pixel == Pixel::Bgra && !client.alpha;
    for row in 0..height as usize {
        let from = (y as usize + row) * client.stride + x as usize * BYTES_PER_PIXEL as usize;
        let to = row * stride;
        let line = &mut target[to..to + row_bytes];
        line.copy_from_slice(&client.bytes[from..from + row_bytes]);
        if opaque {
            line.iter_mut()
                .skip(3)
                .step_by(BYTES_PER_PIXEL as usize)
                .for_each(|alpha| *alpha = 255);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{copy, Client};
    use crate::casting::negotiation::Pixel;

    /// A 3x2 client frame with two bytes of padding a row. Each pixel's bytes
    /// are its column, its row, 7, and 9 as the undefined fourth byte.
    fn client_bytes() -> Vec<u8> {
        (0..2u8)
            .flat_map(|row| {
                (0..3u8)
                    .flat_map(move |column| [column, row, 7, 9])
                    .chain([0xee, 0xee])
            })
            .collect()
    }

    #[test]
    fn copies_the_crop_row_by_row() {
        let bytes = client_bytes();
        let client = Client {
            bytes: &bytes,
            stride: 14,
            alpha: true,
        };
        let mut target = vec![0; 2 * 4 * 2];

        copy(&client, (1, 0, 2, 2), &mut target, 8, Pixel::Bgra);

        assert_eq!(
            target,
            [[1, 0, 7, 9], [2, 0, 7, 9], [1, 1, 7, 9], [2, 1, 7, 9]].concat()
        );
    }

    #[test]
    fn a_client_without_alpha_is_opaque_in_a_stream_with_alpha() {
        let bytes = client_bytes();
        let client = Client {
            bytes: &bytes,
            stride: 14,
            alpha: false,
        };
        let mut target = vec![0; 4];

        copy(&client, (2, 1, 1, 1), &mut target, 4, Pixel::Bgra);

        assert_eq!(target, [2, 1, 7, 255]);
    }
}
