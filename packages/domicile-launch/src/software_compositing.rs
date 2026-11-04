//! Whether a desktop composites on the CPU.
//!
//! - Nested, the engine draws as its host lets it, so never.
//! - Headless, always: ozone headless imports no dmabufs. See
//!   `docs/architecture/A-HEADLESS-DESKTOP.md`.
//! - On a tty, it depends on the card, below.
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
//!   vmwgfx (VMware, VirtualBox's VMSVGA) always has one too, and says
//!   whether it has 3D only when asked ([`vmwgfx_has_3d`]).

use std::path::{Path, PathBuf};

/// The variable that overrides the guess.
pub const VARIABLE: &str = "DOMICILE_SOFTWARE_COMPOSITING";

/// virtio-gpu's driver, as `device/driver` names it.
const VIRTIO_GPU: &str = "virtio_gpu";

/// `VIRTIO_GPU_F_VIRGL`, the feature bit for 3D.
const VIRGL: usize = 0;

/// VMware's SVGA driver, as `device/driver` names it. VirtualBox's VMSVGA
/// adapter uses it too.
const VMWGFX: &str = "vmwgfx";

/// `DRM_IOCTL_VMW_GET_PARAM`: `DRM_IOWR(DRM_COMMAND_BASE + 0, struct
/// drm_vmw_getparam_arg)`, from `vmwgfx_drm.h`.
const VMW_GET_PARAM: libc::Ioctl = 0xc010_6440;

/// `DRM_VMW_PARAM_3D`.
const VMW_PARAM_3D: u32 = 2;

/// `struct drm_vmw_getparam_arg`.
#[repr(C)]
struct VmwGetParam {
    value: u64,
    param: u32,
    pad64: u32,
}

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
    #[error(
        "{VARIABLE} is no, but a headless engine shows no window from the GPU: \
         it imports no dmabufs. Unset it"
    )]
    HeadlessOnTheGpu,
    #[error(
        "cannot ask vmwgfx render node {node} whether it has 3D: {source}. \
         {VARIABLE}=yes or no decides without it"
    )]
    Vmwgfx {
        node: String,
        source: std::io::Error,
    },
}

/// Whether the CPU composites on `platform`, the engine's ozone platform.
/// `overridden` and `sys_class_drm` are as [`composites_on_the_cpu`] takes
/// them.
pub fn on_the_cpu(
    platform: &str,
    overridden: Option<&str>,
    sys_class_drm: &Path,
    vmwgfx_has_3d: impl Fn(&str) -> std::io::Result<bool>,
) -> Result<bool, Undecided> {
    match platform {
        "drm" => composites_on_the_cpu(overridden, sys_class_drm, vmwgfx_has_3d),
        "headless" => match overridden.filter(|value| !value.is_empty()) {
            None | Some("yes") => Ok(true),
            Some("no") => Err(Undecided::HeadlessOnTheGpu),
            Some(value) => Err(Undecided::BadOverride(value.to_owned())),
        },
        _ => Ok(false),
    }
}

/// Whether the CPU composites, from `overridden` (the variable's value) or
/// the render nodes under `sys_class_drm` (`/sys/class/drm`).
/// `vmwgfx_has_3d` asks a vmwgfx render node, by name, whether it has 3D:
/// [`vmwgfx_has_3d`] in production.
///
/// An empty variable counts as unset.
pub fn composites_on_the_cpu(
    overridden: Option<&str>,
    sys_class_drm: &Path,
    vmwgfx_has_3d: impl Fn(&str) -> std::io::Result<bool>,
) -> Result<bool, Undecided> {
    match overridden.filter(|value| !value.is_empty()) {
        Some("yes") => Ok(true),
        Some("no") => Ok(false),
        Some(value) => Err(Undecided::BadOverride(value.to_owned())),
        None => render_node_with_3d(sys_class_drm, vmwgfx_has_3d).map(|has_3d| !has_3d),
    }
}

/// Whether any render node under `sys_class_drm` has 3D.
fn render_node_with_3d(
    sys_class_drm: &Path,
    vmwgfx_has_3d: impl Fn(&str) -> std::io::Result<bool>,
) -> Result<bool, Undecided> {
    let unlisted = |source| Undecided::Sysfs {
        path: sys_class_drm.display().to_string(),
        source,
    };
    for entry in std::fs::read_dir(sys_class_drm).map_err(unlisted)? {
        let entry = entry.map_err(unlisted)?;
        let node = entry.file_name().to_string_lossy().into_owned();
        if node.starts_with("renderD") && has_3d(&node, &entry.path(), &vmwgfx_has_3d)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Whether the render node `node`, at `path` in sysfs, has 3D.
fn has_3d(
    node: &str,
    path: &Path,
    vmwgfx_has_3d: impl Fn(&str) -> std::io::Result<bool>,
) -> Result<bool, Undecided> {
    let device = path.join("device");
    if driver(&device).as_deref() == Some(VMWGFX) {
        return vmwgfx_has_3d(node).map_err(|source| Undecided::Vmwgfx {
            node: node.to_owned(),
            source,
        });
    }
    Ok(virtio_has_3d(&device))
}

/// Whether a device has 3D, as far as virtio-gpu's features say: any other
/// device has.
fn virtio_has_3d(device: &Path) -> bool {
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

/// Whether the vmwgfx render node `node` (as `/dev/dri` names it) has 3D.
///
/// vmwgfx has a render node with or without 3D, and only the driver knows
/// which. Mesa asks it the same way.
pub fn vmwgfx_has_3d(node: &str) -> std::io::Result<bool> {
    let device = std::fs::File::open(Path::new("/dev/dri").join(node))?;
    let mut asked = VmwGetParam {
        value: 0,
        param: VMW_PARAM_3D,
        pad64: 0,
    };
    // SAFETY: `asked` is the `drm_vmw_getparam_arg` this request reads and
    // writes, and lives for the call.
    let answered = unsafe {
        libc::ioctl(
            std::os::fd::AsRawFd::as_raw_fd(&device),
            VMW_GET_PARAM,
            &raw mut asked,
        )
    };
    match answered {
        0 => Ok(asked.value != 0),
        _ => Err(std::io::Error::last_os_error()),
    }
}
