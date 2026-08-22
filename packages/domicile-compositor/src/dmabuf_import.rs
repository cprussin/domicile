//! The GPU half of the dmabuf path: importing a client's buffer and reading it
//! back as pixels the chrome can draw.
//!
//! Domicile's renderer is a web engine, so this is deliberately *not* a scene
//! renderer — it draws exactly one texture into an offscreen buffer and copies
//! it out. That copy is the stopgap the roadmap calls out: the dmabuf reaches
//! the engine as `AppFrame` pixels today, and stops being copied at all once
//! the compositor composites it directly
//! (`docs/architecture/WINDOW-COMPOSITING.md`). What matters now is that a GPU
//! client's frames arrive at all — `wl_shm` is the only path a modern toolkit
//! will not take.
//!
//! Everything but the device policy is glue over EGL/GLES that cannot run
//! without a GPU, so it is deliberately thin: the buffer bookkeeping lives in
//! `dmabuf_descriptor` and `domicile-bridge`, where it is tested.

use smithay::backend::allocator::dmabuf::Dmabuf;
use smithay::backend::allocator::format::FormatSet;
use smithay::backend::allocator::{Buffer as _, Fourcc};
use smithay::backend::egl::{EGLContext, EGLDevice, EGLDisplay};
use smithay::backend::renderer::gles::{GlesRenderer, GlesTexture};
use smithay::backend::renderer::{
    Bind as _, ExportMem as _, Frame, ImportDma as _, Offscreen as _, Renderer as _,
};
use smithay::utils::{Buffer as BufferCoords, Rectangle, Size, Transform};

use crate::Region;
use std::os::unix::fs::MetadataExt as _;

/// The EGL entry point Smithay itself loads. Probing it first is what turns
/// "this machine has no GPU stack" from a crash into an answer.
const EGL_LIBRARY: &str = "libEGL.so.1";

/// The renderer, and the DRM node whoever created it is on.
///
/// The renderer is not owned here. A texture belongs to the EGL context that
/// made it, so the compositor must import client buffers on the *same*
/// renderer it draws with — which, once it presents, is the one the window
/// owns. Keeping these as operations over a borrowed renderer is what lets the
/// same code serve a headless compositor and a presenting one.
pub struct DmabufImporter {
    main_device: Option<u64>,
}

/// Why the GPU path is unavailable, or why a particular frame could not be read.
#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("{EGL_LIBRARY} is not loadable")]
    NoEgl(#[from] libloading::Error),
    #[error("EGL exposes no device to render on")]
    NoDevice,
    #[error("EGL setup failed")]
    Egl(#[from] smithay::backend::egl::Error),
    #[error("GLES failed to import or read back the buffer")]
    Gles(#[from] smithay::backend::renderer::gles::GlesError),
}

/// Bring up an offscreen GLES renderer on the best device EGL offers, for a
/// compositor that is not presenting.
///
/// Fails on a machine with no working EGL at all; the compositor treats that
/// as "no dmabuf global", so `wl_shm` clients keep working.
pub fn headless_renderer() -> Result<(GlesRenderer, DmabufImporter), ImportError> {
    // Smithay dlopens EGL lazily and treats a missing library as fatal, so
    // the load has to be attempted here — where it is an error value —
    // before any Smithay EGL call can panic on it.
    // SAFETY: this opens the very library Smithay opens a moment later,
    // running the same initialisers it would have run itself.
    unsafe { libloading::Library::new(EGL_LIBRARY) }?;
    let devices = EGLDevice::enumerate()?;
    let device = preferred_device(devices, EGLDevice::is_software).ok_or(ImportError::NoDevice)?;
    let main_device = drm_node(&device);
    tracing::info!(
        device = ?device.render_device_path().or_else(|_| device.drm_device_path()),
        main_device,
        "dmabuf import device"
    );
    // SAFETY: the device handle comes straight out of EGL's own enumeration
    // and outlives the display, which owns it from here on.
    let display = unsafe { EGLDisplay::new(device) }?;
    let context = EGLContext::new(&display)?;
    // SAFETY: the renderer is created, used and dropped on the Wayland
    // thread, which is where the context is made current.
    let renderer = unsafe { GlesRenderer::new(context) }?;
    Ok((renderer, DmabufImporter { main_device }))
}

impl DmabufImporter {
    /// What to report for a renderer somebody else created — the window's.
    ///
    /// The node is looked up the same way, from the device EGL would have
    /// chosen; it is the client-facing half of the story and does not depend
    /// on who owns the context.
    pub fn for_existing_renderer() -> Self {
        let main_device = EGLDevice::enumerate()
            .ok()
            .and_then(|devices| preferred_device(devices, EGLDevice::is_software))
            .and_then(|device| drm_node(&device));
        tracing::info!(main_device, "dmabuf import device (presenting)");
        DmabufImporter { main_device }
    }

    /// The DRM node clients should allocate on, if this renderer has one.
    ///
    /// `zwp_linux_dmabuf_v1` feedback carries this, and it is the only way a
    /// Mesa client learns which GPU the compositor imports on — Domicile
    /// advertises no `wl_drm`, so without feedback the client sees a format
    /// list it cannot act on.
    pub fn main_device(&self) -> Option<u64> {
        self.main_device
    }

    /// The formats to advertise on `zwp_linux_dmabuf_v1` — exactly the ones
    /// this renderer can turn into a texture, so a client never allocates a
    /// buffer we would have to reject.
    pub fn formats(renderer: &GlesRenderer) -> FormatSet {
        renderer.dmabuf_formats()
    }

    /// Whether a client's buffer really imports, answering the protocol's
    /// import notifier before the client can commit it.
    pub fn accepts(renderer: &mut GlesRenderer, dmabuf: &Dmabuf) -> bool {
        renderer.import_dmabuf(dmabuf, None).is_ok()
    }

    /// Import `dmabuf` as a texture to be *drawn*, not copied out.
    ///
    /// This is the path that makes a window cost nothing: the client's own
    /// buffer becomes the texture the compositor samples, with no readback and
    /// no trip through the chrome.
    pub fn import(
        renderer: &mut GlesRenderer,
        dmabuf: &Dmabuf,
    ) -> Result<GlesTexture, ImportError> {
        Ok(renderer.import_dmabuf(dmabuf, None)?)
    }

    /// Import `dmabuf` and copy `area` of it out as tightly-packed, top-down
    /// RGBA — the same byte layout the `wl_shm` path produces, so both feed one
    /// `HostMessage::AppFrame`. `None` reads the whole buffer.
    ///
    /// `area` must lie inside the buffer. `region_to_send` clamps it, which is
    /// where every caller's comes from; an out-of-range one is not rejected
    /// anywhere below — GLES raises no error and returns undefined values.
    ///
    /// Entry and exit are logged because the import is the one step no test can
    /// reach: it needs a GPU and a client that allocates on it, so the log is
    /// the only account of whether a frame made it through. What happens to the
    /// pixels afterwards is [`copy_out`], which is tested.
    pub fn read_rgba(
        renderer: &mut GlesRenderer,
        dmabuf: &Dmabuf,
        area: Option<Region>,
    ) -> Result<Vec<u8>, ImportError> {
        tracing::debug!("readback: import");
        let texture = renderer.import_dmabuf(dmabuf, None)?;
        let size = dmabuf.size();
        let pixels = copy_out(renderer, &texture, area_to_read(area, size))?;
        tracing::debug!(bytes = pixels.len(), "readback: done");
        Ok(pixels)
    }
}

/// Which rectangle of a buffer that size to read: the damaged one, or all of
/// it.
///
/// Its own function because it is the whole of what this change adds, and
/// inlined it was a `map_or` no test could reach — a renderer that quietly read
/// the whole buffer would still send it under a small region's header, and
/// `drawFrame` slices the bytes it is given rather than checking them, so the
/// chrome would paint the window's top-left corner into the damaged rectangle
/// and nothing anywhere would say so.
///
/// A region has already been clamped to the buffer by `region_to_send`, so
/// nothing here can name pixels the framebuffer has not got.
fn area_to_read(
    area: Option<Region>,
    size: Size<i32, BufferCoords>,
) -> Rectangle<i32, BufferCoords> {
    match area {
        None => Rectangle::from_size(size),
        Some(region) => Rectangle::new(
            (region.x as i32, region.y as i32).into(),
            (region.width as i32, region.height as i32).into(),
        ),
    }
}

/// Copy `area` of `texture` out as tightly-packed, top-down RGBA.
///
/// `area` rather than the whole buffer because this is a pipeline stall, and
/// after damage tracking it is the last cost on the copy path still
/// proportional to the *window* rather than to what changed. A client that
/// moved a cursor cell should stall for a cursor cell.
///
/// **Everything here is the size of `area`, not of the buffer** — the
/// offscreen it allocates, the quad it draws, and the copy out of it. Reading
/// a narrow rectangle out of a full-size blit is the mistake this had to be
/// measured to avoid: on a software rasteriser the blit is the whole cost, so
/// narrowing only the copy measured the same as not narrowing at all.
///
/// The blit is what makes the copy format-agnostic: whatever the client
/// allocated — tiled, compressed, a different channel order — is resolved by
/// the sampler into one plain RGBA8 surface. Taking `area` as its *source*
/// rectangle is what confines it while keeping that property.
///
/// **Orientation is not among the things it resolves.** `Transform::Normal`
/// samples top-to-bottom, and a y-inverted buffer needs the flip
/// `compose::texture_matrix` applies for the drawn path; read back through
/// here it comes out as its first row repeated. That is how this behaved
/// before the region was added and is not a regression, but it is not what a
/// reader would take "whatever the client allocated" to include.
fn copy_out(
    renderer: &mut GlesRenderer,
    texture: &GlesTexture,
    area: Rectangle<i32, BufferCoords>,
) -> Result<Vec<u8>, ImportError> {
    let patch = Rectangle::from_size((area.size.w, area.size.h).into());
    let mut offscreen: GlesTexture = renderer.create_buffer(Fourcc::Abgr8888, area.size)?;
    let mut framebuffer = renderer.bind(&mut offscreen)?;
    let drawn = {
        let mut frame = renderer.render(
            &mut framebuffer,
            (area.size.w, area.size.h).into(),
            Transform::Normal,
        )?;
        Frame::render_texture_from_to(
            &mut frame,
            texture,
            area.to_f64(),
            patch,
            &[patch],
            &[],
            Transform::Normal,
            1.0,
        )?;
        frame.finish()?
    };
    renderer.wait(&drawn)?;
    let mapping = renderer.copy_framebuffer(
        &framebuffer,
        Rectangle::from_size(area.size),
        Fourcc::Abgr8888,
    )?;
    Ok(renderer.map_texture(&mapping)?.to_vec())
}

/// The `dev_t` of the DRM node a device renders on. A software rasteriser has
/// none, which is the only reason this is optional.
fn drm_node(device: &EGLDevice) -> Option<u64> {
    match device
        .render_device_path()
        .or_else(|_| device.drm_device_path())
    {
        Ok(path) => match std::fs::metadata(&path) {
            Ok(node) => Some(node.rdev()),
            Err(err) => {
                tracing::warn!(?path, %err, "cannot stat the render node");
                None
            }
        },
        Err(_) => None,
    }
}

/// Pick the device to render on: real hardware when there is any, otherwise
/// whatever software rasteriser EGL offers.
///
/// A software device is a poor compositor but a complete one, and it is what
/// makes the dmabuf path exercisable on a machine with no GPU at all, so it is
/// a fallback rather than a failure.
fn preferred_device<D>(
    devices: impl Iterator<Item = D>,
    is_software: impl Fn(&D) -> bool,
) -> Option<D> {
    let (hardware, software): (Vec<D>, Vec<D>) = devices.partition(|device| !is_software(device));
    hardware
        .into_iter()
        .next()
        .or_else(|| software.into_iter().next())
}

/// The readback, against a real GLES stack.
///
/// `#[ignore]`d for the same reason `compose::pixels` is: CI's compositor job
/// installs no GL, and these would fail there for want of a renderer rather
/// than for anything about the code. `scripts/e2e-compose.sh` is where a
/// machine that has one runs them.
///
/// A memory texture rather than a dmabuf, because a dmabuf needs a DRM node
/// and a client to allocate on it — which is exactly the step this file says
/// no test can reach. What *can* be reached is the part with the arithmetic in
/// it: which rows come back, and whether they are packed tight.
#[cfg(test)]
mod readback {
    use smithay::backend::allocator::Fourcc;
    use smithay::backend::egl::{EGLContext, EGLDevice, EGLDisplay};
    use smithay::backend::renderer::gles::{GlesRenderer, GlesTexture};
    use smithay::backend::renderer::ImportMem as _;
    use smithay::utils::Size;

    use super::{area_to_read, copy_out};
    use crate::Region;

    const SIDE: i32 = 8;

    /// A renderer with no window and no GPU: EGL's own device enumeration will
    /// hand over a software rasteriser where there is no hardware.
    fn renderer() -> GlesRenderer {
        // SAFETY: opens the library Smithay opens a moment later, running the
        // initialisers it would have run itself.
        unsafe { libloading::Library::new("libEGL.so.1") }.expect("libEGL loads");
        let device = EGLDevice::enumerate()
            .expect("EGL enumerates devices")
            .next()
            .expect("EGL offers some device");
        // SAFETY: the device comes from EGL's own enumeration and the display
        // owns it from here on.
        let display = unsafe { EGLDisplay::new(device) }.expect("an EGL display");
        let context = EGLContext::new(&display).expect("an EGL context");
        // SAFETY: created and used on this thread, where it is current.
        unsafe { GlesRenderer::new(context) }.expect("a GLES renderer")
    }

    /// A texture whose every pixel says where it is: red is the column, green
    /// the row. A patch taken from the wrong offset, or packed at the wrong
    /// stride, comes back as the wrong coordinates rather than as the right
    /// number of bytes.
    fn numbered(renderer: &mut GlesRenderer) -> GlesTexture {
        let mut pixels = Vec::with_capacity((SIDE * SIDE * 4) as usize);
        for row in 0..SIDE {
            for column in 0..SIDE {
                pixels.extend_from_slice(&[column as u8, row as u8, 0, 255]);
            }
        }
        renderer
            .import_memory(&pixels, Fourcc::Abgr8888, (SIDE, SIDE).into(), false)
            .expect("a memory texture imports")
    }

    fn size() -> Size<i32, smithay::utils::Buffer> {
        (SIDE, SIDE).into()
    }

    /// Read through the same seam production does, so the choice of rectangle
    /// is inside what these assert rather than beside it.
    fn read(area: Option<Region>) -> Vec<u8> {
        let mut renderer = renderer();
        let texture = numbered(&mut renderer);
        copy_out(&mut renderer, &texture, area_to_read(area, size())).expect("the readback runs")
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn an_area_comes_back_as_its_own_rows_packed_tight() {
        // The whole point of narrowing the readback: a 3x2 patch is 24 bytes
        // of the pixels that patch names, not 24 bytes off the front of the
        // buffer and not the buffer's stride between rows.
        let patch = read(Some(Region::new(3, 4, 3, 2)));

        assert_eq!(
            patch,
            vec![
                3, 4, 0, 255, 4, 4, 0, 255, 5, 4, 0, 255, //
                3, 5, 0, 255, 4, 5, 0, 255, 5, 5, 0, 255,
            ]
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn the_whole_buffer_still_comes_back_whole() {
        // What every frame did before there was a region, and what a frame the
        // chrome cannot patch still does. Reading the first and last pixels
        // pins the orientation the blit resolves: a flipped one puts row 7
        // where row 0 belongs, which no partial read would reveal.
        let whole = read(None);

        assert_eq!(whole.len(), (SIDE * SIDE * 4) as usize);
        assert_eq!(&whole[..4], &[0, 0, 0, 255], "the top-left pixel is (0, 0)");
        assert_eq!(
            &whole[whole.len() - 4..],
            &[7, 7, 0, 255],
            "the bottom-right pixel is (7, 7)"
        );
    }
}

#[cfg(test)]
mod tests {
    use smithay::utils::{Rectangle, Size};

    use super::area_to_read;
    use crate::Region;

    /// No renderer needed, and that is the point: this is the choice the whole
    /// change turns on, and leaving it inside a `map_or` in the GPU path put it
    /// where nothing without a GPU could reach it.
    #[test]
    fn a_damaged_region_is_the_rectangle_read() {
        let buffer: Size<i32, smithay::utils::Buffer> = (64, 48).into();

        assert_eq!(
            area_to_read(Some(Region::new(3, 4, 5, 6)), buffer),
            Rectangle::new((3, 4).into(), (5, 6).into())
        );
    }

    #[test]
    fn no_region_reads_the_whole_buffer() {
        // What a frame the chrome cannot patch needs. Reading the whole buffer
        // when a region *was* given is the dangerous direction: those pixels
        // still go out under the small region's header, and `drawFrame` slices
        // rather than checks, so the window's top-left corner is painted into
        // the damaged rectangle and nothing says so.
        let buffer: Size<i32, smithay::utils::Buffer> = (64, 48).into();

        assert_eq!(
            area_to_read(None, buffer),
            Rectangle::new((0, 0).into(), (64, 48).into())
        );
    }

    use super::preferred_device;

    #[test]
    fn prefers_hardware_over_software() {
        let devices = ["software-a", "hardware", "software-b"];
        assert_eq!(
            preferred_device(devices.into_iter(), |d| d.starts_with("software")),
            Some("hardware")
        );
    }

    #[test]
    fn falls_back_to_software_when_there_is_no_gpu() {
        let devices = ["software-a", "software-b"];
        assert_eq!(
            preferred_device(devices.into_iter(), |d| d.starts_with("software")),
            Some("software-a")
        );
    }

    #[test]
    fn finds_nothing_when_egl_lists_no_devices() {
        assert_eq!(
            preferred_device(std::iter::empty::<&str>(), |_| false),
            None
        );
    }
}
