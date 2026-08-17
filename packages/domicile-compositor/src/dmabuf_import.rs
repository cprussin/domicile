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
use smithay::utils::{Rectangle, Transform};
use std::os::unix::fs::MetadataExt as _;

/// The EGL entry point Smithay itself loads. Probing it first is what turns
/// "this machine has no GPU stack" from a crash into an answer.
const EGL_LIBRARY: &str = "libEGL.so.1";

/// A GLES renderer used for one thing: turning a client's dmabuf into pixels.
pub struct DmabufImporter {
    renderer: GlesRenderer,
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

impl DmabufImporter {
    /// Bring up an offscreen GLES renderer on the best device EGL offers.
    ///
    /// Fails on a machine with no working EGL at all; the compositor treats
    /// that as "no dmabuf global", so `wl_shm` clients keep working.
    pub fn new() -> Result<Self, ImportError> {
        // Smithay dlopens EGL lazily and treats a missing library as fatal, so
        // the load has to be attempted here — where it is an error value —
        // before any Smithay EGL call can panic on it.
        // SAFETY: this opens the very library Smithay opens a moment later,
        // running the same initialisers it would have run itself.
        unsafe { libloading::Library::new(EGL_LIBRARY) }?;
        let devices = EGLDevice::enumerate()?;
        let device =
            preferred_device(devices, EGLDevice::is_software).ok_or(ImportError::NoDevice)?;
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
        Ok(DmabufImporter {
            renderer,
            main_device,
        })
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
    pub fn formats(&self) -> FormatSet {
        self.renderer.dmabuf_formats()
    }

    /// Whether a client's buffer really imports, answering the protocol's
    /// import notifier before the client can commit it.
    pub fn accepts(&mut self, dmabuf: &Dmabuf) -> bool {
        self.renderer.import_dmabuf(dmabuf, None).is_ok()
    }

    /// Import `dmabuf` and copy it out as tightly-packed, top-down RGBA — the
    /// same byte layout the `wl_shm` path produces, so both feed one
    /// `HostMessage::AppFrame`.
    /// Entry and exit are logged because this is the one path no test can
    /// reach: it needs a GPU and a client that allocates on it, so the log is
    /// the only account of whether a frame made it through.
    pub fn read_rgba(&mut self, dmabuf: &Dmabuf) -> Result<Vec<u8>, ImportError> {
        tracing::debug!("readback: import");
        let texture = self.renderer.import_dmabuf(dmabuf, None)?;
        let size = dmabuf.size();
        let buffer_area = Rectangle::from_size(size);
        // The blit is what makes the copy format-agnostic: whatever the client
        // allocated (tiled, compressed, BGR, Y-inverted) is resolved by the
        // sampler into one plain RGBA8 surface we can read straight out.
        let mut offscreen: GlesTexture = self.renderer.create_buffer(Fourcc::Abgr8888, size)?;
        let mut framebuffer = self.renderer.bind(&mut offscreen)?;
        let render_area = Rectangle::from_size((size.w, size.h).into());
        let drawn = {
            let mut frame = self.renderer.render(
                &mut framebuffer,
                (size.w, size.h).into(),
                Transform::Normal,
            )?;
            Frame::render_texture_from_to(
                &mut frame,
                &texture,
                buffer_area.to_f64(),
                render_area,
                &[render_area],
                &[],
                Transform::Normal,
                1.0,
            )?;
            frame.finish()?
        };
        self.renderer.wait(&drawn)?;
        let mapping =
            self.renderer
                .copy_framebuffer(&framebuffer, buffer_area, Fourcc::Abgr8888)?;
        let pixels = self.renderer.map_texture(&mapping)?.to_vec();
        tracing::debug!(bytes = pixels.len(), "readback: done");
        Ok(pixels)
    }
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

#[cfg(test)]
mod tests {
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
