//! Small pictures of copied images, for the clipboard history's rows.
//!
//! The history is sent whole on every copy, so a row carries a thumbnail
//! rather than the image.

use std::io::Cursor;

use crate::data_url::data_url;

/// Longest side of a thumbnail, in pixels. Enough for a shell to show it a
/// few lines tall on a high-density screen.
pub const LONGEST_SIDE: u32 = 256;

/// `png` shrunk to fit [`LONGEST_SIDE`], as a PNG `data:` URL, or `None` if
/// `png` does not decode. A smaller image keeps its size.
pub fn thumbnail(png: &[u8]) -> Option<String> {
    let mut decoder = png::Decoder::new(Cursor::new(png));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().ok()?;
    let mut pixels = vec![0; reader.output_buffer_size()?];
    let frame = reader.next_frame(&mut pixels).ok()?;
    let rgba = rgba(&pixels[..frame.buffer_size()], frame.color_type);
    let (width, height) = fitted(frame.width, frame.height);
    let shrunk = shrunk(&rgba, (frame.width, frame.height), (width, height));
    Some(data_url("image/png", &encoded(&shrunk, width, height)))
}

/// The size that fits `width` by `height` within [`LONGEST_SIDE`], keeping its
/// shape. Never smaller than one pixel a side.
fn fitted(width: u32, height: u32) -> (u32, u32) {
    let longest = width.max(height);
    if longest <= LONGEST_SIDE {
        (width, height)
    } else {
        let scaled = |side: u32| {
            ((u64::from(side) * u64::from(LONGEST_SIDE) + u64::from(longest) / 2)
                / u64::from(longest))
            .max(1) as u32
        };
        (scaled(width), scaled(height))
    }
}

/// Decoded 8-bit `pixels` of `color`, as RGBA.
fn rgba(pixels: &[u8], color: png::ColorType) -> Vec<[u8; 4]> {
    match color {
        png::ColorType::Grayscale => pixels.iter().map(|&gray| [gray, gray, gray, 255]).collect(),
        png::ColorType::GrayscaleAlpha => pixels
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&[gray, alpha]| [gray, gray, gray, alpha])
            .collect(),
        png::ColorType::Rgb => pixels
            .as_chunks::<3>()
            .0
            .iter()
            .map(|&[red, green, blue]| [red, green, blue, 255])
            .collect(),
        png::ColorType::Rgba => pixels.as_chunks::<4>().0.to_vec(),
        png::ColorType::Indexed => unreachable!("`normalize_to_color8` expands a palette"),
    }
}

/// `pixels`, of size `from`, averaged down to size `to`.
///
/// Each source pixel adds to the one it lands in, weighted by its alpha, so
/// a transparent pixel's color does not tint its neighbors.
fn shrunk(pixels: &[[u8; 4]], from: (u32, u32), to: (u32, u32)) -> Vec<u8> {
    let (from_width, from_height) = (from.0 as usize, from.1 as usize);
    let (to_width, to_height) = (to.0 as usize, to.1 as usize);
    // Premultiplied red, green and blue, then alpha, then how many pixels.
    let mut sums = vec![[0u64; 5]; to_width * to_height];
    for (at, &[red, green, blue, alpha]) in pixels.iter().enumerate() {
        let (x, y) = (at % from_width, at / from_width);
        let sum = &mut sums[y * to_height / from_height * to_width + x * to_width / from_width];
        let alpha = u64::from(alpha);
        sum[0] += u64::from(red) * alpha;
        sum[1] += u64::from(green) * alpha;
        sum[2] += u64::from(blue) * alpha;
        sum[3] += alpha;
        sum[4] += 1;
    }
    sums.iter()
        .flat_map(|&[red, green, blue, alpha, count]| {
            let straight = |channel: u64| channel.checked_div(alpha).unwrap_or(0) as u8;
            [
                straight(red),
                straight(green),
                straight(blue),
                (alpha / count) as u8,
            ]
        })
        .collect()
}

/// RGBA `pixels` as a PNG.
fn encoded(pixels: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .expect("a PNG header writes to memory");
    writer
        .write_image_data(pixels)
        .expect("a thumbnail is as many pixels as its size");
    writer.finish().expect("a PNG finishes in memory");
    bytes
}
