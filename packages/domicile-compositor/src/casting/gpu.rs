//! Keeps a window's frame and draws it into stream buffers.
//!
//! Thin glue over Smithay's GLES renderer, which needs a GPU; the decisions
//! live in the modules beside it. Shm frames in `Argb8888` or `Xrgb8888` are
//! kept on the CPU, so a desktop without EGL still casts them.

use std::os::fd::OwnedFd;

use smithay::backend::allocator::dmabuf::Dmabuf;
use smithay::backend::allocator::{Buffer as _, Fourcc};
use smithay::backend::renderer::gles::{GlesError, GlesRenderer, GlesTexture};
use smithay::backend::renderer::{
    Bind as _, Color32F, ExportMem as _, Frame, ImportDma as _, ImportMem as _, ImportMemWl as _,
    Renderer as _, TextureMapping as _,
};
use smithay::reexports::wayland_server::protocol::{wl_buffer::WlBuffer, wl_shm};
use smithay::utils::{Physical, Rectangle, Size, Transform};
use smithay::wayland::dmabuf::get_dmabuf;
use smithay::wayland::shm::with_buffer_contents;
use thiserror::Error;

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
pub fn read_back(
    renderer: &mut GlesRenderer,
    texture: &GlesTexture,
    crop: Rect,
    target: &mut [u8],
    stride: usize,
) -> Result<(), FillError> {
    let region = Rectangle::new((crop.0, crop.1).into(), (crop.2, crop.3).into());
    let mapping = renderer.copy_texture(texture, region, Fourcc::Argb8888)?;
    let flipped = mapping.flipped();
    let pixels = renderer.map_texture(&mapping)?;
    let row = crop.2 as usize * 4;
    let height = crop.3 as usize;
    for y in 0..height {
        let from = if flipped { height - 1 - y } else { y } * row;
        target[y * stride..y * stride + row].copy_from_slice(&pixels[from..from + row]);
    }
    Ok(())
}

/// Draws `crop` of `snapshot` over all of `target`, and the pointer if
/// `cursor` embeds it.
///
/// Returns the fence that signals when the draw lands. A driver without
/// native fences is waited on here instead.
pub fn draw(
    renderer: &mut GlesRenderer,
    snapshot: &Snapshot,
    crop: Rect,
    target: &Dmabuf,
    cursor: Plan,
    sprite: &Sprite,
) -> Result<Option<OwnedFd>, FillError> {
    let texture = match snapshot {
        Snapshot::Pixels {
            bytes, alpha, size, ..
        } => renderer.import_memory(
            bytes,
            if *alpha {
                Fourcc::Argb8888
            } else {
                Fourcc::Xrgb8888
            },
            Size::from((size.0 as i32, size.1 as i32)),
            false,
        )?,
        Snapshot::Texture(texture) => texture.clone(),
    };
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
    let size: Size<i32, Physical> = Size::from((target.width() as i32, target.height() as i32));
    let whole = Rectangle::from_size(size);
    let source = Rectangle::new(
        (f64::from(crop.0), f64::from(crop.1)).into(),
        (f64::from(crop.2), f64::from(crop.3)).into(),
    );
    let mut framebuffer = renderer.bind(&mut target)?;
    let mut frame = renderer.render(&mut framebuffer, size, Transform::Normal)?;
    frame.clear(Color32F::TRANSPARENT, &[whole])?;
    Frame::render_texture_from_to(
        &mut frame,
        &texture,
        source,
        whole,
        &[whole],
        &[],
        Transform::Normal,
        1.0,
    )?;
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
