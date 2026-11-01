//! Clipboard image thumbnails: small enough to send with every history row,
//! and still the copied picture.

use domicile_host::base64::decoded;
use domicile_host::screenshot::{encode, Shot};
use domicile_host::thumbnail::{thumbnail, LONGEST_SIDE};

/// A PNG `width` by `height`, its left half black and its right half white.
fn halves(width: u32, height: u32) -> Vec<u8> {
    let bgra = (0..height)
        .flat_map(|_| 0..width)
        .flat_map(|x| {
            let level = if x < width / 2 { 0 } else { 255 };
            [level, level, level, 255]
        })
        .collect();
    encode(&Shot {
        width,
        height,
        bgra,
    })
}

/// The size and RGBA pixels of a thumbnail's PNG.
fn decoded_png(url: &str) -> (u32, u32, Vec<u8>) {
    let png = decoded(
        url.strip_prefix("data:image/png;base64,")
            .expect("a thumbnail is a PNG data URL"),
    )
    .expect("a thumbnail's data URL is base64");
    let mut reader = png::Decoder::new(std::io::Cursor::new(png))
        .read_info()
        .expect("a thumbnail is a PNG");
    let mut pixels = vec![
        0;
        reader
            .output_buffer_size()
            .expect("a thumbnail fits in memory")
    ];
    let frame = reader
        .next_frame(&mut pixels)
        .expect("a thumbnail's pixels read");
    pixels.truncate(frame.buffer_size());
    (frame.width, frame.height, pixels)
}

/// A large image shrinks to fit [`LONGEST_SIDE`], keeping its shape and its
/// picture.
#[test]
fn a_large_image_shrinks_to_its_shape_and_keeps_its_picture() {
    let url =
        thumbnail(&halves(LONGEST_SIDE * 4, LONGEST_SIDE * 2)).expect("a PNG has a thumbnail");

    let (width, height, pixels) = decoded_png(&url);

    assert_eq!((width, height), (LONGEST_SIDE, LONGEST_SIDE / 2));
    assert_eq!(pixels[..4], [0, 0, 0, 255], "the left edge stays black");
    assert_eq!(
        pixels[pixels.len() - 4..],
        [255, 255, 255, 255],
        "the right edge stays white"
    );
}

/// An image already small enough is not enlarged.
#[test]
fn a_small_image_keeps_its_size() {
    let url = thumbnail(&halves(6, 2)).expect("a PNG has a thumbnail");

    let (width, height, _) = decoded_png(&url);

    assert_eq!((width, height), (6, 2));
}

/// Bytes that are not a PNG have no thumbnail.
#[test]
fn what_is_not_a_png_has_no_thumbnail() {
    assert_eq!(thumbnail(b"GIF89a"), None);
}
