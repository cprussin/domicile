//! An shm client's frame, drawn into a GPU buffer the engine can import.
//!
//! The copy is a draw rather than a `memcpy` into a mapping, and that is a
//! finding rather than a preference: NVIDIA's gbm will not hand out a buffer
//! that is both CPU-writable and renderable, and a linear one imports into the
//! browser without error and then draws as the embedder's fallback — see
//! `packages/domicile-engine/scripts/spike-dmabuf.sh`. A buffer the GPU
//! renders into is one every driver samples, so the client's pixels go up as a
//! texture and come down as a quad.

use smithay::backend::allocator::Modifier;
use smithay::backend::renderer::gles::{GlesError, GlesRenderer, GlesTexture};
use smithay::backend::renderer::{Bind, Color32F, Frame, Renderer as _};
use smithay::reexports::wayland_server::protocol::wl_buffer;
use smithay::utils::{Physical, Rectangle, Size, Transform};
use smithay::wayland::shm::{shm_format_to_fourcc, with_buffer_contents};
use thiserror::Error;

use crate::uploads::Shape;

/// Draw `texture` over the whole of `target`, and wait until it is there.
///
/// Waited for because the engine reads the buffer from another process, and
/// nothing crosses the seam to say when the GPU is done with it — a frame
/// submitted before its draw lands is the previous frame, or a torn one.
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
    // Cleared first because the buffer is reused: blending a translucent
    // pixel over the frame before last is not the client's pixel.
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

/// What an shm buffer needs a GPU buffer to be. `None` for a buffer that is
/// not shm, or whose format has no DRM fourcc.
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

/// The layouts the renderer can draw a `fourcc` buffer in and also sample
/// one from — which is what the browser does with it, on the same GPU.
///
/// Empty when the driver names none but the implicit one, which is libgbm's
/// cue to lay the buffer out as it likes.
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

/// Why a frame did not make it into the buffer.
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

    /// Four opaque pixels in `Argb8888`'s byte order (B, G, R, A), one color
    /// per corner, so a flip or a swizzle in either axis moves one of them.
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
}
