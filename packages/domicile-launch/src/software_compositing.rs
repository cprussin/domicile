//! Whether a desktop on a tty composites on the CPU.
//!
//! A card with no 3D (2D virtio-gpu, Hyper-V, simpledrm, vkms) gives the engine
//! no GL. The engine then composites in software and scans out dumb buffers,
//! and the compositor hands it windows in shared memory instead of dmabufs.
//! Both have to agree, so the launcher decides once and tells each:
//! [`crate::spawn::composite_on_the_cpu`] and
//! [`crate::spawn::send_frames_in_memory`]. See
//! `docs/architecture/A-DESKTOP-ON-A-TTY.md#software-output`.
//!
//! - `DOMICILE_SOFTWARE_COMPOSITING=yes` or `no` decides.
//! - Otherwise the CPU composites when no DRM render node has 3D behind it.
//!   simpledrm, vkms, hyperv_drm and bochs have no render node. virtio-gpu
//!   always has one, and has 3D only with the host's virgl feature, which its
//!   virtio device lists (on PCI, the render node's device's `virtio<N>`).

use std::path::{Path, PathBuf};

/// The variable that overrides the guess.
pub const VARIABLE: &str = "DOMICILE_SOFTWARE_COMPOSITING";

/// virtio-gpu's driver, as `device/driver` names it.
const VIRTIO_GPU: &str = "virtio_gpu";

/// `VIRTIO_GPU_F_VIRGL`, the feature bit for 3D.
const VIRGL: usize = 0;

/// Why the launcher could not decide.
#[derive(Debug, thiserror::Error)]
pub enum Undecided {
    #[error("{VARIABLE} is {0:?}; it takes yes or no")]
    BadOverride(String),
    #[error(
        "cannot list {path} to see whether a card has 3D: {source}. \
         {VARIABLE}=yes or no decides without it"
    )]
    Sysfs {
        path: String,
        source: std::io::Error,
    },
}

/// Whether the CPU composites, from `overridden` (the variable's value) or
/// the render nodes under `sys_class_drm` (`/sys/class/drm`).
///
/// An empty variable counts as unset.
pub fn composites_on_the_cpu(
    overridden: Option<&str>,
    sys_class_drm: &Path,
) -> Result<bool, Undecided> {
    match overridden.filter(|value| !value.is_empty()) {
        Some("yes") => Ok(true),
        Some("no") => Ok(false),
        Some(value) => Err(Undecided::BadOverride(value.to_owned())),
        None => render_node_with_3d(sys_class_drm).map(|has_3d| !has_3d),
    }
}

/// Whether any render node under `sys_class_drm` has 3D.
fn render_node_with_3d(sys_class_drm: &Path) -> Result<bool, Undecided> {
    let unlisted = |source| Undecided::Sysfs {
        path: sys_class_drm.display().to_string(),
        source,
    };
    for entry in std::fs::read_dir(sys_class_drm).map_err(unlisted)? {
        let entry = entry.map_err(unlisted)?;
        if entry.file_name().to_string_lossy().starts_with("renderD")
            && has_3d(&entry.path().join("device"))
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Whether the device behind a render node has 3D.
fn has_3d(device: &Path) -> bool {
    let Some(virtio) = virtio_gpu(device) else {
        return true;
    };
    // One character per feature bit, lowest first.
    std::fs::read_to_string(virtio.join("features"))
        .is_ok_and(|features| features.as_bytes().get(VIRGL) == Some(&b'1'))
}

/// The virtio-gpu device behind a render node, if it is one: the node's own
/// device, or on PCI, where the node's device is the PCI function that
/// virtio-pci drives, that function's `virtio<N>`.
fn virtio_gpu(device: &Path) -> Option<PathBuf> {
    if driver(device).as_deref() == Some(VIRTIO_GPU) {
        return Some(device.to_owned());
    }
    std::fs::read_dir(device)
        .ok()?
        .flatten()
        .map(|child| child.path())
        .find(|child| {
            child
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("virtio"))
                && driver(child).as_deref() == Some(VIRTIO_GPU)
        })
}

/// The name of the driver bound to `device`.
fn driver(device: &Path) -> Option<String> {
    let driver = std::fs::read_link(device.join("driver")).ok()?;
    Some(driver.file_name()?.to_string_lossy().into_owned())
}
