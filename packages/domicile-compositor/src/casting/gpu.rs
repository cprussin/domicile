//! Keeps a source's frame and draws it into stream buffers.
//!
//! Thin glue over Smithay's GLES renderer, which needs a GPU; the decisions
//! live in the modules beside it. Shm frames in `Argb8888` or `Xrgb8888` are
//! kept on the CPU, so a desktop without EGL still casts them.

use std::os::fd::OwnedFd;

use smithay::backend::allocator::Fourcc;
use smithay::backend::renderer::gles::{GlesError, GlesRenderer, GlesTexture};
use smithay::backend::renderer::{
    Bind, Color32F, ExportMem as _, Frame, ImportDma as _, ImportMem as _, ImportMemWl as _,
    Offscreen as _, Renderer as _,
};
use smithay::reexports::wayland_server::protocol::{wl_buffer::WlBuffer, wl_shm};
use smithay::utils::{Physical, Rectangle, Size, Transform};
use smithay::wayland::dmabuf::get_dmabuf;
use smithay::wayland::shm::with_buffer_contents;
use thiserror::Error;

use crate::buffer_transform::Sampled;
use crate::casting::cursor::{Plan, Sprite};
use crate::casting::pacing::Rect;

/// A window's last frame, kept after its buffer is released.
pub enum Snapshot {
    /// A copy of an shm frame, rows packed with no padding.
    Pixels {
        bytes: Vec<u8>,
        stride: usize,
        alpha: bool,
        size: (u32, u32),
    },
    /// A frame on the GPU: an uploaded shm frame, or the client's dmabuf.
    Texture(GlesTexture),
}

/// Part of a stream frame: `from` of `snapshot`, in its pixels, drawn over
/// `to`, in the stream's, turned upright by `transform`.
pub struct Layer<'a> {
    pub snapshot: &'a Snapshot,
    pub from: Rect,
    pub to: Rect,
    /// The buffer's `wl_surface.set_buffer_transform`.
    pub transform: Transform,
}

impl<'a> Layer<'a> {
    /// `sampled` of `snapshot`, upright at the stream's corner.
    pub fn upright(snapshot: &'a Snapshot, sampled: Sampled) -> Self {
        let (width, height) = sampled.upright_size();
        Self {
            snapshot,
            from: sampled.crop,
            to: (0, 0, width as i32, height as i32),
            transform: sampled.transform,
        }
    }
}

/// Why a frame could not be kept or filled.
#[derive(Debug, Error)]
pub enum FillError {
    #[error("the frame needs the GPU, and there is no EGL renderer")]
    NoGpu,
    #[error("the window's buffer is neither shm nor a dmabuf")]
    NotABuffer,
    #[error("the GPU would not draw the frame: {0}")]
    Gles(#[from] GlesError),
    #[error("the wait for the GPU to draw the frame was interrupted")]
    Interrupted,
    #[error("a captured frame is in DRM format {0:#x}, which streams do not read")]
    Format(u32),
    #[error("a captured frame's shared memory would not map: {0}")]
    Map(std::io::Error),
    #[error("a captured frame's dmabuf is malformed")]
    Dmabuf,
}

/// Keeps `buffer`'s frame.
pub fn snapshot(
    buffer: &WlBuffer,
    renderer: Option<&mut GlesRenderer>,
) -> Result<Snapshot, FillError> {
    let pixels = with_buffer_contents(buffer, |pool, length, data| {
        let alpha = match data.format {
            wl_shm::Format::Argb8888 => true,
            wl_shm::Format::Xrgb8888 => false,
            _ => return None,
        };
        let (width, height) = (data.width as usize, data.height as usize);
        let row = width * 4;
        // SAFETY: Smithay maps the pool for the length it passes.
        let pool = unsafe { std::slice::from_raw_parts(pool, length) };
        let bytes = (0..height)
            .flat_map(|y| {
                let from = data.offset as usize + y * data.stride as usize;
                &pool[from..from + row]
            })
            .copied()
            .collect();
        Some(Snapshot::Pixels {
            bytes,
            stride: row,
            alpha,
            size: (width as u32, height as u32),
        })
    });
    match pixels {
        Ok(Some(pixels)) => Ok(pixels),
        // Another shm format: the GPU converts it.
        Ok(None) => Ok(Snapshot::Texture(
            renderer
                .ok_or(FillError::NoGpu)?
                .import_shm_buffer(buffer, None, &[])?,
        )),
        Err(_) => {
            let dmabuf = get_dmabuf(buffer).map_err(|_| FillError::NotABuffer)?;
            Ok(Snapshot::Texture(
                renderer
                    .ok_or(FillError::NoGpu)?
                    .import_dmabuf(dmabuf, None)?,
            ))
        }
    }
}

/// Reads `crop` of `texture` into `target`, rows `stride` bytes apart.
///
/// Waits for the GPU. Taken only for a frame on the GPU cast to a consumer
/// that refused dmabufs.
///
/// Draws the crop into a buffer of its own first: a dmabuf GLES imports as
/// `GL_TEXTURE_EXTERNAL_OES` cannot back the framebuffer a read needs, and
/// Smithay does not say which ones it imported that way.
pub fn read_back(
    renderer: &mut GlesRenderer,
    texture: &GlesTexture,
    crop: Rect,
    target: &mut [u8],
    stride: usize,
) -> Result<(), FillError> {
    let size = Size::from((crop.2, crop.3));
    let mut upright: GlesTexture = renderer.create_buffer(Fourcc::Argb8888, size)?;
    let whole = Rectangle::from_size((crop.2, crop.3).into());
    let mut framebuffer = renderer.bind(&mut upright)?;
    let mut frame = renderer.render(&mut framebuffer, whole.size, Transform::Normal)?;
    frame.clear(Color32F::TRANSPARENT, &[whole])?;
    Frame::render_texture_from_to(
        &mut frame,
        texture,
        Rectangle::new(
            (f64::from(crop.0), f64::from(crop.1)).into(),
            (f64::from(crop.2), f64::from(crop.3)).into(),
        ),
        whole,
        &[whole],
        &[],
        Transform::Normal,
        1.0,
    )?;
    frame.finish()?.wait().map_err(|_| FillError::Interrupted)?;
    drop(framebuffer);
    // Rows come back top first: Smithay drew the texture upright, y-inverted
    // or not, into a buffer that is not.
    let mapping = renderer.copy_texture(&upright, Rectangle::from_size(size), Fourcc::Argb8888)?;
    let pixels = renderer.map_texture(&mapping)?;
    let row = crop.2 as usize * 4;
    for (y, from) in pixels.chunks_exact(row).enumerate() {
        target[y * stride..y * stride + row].copy_from_slice(from);
    }
    Ok(())
}

/// Draws `layers` over `target`, `size` big and cleared, and the pointer if
/// `cursor` embeds it.
///
/// Returns the fence that signals when the draw lands. A driver without
/// native fences is waited on here instead.
pub fn draw<T: Clone>(
    renderer: &mut GlesRenderer,
    layers: &[Layer],
    target: &T,
    size: (u32, u32),
    cursor: Plan,
    sprite: &Sprite,
) -> Result<Option<OwnedFd>, FillError>
where
    GlesRenderer: Bind<T>,
{
    let textures = layers
        .iter()
        .map(|layer| texture_of(renderer, layer.snapshot))
        .collect::<Result<Vec<_>, _>>()?;
    let arrow = match cursor {
        Plan::Embed { at } => Some((
            renderer.import_memory(
                &sprite.pixels,
                Fourcc::Argb8888,
                Size::from((sprite.size.0 as i32, sprite.size.1 as i32)),
                false,
            )?,
            at,
        )),
        Plan::Nothing | Plan::Metadata { .. } => None,
    };
    let mut target = target.clone();
    let size: Size<i32, Physical> = Size::from((size.0 as i32, size.1 as i32));
    let whole = Rectangle::from_size(size);
    let mut framebuffer = renderer.bind(&mut target)?;
    let mut frame = renderer.render(&mut framebuffer, size, Transform::Normal)?;
    frame.clear(Color32F::TRANSPARENT, &[whole])?;
    for (layer, texture) in layers.iter().zip(&textures) {
        let source = Rectangle::new(
            (f64::from(layer.from.0), f64::from(layer.from.1)).into(),
            (f64::from(layer.from.2), f64::from(layer.from.3)).into(),
        );
        let place = Rectangle::new(
            (layer.to.0, layer.to.1).into(),
            (layer.to.2, layer.to.3).into(),
        );
        Frame::render_texture_from_to(
            &mut frame,
            texture,
            source,
            place,
            &[place],
            &[],
            // Smithay's GLES frame turns the texture by the inverse of the
            // transform it is given; `a_turned_frame_is_drawn_upright` says
            // which way.
            layer.transform.invert(),
            1.0,
        )?;
    }
    if let Some((arrow, at)) = &arrow {
        let (width, height) = (sprite.size.0 as i32, sprite.size.1 as i32);
        let place = Rectangle::new(
            (at.0 - sprite.hotspot.0, at.1 - sprite.hotspot.1).into(),
            (width, height).into(),
        );
        Frame::render_texture_from_to(
            &mut frame,
            arrow,
            Rectangle::from_size((f64::from(width), f64::from(height)).into()),
            place,
            &[place],
            &[],
            Transform::Normal,
            1.0,
        )?;
    }
    let sync = frame.finish()?;
    drop(framebuffer);
    match sync.export() {
        Some(fence) => Ok(Some(fence)),
        None => {
            sync.wait().map_err(|_| FillError::Interrupted)?;
            Ok(None)
        }
    }
}

/// `snapshot` as a texture, uploading a frame kept on the CPU.
fn texture_of(renderer: &mut GlesRenderer, snapshot: &Snapshot) -> Result<GlesTexture, FillError> {
    match snapshot {
        Snapshot::Pixels {
            bytes, alpha, size, ..
        } => Ok(renderer.import_memory(
            bytes,
            if *alpha {
                Fourcc::Argb8888
            } else {
                Fourcc::Xrgb8888
            },
            Size::from((size.0 as i32, size.1 as i32)),
            false,
        )?),
        Snapshot::Texture(texture) => Ok(texture.clone()),
    }
}

#[cfg(test)]
mod tests {
    use smithay::backend::renderer::gles::ffi;

    use super::*;
    use crate::casting::cursor::arrow;
    use crate::dmabuf_import::headless_renderer;

    /// Four opaque pixels in `Argb8888` byte order, one color per corner, so
    /// a flip on either axis changes the result.
    const CORNERS: [u8; 16] = [
        0, 0, 255, 255, // top left: red
        0, 255, 0, 255, // top right: green
        255, 0, 0, 255, // bottom left: blue
        255, 255, 255, 255, // bottom right: white
    ];

    #[test]
    fn a_texture_reads_back_the_right_way_up() {
        let (mut renderer, _) = headless_renderer().expect("EGL: llvmpipe will do");
        let texture = renderer
            .import_memory(&CORNERS, Fourcc::Argb8888, Size::from((2, 2)), false)
            .expect("the pixels import");
        let mut target = [0; 16];

        read_back(&mut renderer, &texture, (0, 0, 2, 2), &mut target, 8).expect("read back");

        assert_eq!(target, CORNERS);
    }

    /// A texture that cannot back a framebuffer, as a dmabuf imported as
    /// `GL_TEXTURE_EXTERNAL_OES` cannot, still reads back.
    #[test]
    fn a_texture_that_cannot_be_drawn_into_reads_back() {
        let (mut renderer, _) = headless_renderer().expect("EGL: llvmpipe will do");
        // Luminance is not color-renderable in GLES.
        let id = renderer
            .with_context(|gl| {
                let mut id = 0;
                // SAFETY: the context is current, and the pixels outlive the
                // upload.
                unsafe {
                    gl.GenTextures(1, &mut id);
                    gl.BindTexture(ffi::TEXTURE_2D, id);
                    gl.TexImage2D(
                        ffi::TEXTURE_2D,
                        0,
                        ffi::LUMINANCE as i32,
                        2,
                        1,
                        0,
                        ffi::LUMINANCE,
                        ffi::UNSIGNED_BYTE,
                        [10u8, 20].as_ptr().cast(),
                    );
                    gl.BindTexture(ffi::TEXTURE_2D, 0);
                }
                id
            })
            .expect("the context is current");
        // SAFETY: `id` is the texture made above, and the renderer owns it
        // from here. Smithay has no shader for luminance; its `RGBA` one
        // samples it the same.
        let texture = unsafe {
            GlesTexture::from_raw(&renderer, Some(ffi::RGBA), true, id, Size::from((2, 1)))
        };
        let mut target = [0; 8];

        read_back(&mut renderer, &texture, (0, 0, 2, 1), &mut target, 8).expect("read back");

        assert_eq!(target, [10, 10, 10, 255, 20, 20, 20, 255]);
    }

    /// [`CORNERS`] drawn a quarter turn counterclockwise: the upright frame's
    /// top row is the buffer's right column.
    #[test]
    fn a_turned_frame_is_drawn_upright() {
        let (mut renderer, _) = headless_renderer().expect("EGL: llvmpipe will do");
        let snapshot = Snapshot::Pixels {
            bytes: CORNERS.to_vec(),
            stride: 8,
            alpha: true,
            size: (2, 2),
        };
        let turned = Sampled {
            crop: (0, 0, 2, 2),
            transform: Transform::_90,
        };
        let target: GlesTexture = renderer
            .create_buffer(Fourcc::Argb8888, Size::from((2, 2)))
            .expect("a texture to draw into");

        draw(
            &mut renderer,
            &[Layer::upright(&snapshot, turned)],
            &target,
            (2, 2),
            Plan::Nothing,
            &arrow(),
        )
        .expect("drawn");

        let mut drawn = [0; 16];
        read_back(&mut renderer, &target, (0, 0, 2, 2), &mut drawn, 8).expect("read back");
        let [red, green, blue, white] = [0, 1, 2, 3].map(|corner| &CORNERS[corner * 4..][..4]);
        assert_eq!(drawn, [green, white, red, blue].concat()[..]);
    }
}
