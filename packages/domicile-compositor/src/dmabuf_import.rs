//! Picks the render device for `zwp_linux_dmabuf_v1` and checks that a
//! client's dmabuf imports.
//!
//! The engine composites client buffers; the compositor only tells clients
//! which GPU and formats to use and rejects buffers EGL cannot import. This is
//! thin glue over EGL and GLES, which cannot run without a GPU; the testable
//! conversion lives in `dmabuf_descriptor`.

use smithay::backend::allocator::dmabuf::Dmabuf;
use smithay::backend::allocator::format::FormatSet;
use smithay::backend::allocator::Format;
use smithay::backend::egl::{EGLContext, EGLDevice, EGLDisplay};
use smithay::backend::renderer::gles::GlesRenderer;
use smithay::backend::renderer::ImportDma as _;

use std::os::unix::fs::MetadataExt as _;
use std::path::{Path, PathBuf};

/// The EGL library Smithay loads. Probed first so a missing GPU stack is an
/// error instead of a crash.
const EGL_LIBRARY: &str = "libEGL.so.1";

/// The DRM node of the renderer that imports client buffers.
///
/// Does not own the renderer: a texture belongs to the EGL context that made
/// it, so imports must use the renderer the compositor draws with. Taking it
/// by reference lets headless and presenting compositors share this code.
pub struct DmabufImporter {
    main_device: Option<u64>,
    node: Option<PathBuf>,
}

/// Why the GPU path is unavailable, or why a buffer could not be imported.
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

/// Creates an offscreen GLES renderer on the best EGL device, for a
/// compositor that is not presenting.
///
/// Fails without a working EGL; the compositor then advertises no dmabuf
/// global and `wl_shm` clients keep working.
pub fn headless_renderer() -> Result<(GlesRenderer, DmabufImporter), ImportError> {
    // Smithay panics if EGL is missing, so try loading it first.
    // SAFETY: this opens the same library Smithay opens next, running the
    // same initializers.
    unsafe { libloading::Library::new(EGL_LIBRARY) }?;
    let devices = EGLDevice::enumerate()?;
    let device = preferred_device(devices, EGLDevice::is_software).ok_or(ImportError::NoDevice)?;
    let main_device = drm_node(&device);
    let node = device
        .render_device_path()
        .or_else(|_| device.drm_device_path())
        .ok();
    tracing::debug!(device = ?node, main_device, "dmabuf import device");
    // SAFETY: the device comes from EGL's own enumeration, and the display
    // takes ownership of it.
    let display = unsafe { EGLDisplay::new(device) }?;
    let context = EGLContext::new(&display)?;
    // SAFETY: the renderer is created, used and dropped on the Wayland
    // thread, which is where the context is made current.
    let renderer = unsafe { GlesRenderer::new(context) }?;
    Ok((renderer, DmabufImporter { main_device, node }))
}

impl DmabufImporter {
    /// The `dev_t` of the DRM node clients should allocate on, if any.
    ///
    /// Sent in `zwp_linux_dmabuf_v1` feedback. Domicile advertises no
    /// `wl_drm`, so feedback is the only way Mesa clients learn the device.
    pub fn main_device(&self) -> Option<u64> {
        self.main_device
    }

    /// The DRM node's path, for the compositor's own GPU buffers. `None` for
    /// a software rasterizer.
    pub fn node(&self) -> Option<&Path> {
        self.node.as_deref()
    }

    /// The formats to advertise on `zwp_linux_dmabuf_v1`: those both this
    /// renderer and the engine can import.
    pub fn formats(renderer: &GlesRenderer) -> FormatSet {
        advertisable(renderer.dmabuf_formats())
    }

    /// Whether a client's buffer imports. Answers the protocol's import
    /// notifier before the client can commit the buffer.
    pub fn accepts(renderer: &mut GlesRenderer, dmabuf: &Dmabuf) -> bool {
        renderer.import_dmabuf(dmabuf, None).is_ok()
    }
}

/// The `dev_t` of the DRM node a device renders on. `None` for a software
/// rasterizer.
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

/// The formats in `imported` that the engine also accepts.
///
/// Advertising a format the engine refuses would let a client pick it and
/// then have every frame rejected.
fn advertisable(imported: impl IntoIterator<Item = Format>) -> FormatSet {
    imported
        .into_iter()
        .filter(|format| crate::engine::FOURCCS.contains(&(format.code as u32)))
        .collect()
}

/// Picks the first hardware device, or else a software rasterizer.
///
/// The software fallback keeps the dmabuf path working, and testable, on
/// machines without a GPU.
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
    use smithay::backend::allocator::{Format, Fourcc, Modifier};

    use super::advertisable;

    fn format(code: Fourcc) -> Format {
        Format {
            code,
            modifier: Modifier::Linear,
        }
    }

    // A format the renderer imports but the engine refuses must not be
    // advertised: imv picked XR30 and none of its frames were drawn.
    #[test]
    fn only_what_the_engine_imports_is_advertised() {
        let renderer_imports = [
            format(Fourcc::Argb8888),
            format(Fourcc::Xrgb8888),
            format(Fourcc::Abgr8888),
            format(Fourcc::Xbgr8888),
            format(Fourcc::Xrgb2101010),
            format(Fourcc::Nv12),
        ];

        let mut advertised: Vec<Fourcc> = advertisable(renderer_imports)
            .iter()
            .map(|format| format.code)
            .collect();
        advertised.sort_by_key(|code| *code as u32);

        let mut expected = vec![
            Fourcc::Argb8888,
            Fourcc::Xrgb8888,
            Fourcc::Abgr8888,
            Fourcc::Xbgr8888,
        ];
        expected.sort_by_key(|code| *code as u32);
        assert_eq!(advertised, expected);
    }
}
