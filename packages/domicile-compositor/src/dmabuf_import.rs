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
use smithay::backend::egl::native::{EGLNativeDisplay, EGLPlatform};
use smithay::backend::egl::{ffi, EGLContext, EGLDevice, EGLDisplay};
use smithay::backend::renderer::gles::GlesRenderer;
use smithay::backend::renderer::ImportDma as _;

use std::os::unix::fs::MetadataExt as _;
use std::path::{Path, PathBuf};

use crate::gbm::Gbm;

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
    let (display, node, main_device) = match EGLDevice::enumerate() {
        Ok(devices) => {
            let device =
                preferred_device(devices, EGLDevice::is_software).ok_or(ImportError::NoDevice)?;
            let main_device = drm_node(&device);
            let node = device
                .render_device_path()
                .or_else(|_| device.drm_device_path())
                .ok();
            tracing::debug!(device = ?node, main_device, "dmabuf import device");
            // SAFETY: the device comes from EGL's own enumeration, and the
            // display takes ownership of it.
            (unsafe { EGLDisplay::new(device) }?, node, main_device)
        }
        // NVIDIA's EGL offers the GBM platform but not
        // `EGL_EXT_device_enumeration`.
        Err(err) => {
            tracing::debug!(%err, "EGL cannot list devices; trying GBM on each render node");
            let (display, node) = gbm_display(Path::new("/dev/dri"))?;
            let main_device = std::fs::metadata(&node).ok().map(|node| node.rdev());
            tracing::debug!(device = ?node, main_device, "dmabuf import device");
            (display, Some(node), main_device)
        }
    };
    let context = EGLContext::new(&display)?;
    // SAFETY: the renderer is created, used and dropped on the Wayland
    // thread, which is where the context is made current.
    let renderer = unsafe { GlesRenderer::new(context) }?;
    Ok((renderer, DmabufImporter { main_device, node }))
}

/// An EGL display over libgbm on the first render node in `dir` that has one,
/// and that node.
fn gbm_display(dir: &Path) -> Result<(EGLDisplay, PathBuf), ImportError> {
    for node in render_nodes(dir) {
        let gbm = match Gbm::open(crate::gbm::LIBRARY, &node) {
            Ok(gbm) => gbm,
            Err(err) => {
                tracing::debug!(?node, %err, "no GBM device on this render node");
                continue;
            }
        };
        // SAFETY: the display keeps the device, and so its fd, alive for its
        // whole life.
        match unsafe { EGLDisplay::new(GbmDisplay(gbm)) } {
            Ok(display) => return Ok((display, node)),
            Err(err) => tracing::debug!(?node, %err, "EGL refuses this GBM device"),
        }
    }
    Err(ImportError::NoDevice)
}

/// The render nodes in `dir`, in order.
fn render_nodes(dir: &Path) -> Vec<PathBuf> {
    let mut nodes: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("renderD"))
        .map(|entry| entry.path())
        .collect();
    nodes.sort();
    nodes
}

/// A libgbm device as an EGL native display.
struct GbmDisplay(Gbm);

// SAFETY: a gbm device is not tied to the thread that made it, and the EGL
// display that owns this only uses it on the Wayland thread.
unsafe impl Send for GbmDisplay {}

impl EGLNativeDisplay for GbmDisplay {
    fn supported_platforms(&self) -> Vec<EGLPlatform<'_>> {
        let none = || vec![ffi::egl::NONE as ffi::EGLint];
        vec![
            EGLPlatform::new(
                ffi::egl::PLATFORM_GBM_KHR,
                "PLATFORM_GBM_KHR",
                self.0.raw(),
                none(),
                &["EGL_KHR_platform_gbm"],
            ),
            EGLPlatform::new(
                ffi::egl::PLATFORM_GBM_MESA,
                "PLATFORM_GBM_MESA",
                self.0.raw(),
                none(),
                &["EGL_MESA_platform_gbm"],
            ),
        ]
    }
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

    use super::{advertisable, render_nodes};

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

    #[test]
    fn render_nodes_are_listed_in_order_without_primary_nodes() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["renderD129", "card0", "renderD128", "card1"] {
            std::fs::write(dir.path().join(name), "").unwrap();
        }

        assert_eq!(
            render_nodes(dir.path()),
            [dir.path().join("renderD128"), dir.path().join("renderD129")]
        );
    }

    #[test]
    fn no_dri_directory_has_no_render_nodes() {
        assert!(render_nodes(std::path::Path::new("/nonexistent/dri")).is_empty());
    }
}
