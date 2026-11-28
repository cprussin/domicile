//! PNGs of raw icon pixels from D-Bus, so a page can draw them.

/// Encode `width` by `height` ARGB pixels (StatusNotifierItem's `IconPixmap`
/// order) as a PNG.
pub fn png(width: u32, height: u32, argb: &[u8]) -> Vec<u8> {
    let rgba: Vec<u8> = argb
        .chunks(4)
        .flat_map(|pixel| [pixel[1], pixel[2], pixel[3], pixel[0]])
        .collect();
    let mut bytes = Vec::new();
    let mut encoder = ::png::Encoder::new(&mut bytes, width, height);
    encoder.set_color(::png::ColorType::Rgba);
    encoder.set_depth(::png::BitDepth::Eight);
    // Writes to memory, which cannot fail; a short `argb` is a caller's bug.
    let mut writer = encoder.write_header().expect("a header writes to memory");
    writer
        .write_image_data(&rgba)
        .expect("the pixels fill the picture");
    writer.finish().expect("a PNG finishes in memory");
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pixels_come_back_as_rgba() {
        // Two rows of one pixel: translucent red, then opaque blue.
        let encoded = png(1, 2, &[0x80, 0xff, 0, 0, 0xff, 0, 0, 0xff]);

        let mut reader = ::png::Decoder::new(std::io::Cursor::new(encoded))
            .read_info()
            .expect("a PNG");
        let mut pixels = vec![0; reader.output_buffer_size().expect("a size")];
        let info = reader.next_frame(&mut pixels).expect("a frame");
        assert_eq!((info.width, info.height), (1, 2));
        assert_eq!(info.color_type, ::png::ColorType::Rgba);
        assert_eq!(pixels, [0xff, 0, 0, 0x80, 0, 0, 0xff, 0xff]);
    }
}
