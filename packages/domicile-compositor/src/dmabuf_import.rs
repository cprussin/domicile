//! Which device a client may allocate on, and whether a buffer it sent can be
//! imported at all.
//!
//! The compositor draws nothing: a client's dmabuf goes to the engine, which
//! composites it. What is needed here is the part that has to happen before
//! that — advertising `zwp_linux_dmabuf_v1` against a real render node, so a
//! client knows which GPU to allocate on, and answering whether a buffer it
//! committed is one EGL can take.
//!
//! Everything but the device policy is glue over EGL/GLES that cannot run
//! without a GPU, so it is deliberately thin: the buffer bookkeeping lives in
//! `dmabuf_descriptor`, where it is tested.

use smithay::backend::allocator::dmabuf::Dmabuf;
use smithay::backend::allocator::format::FormatSet;
use smithay::backend::egl::{EGLContext, EGLDevice, EGLDisplay};
use smithay::backend::renderer::gles::GlesRenderer;
use smithay::backend::renderer::ImportDma as _;

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
