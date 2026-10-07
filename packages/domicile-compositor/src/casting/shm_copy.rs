//! Copies a crop of a frame on the CPU into a stream's shm buffer.

use crate::casting::negotiation::{Pixel, BYTES_PER_PIXEL};
use crate::casting::pacing::Rect;

/// A client's shm frame: its bytes, row stride and whether its fourth byte is
/// alpha (`Argb8888`) or undefined (`Xrgb8888`).
pub struct Client<'a> {
    pub bytes: &'a [u8],
    pub stride: usize,
    pub alpha: bool,
}

/// Copies `from` of `client` over `to` of `target`, a `pixel` buffer with
/// rows `stride` bytes apart, scaling to the nearest pixel when the two
/// differ in size.
///
/// A `Bgra` stream of a client without alpha gets opaque pixels, since the
/// client's fourth byte is undefined.
pub fn copy(client: &Client, from: Rect, target: &mut [u8], stride: usize, pixel: Pixel, to: Rect) {
    let bytes = BYTES_PER_PIXEL as usize;
    let opaque = pixel == Pixel::Bgra && !client.alpha;
    for row in 0..to.3 as usize {
        let from_row = from.1 as usize + row * from.3 as usize / to.3 as usize;
        let start = (to.1 as usize + row) * stride + to.0 as usize * bytes;
        let line = &mut target[start..start + to.2 as usize * bytes];
        if from.2 == to.2 {
            let source = from_row * client.stride + from.0 as usize * bytes;
            line.copy_from_slice(&client.bytes[source..source + line.len()]);
        } else {
            for (column, out) in line.chunks_exact_mut(bytes).enumerate() {
                let from_column = from.0 as usize + column * from.2 as usize / to.2 as usize;
                let source = from_row * client.stride + from_column * bytes;
                out.copy_from_slice(&client.bytes[source..source + bytes]);
            }
        }
        if opaque {
            line.iter_mut()
                .skip(3)
                .step_by(bytes)
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

        copy(
            &client,
            (1, 0, 2, 2),
            &mut target,
            8,
            Pixel::Bgra,
            (0, 0, 2, 2),
        );

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

        copy(
            &client,
            (2, 1, 1, 1),
            &mut target,
            4,
            Pixel::Bgra,
            (0, 0, 1, 1),
        );

        assert_eq!(target, [2, 1, 7, 255]);
    }

    #[test]
    fn a_crop_lands_where_it_is_drawn() {
        let bytes = client_bytes();
        let client = Client {
            bytes: &bytes,
            stride: 14,
            alpha: true,
        };
        let mut target = vec![0; 2 * 4 * 2];

        copy(
            &client,
            (0, 1, 1, 1),
            &mut target,
            8,
            Pixel::Bgra,
            (1, 1, 1, 1),
        );

        assert_eq!(target[..12], [0; 12]);
        assert_eq!(target[12..], [0, 1, 7, 9]);
    }

    #[test]
    fn a_crop_drawn_larger_is_scaled_up() {
        let bytes = client_bytes();
        let client = Client {
            bytes: &bytes,
            stride: 14,
            alpha: true,
        };
        let mut target = vec![0; 4 * 4 * 2];

        copy(
            &client,
            (1, 0, 2, 1),
            &mut target,
            16,
            Pixel::Bgra,
            (0, 0, 4, 2),
        );

        let row = [[1, 0, 7, 9], [1, 0, 7, 9], [2, 0, 7, 9], [2, 0, 7, 9]].concat();
        assert_eq!(target, [row.clone(), row].concat());
    }
}
