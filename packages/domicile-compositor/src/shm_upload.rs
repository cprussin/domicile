//! An shm client's frame, drawn into a GPU buffer the engine can import.
//!
//! The copy is a GPU draw, not a `memcpy` into a mapping. NVIDIA's gbm will
//! not allocate a buffer that is both CPU-writable and renderable, and a linear
//! buffer imports into the browser but draws as the embedder's fallback (see
//! `packages/domicile-engine/scripts/spike-dmabuf.sh`). Every driver can sample
//! a buffer the GPU rendered into, so the client's pixels are uploaded as a
//! texture and drawn as a quad.

use std::sync::Mutex;

use smithay::backend::allocator::Modifier;
use smithay::backend::renderer::gles::{GlesError, GlesRenderer, GlesTexture};
use smithay::backend::renderer::{Bind, Color32F, Frame, ImportMemWl as _, Renderer as _};
use smithay::reexports::wayland_server::protocol::wl_buffer;
use smithay::utils::{Buffer as BufferCoords, Physical, Rectangle, Size, Transform};
use smithay::wayland::compositor::SurfaceData;
use smithay::wayland::shm::{shm_format_to_fourcc, with_buffer_contents};
use thiserror::Error;

use crate::uploads::Shape;

/// Draws `texture` over all of `target` and waits for the draw to finish.
///
/// The engine reads the buffer from another process with no fence, so a frame
/// submitted before the draw finishes shows the previous frame or a torn one.
pub fn copy<T>(
    renderer: &mut GlesRenderer,
    texture: &GlesTexture,
    target: &mut T,
    size: Size<i32, Physical>,
) -> Result<(), CopyError>
where
    GlesRenderer: Bind<T>,
{
    let whole = Rectangle::from_size(size);
    let source = Rectangle::from_size(Size::from((f64::from(size.w), f64::from(size.h))));
    let mut framebuffer = renderer.bind(target)?;
    let mut frame = renderer.render(&mut framebuffer, size, Transform::Normal)?;
    // The buffer is reused, so clear it before blending translucent pixels.
    frame.clear(Color32F::TRANSPARENT, &[whole])?;
    Frame::render_texture_from_to(
        &mut frame,
        texture,
        source,
        whole,
        &[whole],
        &[],
        Transform::Normal,
        1.0,
    )?;
    frame.finish()?.wait().map_err(|_| CopyError::Interrupted)
}

/// The rectangles of a `size` buffer to upload into the surface's texture, in
/// Smithay's terms: empty uploads the whole buffer.
///
/// The client's `damage` is enough only when the texture holds the commit
/// before it.
pub fn uploaded(
    damage: Option<(i32, i32, i32, i32)>,
    texture_is_current: bool,
    size: (u32, u32),
) -> Vec<Rectangle<i32, BufferCoords>> {
    let (width, height) = (size.0 as i32, size.1 as i32);
    damage
        .filter(|_| texture_is_current)
        .map(|(x, y, w, h)| {
            let (left, top) = (x.clamp(0, width), y.clamp(0, height));
            let right = x.saturating_add(w).clamp(left, width);
            let bottom = y.saturating_add(h).clamp(top, height);
            Rectangle::new((left, top).into(), (right - left, bottom - top).into())
        })
        .into_iter()
        .collect()
}

/// Imports `buffer`, of `shape`, through the surface's cached texture.
///
/// Smithay reuses the cached texture whenever the size matches, keeping the
/// format it was made with: an opaque texture would hide a buffer's new
/// alpha. A new format at the same size skips the cache, until the size
/// changes and Smithay makes a texture in it.
pub fn import(
    renderer: &mut GlesRenderer,
    buffer: &wl_buffer::WlBuffer,
    states: &SurfaceData,
    shape: Shape,
    damage: &[Rectangle<i32, BufferCoords>],
) -> Result<GlesTexture, GlesError> {
    let cached = states
        .data_map
        .get_or_insert_threadsafe(|| Mutex::new(CachedTexture(None)));
    let mut cached = cached.lock().expect("never poisoned");
    through_the_cache(&mut cached.0, shape, |handed_over| {
        renderer.import_shm_buffer(buffer, handed_over.then_some(states), damage)
    })
}

/// The shape of the texture Smithay caches on a surface, as far as we have
/// handed it the cache.
struct CachedTexture(Option<Shape>);

/// Runs `import`, told whether Smithay may use the surface's texture, last
/// made as `cached`, for `shape`. Records the texture Smithay makes, once the
/// import succeeds: a failed one leaves Smithay's cache as it was.
fn through_the_cache<T, E>(
    cached: &mut Option<Shape>,
    shape: Shape,
    import: impl FnOnce(bool) -> Result<T, E>,
) -> Result<T, E> {
    let handed_over = match *cached {
        Some(held) if (held.width, held.height) == (shape.width, shape.height) => {
            held.fourcc == shape.fourcc
        }
        // Smithay makes a new texture, in this commit's format.
        _ => true,
    };
    let texture = import(handed_over)?;
    if handed_over {
        // Smithay made a texture in this shape, or reused one already in it.
        *cached = Some(shape);
    }
    Ok(texture)
}

/// The GPU buffer shape an shm buffer needs. `None` for a buffer that is not
/// shm, or whose format has no DRM fourcc.
pub fn shm_shape(buffer: &wl_buffer::WlBuffer) -> Option<Shape> {
    with_buffer_contents(buffer, |_, _, data| {
        shm_format_to_fourcc(data.format).map(|fourcc| Shape {
            width: data.width as u32,
            height: data.height as u32,
            fourcc: fourcc as u32,
        })
    })
    .ok()
    .flatten()
}

/// The modifiers the renderer can both render to and sample from for
/// `fourcc`. The browser samples the buffer on the same GPU.
///
/// Empty when the driver lists only the implicit modifier, which lets libgbm
/// pick the layout.
pub fn render_modifiers(renderer: &GlesRenderer, fourcc: u32) -> Vec<u64> {
    let context = renderer.egl_context();
    let sampled = context.dmabuf_texture_formats();
    context
        .dmabuf_render_formats()
        .iter()
        .filter(|format| {
            format.code as u32 == fourcc
                && format.modifier != Modifier::Invalid
                && sampled.contains(format)
        })
        .map(|format| u64::from(format.modifier))
        .collect()
}

/// Why copying a frame into the buffer failed.
#[derive(Debug, Error)]
pub enum CopyError {
    #[error("the GPU would not draw the client's frame: {0}")]
    Gles(#[from] GlesError),
    #[error("the wait for the client's frame to land was interrupted")]
    Interrupted,
}

#[cfg(test)]
mod tests {
    use smithay::backend::allocator::Fourcc;
    use smithay::backend::renderer::gles::GlesRenderbuffer;
    use smithay::backend::renderer::{Bind as _, ExportMem as _, ImportMem as _, Offscreen as _};
    use smithay::utils::{Rectangle, Size};

    use crate::dmabuf_import::headless_renderer;

    use super::copy;

    /// Four opaque pixels in `Argb8888` byte order (B, G, R, A), one color per
    /// corner, so a flip or swizzle on either axis changes the result.
    const CORNERS: [u8; 16] = [
        0, 0, 255, 255, // top left: red
        0, 255, 0, 255, // top right: green
        255, 0, 0, 255, // bottom left: blue
        255, 255, 255, 255, // bottom right: white
    ];

    #[test]
    fn the_buffer_holds_the_clients_pixels_the_right_way_up() {
        let (mut renderer, _) = headless_renderer().expect("EGL: llvmpipe will do");
        let size = Size::from((2, 2));
        let texture = renderer
            .import_memory(&CORNERS, Fourcc::Argb8888, size, false)
            .expect("the pixels import");
        let mut target: GlesRenderbuffer = renderer
            .create_buffer(Fourcc::Argb8888, size)
            .expect("a renderbuffer");

        copy(&mut renderer, &texture, &mut target, Size::from((2, 2))).expect("the copy draws");

        let framebuffer = renderer.bind(&mut target).expect("binds");
        let mapping = renderer
            .copy_framebuffer(&framebuffer, Rectangle::from_size(size), Fourcc::Argb8888)
            .expect("reads back");
        drop(framebuffer);
        let pixels = renderer.map_texture(&mapping).expect("maps");
        assert_eq!(pixels, CORNERS);
    }

    mod through_the_cache {
        use crate::uploads::Shape;

        use super::super::through_the_cache;

        const XRGB: u32 = 1;
        const ARGB: u32 = 2;

        fn shape(width: u32, fourcc: u32) -> Shape {
            Shape {
                width,
                height: 100,
                fourcc,
            }
        }

        /// Whether the import was handed the cache. It succeeds.
        fn handed_over(cached: &mut Option<Shape>, shape: Shape) -> bool {
            through_the_cache(cached, shape, Ok::<_, ()>).expect("it succeeds")
        }

        #[test]
        fn a_new_texture_takes_the_commits_format() {
            let mut cached = None;

            assert!(handed_over(&mut cached, shape(200, XRGB)));
            assert_eq!(cached, Some(shape(200, XRGB)));
        }

        #[test]
        fn a_new_format_at_the_same_size_skips_the_cache() {
            // Smithay would keep the opaque format for a translucent buffer.
            let mut cached = Some(shape(200, XRGB));

            assert!(!handed_over(&mut cached, shape(200, ARGB)));
            assert!(!handed_over(&mut cached, shape(200, ARGB)));
            assert!(handed_over(&mut cached, shape(200, XRGB)));
        }

        #[test]
        fn a_new_size_makes_a_texture_in_the_new_format() {
            let mut cached = Some(shape(200, XRGB));

            assert!(handed_over(&mut cached, shape(300, ARGB)));
            assert_eq!(cached, Some(shape(300, ARGB)));
        }

        // Smithay caches a new texture only once the import gets that far.
        #[test]
        fn a_failed_import_leaves_the_cache_as_it_was() {
            let mut cached = Some(shape(200, XRGB));

            assert_eq!(
                through_the_cache(&mut cached, shape(300, ARGB), |_| Err::<(), _>("no")),
                Err("no")
            );
            assert_eq!(cached, Some(shape(200, XRGB)));
        }
    }

    mod uploaded {
        use smithay::utils::{Buffer as BufferCoords, Rectangle};

        use super::super::uploaded;

        fn rect(x: i32, y: i32, w: i32, h: i32) -> Rectangle<i32, BufferCoords> {
            Rectangle::new((x, y).into(), (w, h).into())
        }

        #[test]
        fn a_current_texture_takes_only_the_damage() {
            assert_eq!(
                uploaded(Some((10, 20, 5, 6)), true, (200, 100)),
                vec![rect(10, 20, 5, 6)]
            );
        }

        #[test]
        fn a_stale_texture_or_unknown_damage_takes_the_whole_buffer() {
            assert!(uploaded(Some((10, 20, 5, 6)), false, (200, 100)).is_empty());
            assert!(uploaded(None, true, (200, 100)).is_empty());
        }

        #[test]
        fn damage_past_the_buffer_is_cut_to_it() {
            // GL refuses a sub-image that leaves the texture.
            assert_eq!(
                uploaded(Some((0, 0, i32::MAX, i32::MAX)), true, (200, 100)),
                vec![rect(0, 0, 200, 100)]
            );
        }
    }
}
