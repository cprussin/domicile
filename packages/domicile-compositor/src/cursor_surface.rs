//! A cursor a client draws on its own surface (`wl_pointer.set_cursor` with a
//! surface), as games, image editors and VM viewers do.
//!
//! The engine draws the pointer, so each committed image goes to the chrome as
//! a PNG on [`HostMessage::AppCursor`], for the app's element. The image is
//! kept on the surface: a client may commit it before or after it sets it.
//! Each commit's buffer is released and its frame callbacks answered at once,
//! since nothing waits on the engine for it.

use std::cell::RefCell;

use smithay::input::pointer::CursorImageSurfaceData;
use smithay::reexports::wayland_server::protocol::{wl_shm, wl_surface::WlSurface};
use smithay::wayland::compositor::{get_role, with_states, BufferAssignment, SurfaceAttributes};
use smithay::wayland::seat::CURSOR_IMAGE_ROLE;
use smithay::wayland::shm::with_buffer_contents;
use tracing::debug;

use domicile_protocol::{AppCursorImage, CursorShape, HostMessage};

use crate::DomicileCompositor;

/// The image last committed to a cursor surface, if it could be read.
type Kept = RefCell<Option<Image>>;

/// A cursor surface's image, as read from its buffer.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Image {
    /// The buffer as a PNG, base64.
    png: String,
    scale: i32,
}

impl DomicileCompositor {
    /// A client set `surface` as its cursor over `app_id`: show its image, or
    /// the arrow until it commits one.
    pub(crate) fn show_a_cursor_surface(&mut self, app_id: String, surface: &WlSurface) {
        self.cursor_surface = Some(surface.clone());
        let image = image_of(surface);
        self.tell_the_cursor(app_id, image);
    }

    /// Takes a cursor surface's commit. Returns whether `surface` is one, for
    /// the commit to go no further.
    pub(crate) fn take_a_cursor_commit(&mut self, surface: &WlSurface) -> bool {
        if get_role(surface) != Some(CURSOR_IMAGE_ROLE) {
            return false;
        }
        let (attached, callbacks, scale) = with_states(surface, |states| {
            let mut guard = states.cached_state.get::<SurfaceAttributes>();
            let attrs = guard.current();
            let attached = attrs.buffer.take();
            let callbacks = std::mem::take(&mut attrs.frame_callbacks);
            (attached, callbacks, attrs.buffer_scale)
        });
        let changed = match attached {
            Some(BufferAssignment::NewBuffer(buffer)) => {
                let read = with_buffer_contents(&buffer, |ptr, len, data| {
                    // SAFETY: Smithay maps the pool for the closure's length.
                    let pool = unsafe { std::slice::from_raw_parts(ptr, len) };
                    png_of(
                        pool,
                        data.offset,
                        data.width,
                        data.height,
                        data.stride,
                        data.format,
                    )
                })
                .ok()
                .flatten();
                buffer.release();
                if read.is_none() {
                    debug!("a cursor surface's buffer is not 32-bit shm -> the arrow");
                }
                keep(surface, read.map(|png| Image { png, scale }))
            }
            Some(BufferAssignment::Removed) => keep(surface, None),
            None => false,
        };
        let time = self.now_ms();
        for callback in callbacks {
            callback.done(time);
        }
        if changed && self.cursor_surface.as_ref() == Some(surface) {
            if let Some(app_id) = self.pointer_app.clone() {
                self.tell_the_cursor(app_id, image_of(surface));
            }
        }
        true
    }

    fn tell_the_cursor(&self, app_id: String, image: Option<AppCursorImage>) {
        self.hub.broadcast(HostMessage::AppCursor {
            app_id,
            cursor: CursorShape::Default,
            image,
        });
    }
}

/// Keeps `image` as `surface`'s, returning whether it changed.
fn keep(surface: &WlSurface, image: Option<Image>) -> bool {
    with_states(surface, |states| {
        states.data_map.insert_if_missing(Kept::default);
        let kept = states.data_map.get::<Kept>().expect("inserted above");
        let changed = *kept.borrow() != image;
        *kept.borrow_mut() = image;
        changed
    })
}

/// `surface`'s kept image with its current hotspot, or `None` for the arrow.
fn image_of(surface: &WlSurface) -> Option<AppCursorImage> {
    with_states(surface, |states| {
        let image = states.data_map.get::<Kept>()?.borrow().clone()?;
        let hotspot = states
            .data_map
            .get::<CursorImageSurfaceData>()
            .map(|data| data.lock().unwrap().hotspot)
            .unwrap_or_default();
        Some(AppCursorImage {
            png: image.png,
            hotspot: (hotspot.x, hotspot.y),
            scale: image.scale,
        })
    })
}

/// A 32-bit shm buffer as a base64 PNG, unpremultiplied, or `None` for a
/// format or shape it cannot be.
fn png_of(
    pool: &[u8],
    offset: i32,
    width: i32,
    height: i32,
    stride: i32,
    format: wl_shm::Format,
) -> Option<String> {
    let opaque = match format {
        wl_shm::Format::Argb8888 => false,
        wl_shm::Format::Xrgb8888 => true,
        _ => return None,
    };
    let (width, height, stride) = (
        u32::try_from(width).ok()?,
        u32::try_from(height).ok()?,
        usize::try_from(stride).ok()?,
    );
    let offset = usize::try_from(offset).ok()?;
    let row = width as usize * 4;
    if width == 0 || height == 0 || stride < row {
        return None;
    }
    let last = offset + stride * (height as usize - 1) + row;
    let pixels = pool.get(offset..last)?;
    let rgba: Vec<u8> = (0..height as usize)
        .flat_map(|y| pixels[y * stride..y * stride + row].chunks_exact(4))
        .flat_map(|bgra| rgba_of([bgra[0], bgra[1], bgra[2], bgra[3]], opaque))
        .collect();
    let mut png = Vec::new();
    let mut encoder = png::Encoder::new(&mut png, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .and_then(|mut writer| writer.write_image_data(&rgba))
        .ok()?;
    Some(domicile_host::base64::encoded(&png))
}

/// A premultiplied little-endian ARGB pixel as straight RGBA.
fn rgba_of([b, g, r, a]: [u8; 4], opaque: bool) -> [u8; 4] {
    if opaque {
        [r, g, b, 255]
    } else if a == 0 {
        [0, 0, 0, 0]
    } else {
        let straight =
            |c: u8| ((u32::from(c) * 255 + u32::from(a) / 2) / u32::from(a)).min(255) as u8;
        [straight(r), straight(g), straight(b), a]
    }
}

#[cfg(test)]
mod tests {
    use smithay::reexports::wayland_server::protocol::wl_shm;

    use super::{png_of, rgba_of};

    #[test]
    fn a_premultiplied_pixel_is_made_straight() {
        assert_eq!(rgba_of([0, 0, 128, 128], false), [255, 0, 0, 128]);
        assert_eq!(rgba_of([0, 0, 0, 0], false), [0, 0, 0, 0]);
        assert_eq!(rgba_of([10, 20, 30, 0], true), [30, 20, 10, 255]);
    }

    #[test]
    fn a_buffer_reads_as_a_png_of_its_rows_with_the_padding_left_out() {
        // Two pixels a row, with four bytes of padding, after an 8-byte offset.
        let mut pool = vec![0u8; 8];
        pool.extend([0, 0, 255, 255, 0, 255, 0, 255, 9, 9, 9, 9]);
        pool.extend([255, 0, 0, 255, 0, 0, 0, 0, 9, 9, 9, 9]);
        let png =
            png_of(&pool, 8, 2, 2, 12, wl_shm::Format::Argb8888).expect("a 32-bit buffer reads");
        let bytes = domicile_host::base64::decoded(&png).unwrap();
        let mut reader = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .unwrap();
        let mut rgba = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut rgba).unwrap();
        assert_eq!(
            rgba,
            [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]
        );
    }

    #[test]
    fn a_buffer_of_another_format_or_past_its_pool_is_not_read() {
        let pool = vec![0u8; 16];
        assert_eq!(png_of(&pool, 0, 2, 2, 8, wl_shm::Format::Rgb565), None);
        assert_eq!(png_of(&pool, 4, 2, 2, 8, wl_shm::Format::Argb8888), None);
    }
}
