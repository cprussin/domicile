//! A minimal PNG encoder for raw icon pixels from D-Bus, so a page can draw
//! them.
//!
//! It writes uncompressed (stored) deflate blocks. Icons are small, and this
//! avoids a compression dependency.

/// Encode `width` by `height` ARGB pixels (StatusNotifierItem's `IconPixmap`
/// order) as a PNG.
pub fn png(width: u32, height: u32, argb: &[u8]) -> Vec<u8> {
    let header = [
        width.to_be_bytes().as_slice(),
        &height.to_be_bytes(),
        // 8-bit RGBA, default compression, filter and interlace methods.
        &[8, 6, 0, 0, 0],
    ]
    .concat();
    // Each row starts with filter type 0 (none).
    let rows: Vec<u8> = argb
        .chunks(width as usize * 4)
        .flat_map(|row| {
            std::iter::once(0).chain(
                row.chunks(4)
                    .flat_map(|pixel| [pixel[1], pixel[2], pixel[3], pixel[0]]),
            )
        })
        .collect();
    [
        SIGNATURE,
        &chunk(b"IHDR", &header),
        &chunk(b"IDAT", &zlib(&rows)),
        &chunk(b"IEND", &[]),
    ]
    .concat()
}

/// The PNG file signature.
const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

/// The maximum size of a stored deflate block.
const STORED_BLOCK: usize = 65535;

/// A PNG chunk: length, type, data, and the CRC of type and data.
fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let crc = crc32(&[kind.as_slice(), data].concat());
    [
        (data.len() as u32).to_be_bytes().as_slice(),
        kind,
        data,
        &crc.to_be_bytes(),
    ]
    .concat()
}

/// `bytes` as a zlib stream of stored (uncompressed) blocks.
fn zlib(bytes: &[u8]) -> Vec<u8> {
    let blocks = bytes
        .chunks(STORED_BLOCK)
        .enumerate()
        .flat_map(|(at, block)| {
            let last = (at + 1) * STORED_BLOCK >= bytes.len();
            let length = block.len() as u16;
            [
                [u8::from(last)].as_slice(),
                &length.to_le_bytes(),
                &(!length).to_le_bytes(),
                block,
            ]
            .concat()
        });
    [0x78, 0x01]
        .into_iter()
        .chain(blocks)
        .chain(adler32(bytes).to_be_bytes())
        .collect()
}

/// PNG's CRC-32 (reflected IEEE polynomial).
fn crc32(bytes: &[u8]) -> u32 {
    !bytes.iter().fold(!0u32, |crc, byte| {
        (0..8).fold(crc ^ u32::from(*byte), |crc, _| {
            if crc & 1 == 1 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            }
        })
    })
}

/// The Adler-32 checksum that ends a zlib stream.
fn adler32(bytes: &[u8]) -> u32 {
    let (a, b) = bytes.iter().fold((1u32, 0u32), |(a, b), byte| {
        let a = (a + u32::from(*byte)) % 65521;
        (a, (b + a) % 65521)
    });
    b << 16 | a
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The type and data of the chunk at `offset`.
    fn chunk(bytes: &[u8], offset: usize) -> (&[u8], &[u8]) {
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        (
            &bytes[offset + 4..offset + 8],
            &bytes[offset + 8..offset + 8 + length],
        )
    }

    #[test]
    fn the_header_says_how_big_and_that_it_has_alpha() {
        let encoded = png(2, 1, &[0xff; 8]);

        assert_eq!(&encoded[..8], SIGNATURE);
        let (kind, data) = chunk(&encoded, 8);
        assert_eq!(kind, b"IHDR");
        // 2 by 1, 8-bit, color type 6 (RGBA), default methods.
        assert_eq!(data, [0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    }

    #[test]
    fn it_ends_the_way_every_png_ends() {
        let encoded = png(1, 1, &[0; 4]);

        // IEND, with no data and its fixed CRC.
        assert_eq!(
            &encoded[encoded.len() - 12..],
            [0, 0, 0, 0, b'I', b'E', b'N', b'D', 0xae, 0x42, 0x60, 0x82]
        );
    }

    #[test]
    fn the_pixels_are_rgba_rows_each_led_by_no_filter() {
        // Two rows of one pixel: translucent red, then opaque blue.
        let encoded = png(1, 2, &[0x80, 0xff, 0, 0, 0xff, 0, 0, 0xff]);

        let (kind, data) = chunk(&encoded, 8 + 12 + 13);
        assert_eq!(kind, b"IDAT");
        // A zlib header, one final stored block of ten bytes, and Adler-32.
        assert_eq!(&data[..2], [0x78, 0x01]);
        assert_eq!(&data[2..7], [1, 10, 0, 0xf5, 0xff]);
        assert_eq!(&data[7..17], [0, 0xff, 0, 0, 0x80, 0, 0, 0, 0xff, 0xff]);
        assert_eq!(&data[17..], adler32(&data[7..17]).to_be_bytes());
    }

    #[test]
    fn a_picture_past_one_stored_block_takes_several() {
        // 128 by 128 needs 65664 bytes, more than one 65535-byte block.
        let encoded = png(128, 128, &vec![0; 128 * 128 * 4]);

        let (_, data) = chunk(&encoded, 8 + 12 + 13);
        assert_eq!(data[2], 0, "the first block is not the last");
        assert_eq!(&data[3..5], 65535u16.to_le_bytes());
        let second = 2 + 5 + 65535;
        assert_eq!(data[second], 1, "the second one is");
        assert_eq!(&data[second + 1..second + 3], 129u16.to_le_bytes());
    }

    #[test]
    fn every_chunk_carries_its_crc() {
        let encoded = png(1, 1, &[0; 4]);
        let (kind, data) = chunk(&encoded, 8);
        let end = 8 + 8 + data.len();

        assert_eq!(
            &encoded[end..end + 4],
            crc32(&[kind, data].concat()).to_be_bytes()
        );
    }
}
