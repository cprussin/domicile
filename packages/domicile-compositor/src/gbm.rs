//! Allocates the compositor's own GPU buffers through libgbm.
//!
//! The engine accepts only dmabufs, so shm frames are copied into these (see
//! [`crate::uploads`]). libgbm is `dlopen`ed, like libEGL and libpam, because
//! `Cargo.toml` links only libxkbcommon.
//!
//! Each buffer is exported and its gbm object destroyed at once. The dmabuf fd
//! keeps the memory alive.
//!
//! A device that cannot allocate on its render node, such as vgem under WSL2,
//! is opened on its primary node instead (see [`crate::primary_node`]).

use std::ffi::{c_int, c_void, CString};
use std::fs::File;
use std::os::fd::{AsRawFd as _, FromRawFd as _, OwnedFd};
use std::path::{Path, PathBuf};

use libloading::Library;
use smithay::backend::allocator::dmabuf::{Dmabuf, DmabufFlags};
use smithay::backend::allocator::{Fourcc, Modifier};
use thiserror::Error;
use tracing::warn;

use crate::primary_node::{primary_node_of, DeviceNumber, NoPrimaryNode};
use crate::uploads::Shape;

/// The libgbm soname on Mesa and NVIDIA installs.
pub const LIBRARY: &str = "libgbm.so.1";

/// Why the allocator could not be created. Each message says what to fix.
#[derive(Debug, Error)]
pub enum NoGbm {
    #[error("{library} is not loadable, so shm clients cannot be shown: {source}")]
    Library {
        library: String,
        #[source]
        source: libloading::Error,
    },
    #[error(
        "{library} has no {symbol}: it is not libgbm, or one too old to allocate with modifiers"
    )]
    Symbol {
        library: String,
        symbol: &'static str,
        #[source]
        source: libloading::Error,
    },
    #[error("cannot open the render node {node}: {source}")]
    Node {
        node: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("libgbm has no backend for {node}: it is not a GPU this libgbm knows")]
    Device { node: PathBuf },
}

/// Why the primary node gave no device that allocates.
#[derive(Debug, Error)]
enum NoFallback {
    #[error(transparent)]
    NoNode(#[from] NoPrimaryNode),
    #[error("cannot open {node}; is this user in the video group? {source}")]
    Open {
        node: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error(transparent)]
    NoGbm(#[from] NoGbm),
    #[error("libgbm allocates nothing on {node} either")]
    Refused { node: PathBuf },
}

/// Why a buffer could not be allocated.
#[derive(Debug, Error)]
pub enum AllocationError {
    #[error("libgbm would not allocate a {width}x{height} buffer of fourcc {fourcc:#010x}")]
    Refused {
        width: u32,
        height: u32,
        fourcc: u32,
    },
    #[error("libgbm allocated a buffer and would not export it as a dmabuf")]
    Export,
}

/// A libgbm device on one render node.
pub struct Gbm {
    functions: Functions,
    device: *mut c_void,
    /// The render node. libgbm does not own the fd, so it stays open for the
    /// device's lifetime.
    _node: File,
}

impl std::fmt::Debug for Gbm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Gbm").finish_non_exhaustive()
    }
}

impl Gbm {
    /// Opens a device on the render node `node` through the libgbm named
    /// `library`.
    ///
    /// If it cannot allocate there, as `kms_swrast` cannot on vgem, the
    /// device's primary node is tried. Either way the warning says so. On a
    /// GPU with a GBM driver the probe passes and the primary node is never
    /// opened, so a tty desk, where the engine holds DRM master, is never
    /// raced for it.
    pub fn open(library: &str, node: &Path) -> Result<Gbm, NoGbm> {
        let functions = Functions::load(library)?;
        let render = Gbm::on(functions, node)?;
        if render.allocates() {
            return Ok(render);
        }
        match Gbm::on_the_primary_node_of(library, node) {
            Ok((primary, gbm)) => {
                warn!(
                    render = %node.display(),
                    primary = %primary.display(),
                    "libgbm allocates nothing on the render node, as Mesa's kms_swrast \
                     cannot; allocating on the same device's primary node instead"
                );
                Ok(gbm)
            }
            Err(why) => {
                warn!(
                    render = %node.display(),
                    %why,
                    "libgbm allocates nothing on the render node, and not on its primary \
                     node either; shared-memory windows will be blank"
                );
                Ok(render)
            }
        }
    }

    /// A device on `node`, opened read-write.
    fn on(functions: Functions, node: &Path) -> Result<Gbm, NoGbm> {
        let file = File::options()
            .read(true)
            .write(true)
            .open(node)
            .map_err(|source| NoGbm::Node {
                node: node.to_path_buf(),
                source,
            })?;
        Gbm::over(functions, file, node)
    }

    /// A device over the open node `file`, which it keeps.
    fn over(functions: Functions, file: File, node: &Path) -> Result<Gbm, NoGbm> {
        // SAFETY: a live fd, kept open beside the device for its whole life.
        let device = unsafe { (functions.create_device)(file.as_raw_fd()) };
        if device.is_null() {
            Err(NoGbm::Device {
                node: node.to_path_buf(),
            })
        } else {
            Ok(Gbm {
                functions,
                device,
                _node: file,
            })
        }
    }

    /// A device on the primary node of the device behind the render node
    /// `render`, if it allocates, and the node.
    fn on_the_primary_node_of(library: &str, render: &Path) -> Result<(PathBuf, Gbm), NoFallback> {
        let number = DeviceNumber::of(render).ok_or(NoPrimaryNode::NotADevice)?;
        let primary = primary_node_of(
            number,
            Path::new("/sys"),
            Path::new("/dev/dri"),
            DeviceNumber::of,
        )?;
        let file = File::options()
            .read(true)
            .write(true)
            .open(&primary)
            .map_err(|source| NoFallback::Open {
                node: primary.clone(),
                source,
            })?;
        // The first to open a primary node with no master becomes it. Off a
        // tty nothing else wants master, but holding it would still stop a
        // later DRM client taking it.
        //
        // SAFETY: an ioctl with no argument on a live fd.
        unsafe { libc::ioctl(file.as_raw_fd(), DRM_IOCTL_DROP_MASTER) };
        let gbm = Gbm::over(Functions::load(library)?, file, &primary)?;
        if gbm.allocates() {
            Ok((primary, gbm))
        } else {
            Err(NoFallback::Refused { node: primary })
        }
    }

    /// Whether a small renderable buffer allocates: the probe for a device
    /// that opens but allocates nothing.
    fn allocates(&self) -> bool {
        // SAFETY: a live device.
        let bo =
            unsafe { (self.functions.bo_create)(self.device, 64, 64, ARGB8888, USE_RENDERING) };
        if bo.is_null() {
            return false;
        }
        // SAFETY: the object allocated above, destroyed once.
        unsafe { (self.functions.bo_destroy)(bo) };
        true
    }

    /// Allocates a renderable buffer of `shape` with one of `modifiers`, or the
    /// driver's choice if `modifiers` is empty.
    pub fn allocate(&self, shape: Shape, modifiers: &[u64]) -> Result<Dmabuf, AllocationError> {
        let Shape {
            width,
            height,
            fourcc,
        } = shape;
        // SAFETY: a live device, and a modifier list that outlives the call.
        let bo = unsafe {
            if modifiers.is_empty() {
                (self.functions.bo_create)(self.device, width, height, fourcc, USE_RENDERING)
            } else {
                (self.functions.bo_create_with_modifiers2)(
                    self.device,
                    width,
                    height,
                    fourcc,
                    modifiers.as_ptr(),
                    modifiers.len() as u32,
                    USE_RENDERING,
                )
            }
        };
        if bo.is_null() {
            return Err(AllocationError::Refused {
                width,
                height,
                fourcc,
            });
        }
        let exported = self.export(bo, shape);
        // SAFETY: the object allocated above, destroyed once. The dmabuf fds
        // hold their own references to its memory.
        unsafe { (self.functions.bo_destroy)(bo) };
        exported
    }

    /// Exports every plane of `bo` as a Smithay dmabuf.
    fn export(&self, bo: *mut c_void, shape: Shape) -> Result<Dmabuf, AllocationError> {
        let format = Fourcc::try_from(shape.fourcc).map_err(|_| AllocationError::Export)?;
        // SAFETY: `bo` is live for the whole of this function.
        let (planes, modifier) = unsafe {
            (
                (self.functions.bo_get_plane_count)(bo),
                (self.functions.bo_get_modifier)(bo),
            )
        };
        let mut builder = Dmabuf::builder(
            (shape.width as i32, shape.height as i32),
            format,
            Modifier::from(modifier),
            DmabufFlags::empty(),
        );
        for plane in 0..planes {
            // SAFETY: as above, and `plane` is below the count it reported.
            let (fd, offset, stride) = unsafe {
                (
                    (self.functions.bo_get_fd_for_plane)(bo, plane),
                    (self.functions.bo_get_offset)(bo, plane),
                    (self.functions.bo_get_stride_for_plane)(bo, plane),
                )
            };
            if fd < 0 {
                return Err(AllocationError::Export);
            }
            // SAFETY: libgbm hands the caller a new fd per call.
            let fd = unsafe { OwnedFd::from_raw_fd(fd) };
            builder.add_plane(fd, plane as u32, offset, stride);
        }
        builder.build().ok_or(AllocationError::Export)
    }
}

impl Drop for Gbm {
    fn drop(&mut self) {
        // SAFETY: the device `open` created, destroyed once.
        unsafe { (self.functions.device_destroy)(self.device) };
    }
}

/// `GBM_BO_USE_RENDERING`: the copy is drawn into the buffer by the GPU.
const USE_RENDERING: u32 = 1 << 2;

/// `GBM_FORMAT_ARGB8888`, the probe's format.
const ARGB8888: u32 = u32::from_le_bytes(*b"AR24");

/// `DRM_IOCTL_DROP_MASTER`: `_IO('d', 0x1f)`.
const DRM_IOCTL_DROP_MASTER: libc::c_ulong = 0x641f;

type CreateDevice = unsafe extern "C" fn(fd: c_int) -> *mut c_void;
type DeviceDestroy = unsafe extern "C" fn(device: *mut c_void);
type BoCreate = unsafe extern "C" fn(
    device: *mut c_void,
    width: u32,
    height: u32,
    format: u32,
    flags: u32,
) -> *mut c_void;
type BoCreateWithModifiers2 = unsafe extern "C" fn(
    device: *mut c_void,
    width: u32,
    height: u32,
    format: u32,
    modifiers: *const u64,
    count: u32,
    flags: u32,
) -> *mut c_void;
type BoDestroy = unsafe extern "C" fn(bo: *mut c_void);
type BoGetPlaneCount = unsafe extern "C" fn(bo: *mut c_void) -> c_int;
type BoGetModifier = unsafe extern "C" fn(bo: *mut c_void) -> u64;
type BoGetFdForPlane = unsafe extern "C" fn(bo: *mut c_void, plane: c_int) -> c_int;
type BoGetOffset = unsafe extern "C" fn(bo: *mut c_void, plane: c_int) -> u32;
type BoGetStrideForPlane = unsafe extern "C" fn(bo: *mut c_void, plane: c_int) -> u32;

/// The libgbm entry points this module uses.
struct Functions {
    create_device: CreateDevice,
    device_destroy: DeviceDestroy,
    bo_create: BoCreate,
    bo_create_with_modifiers2: BoCreateWithModifiers2,
    bo_destroy: BoDestroy,
    bo_get_plane_count: BoGetPlaneCount,
    bo_get_modifier: BoGetModifier,
    bo_get_fd_for_plane: BoGetFdForPlane,
    bo_get_offset: BoGetOffset,
    bo_get_stride_for_plane: BoGetStrideForPlane,
    /// Keeps the entry points mapped. Never read.
    _library: Library,
}

impl Functions {
    fn load(library: &str) -> Result<Functions, NoGbm> {
        // SAFETY: loading a library runs its initializers; libgbm's are the
        // ones every GPU client on the machine runs.
        let loaded = unsafe { Library::new(library) }.map_err(|source| NoGbm::Library {
            library: library.to_string(),
            source,
        })?;
        // SAFETY: each type above is the prototype in `gbm.h`.
        unsafe {
            Ok(Functions {
                create_device: symbol(&loaded, library, "gbm_create_device")?,
                device_destroy: symbol(&loaded, library, "gbm_device_destroy")?,
                bo_create: symbol(&loaded, library, "gbm_bo_create")?,
                bo_create_with_modifiers2: symbol(
                    &loaded,
                    library,
                    "gbm_bo_create_with_modifiers2",
                )?,
                bo_destroy: symbol(&loaded, library, "gbm_bo_destroy")?,
                bo_get_plane_count: symbol(&loaded, library, "gbm_bo_get_plane_count")?,
                bo_get_modifier: symbol(&loaded, library, "gbm_bo_get_modifier")?,
                bo_get_fd_for_plane: symbol(&loaded, library, "gbm_bo_get_fd_for_plane")?,
                bo_get_offset: symbol(&loaded, library, "gbm_bo_get_offset")?,
                bo_get_stride_for_plane: symbol(&loaded, library, "gbm_bo_get_stride_for_plane")?,
                _library: loaded,
            })
        }
    }
}

/// Loads one entry point from `library`, or names the missing one.
///
/// # Safety
///
/// `T` has to be the entry point's real type.
unsafe fn symbol<T: Copy>(loaded: &Library, library: &str, name: &'static str) -> Result<T, NoGbm> {
    let c_name = CString::new(name).expect("symbol names have no NUL");
    loaded
        .get::<T>(c_name.as_bytes_with_nul())
        .map(|found| *found)
        .map_err(|source| NoGbm::Symbol {
            library: library.to_string(),
            symbol: name,
            source,
        })
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{Gbm, NoGbm, LIBRARY};

    #[test]
    fn a_machine_without_libgbm_is_said_by_name() {
        let Err(NoGbm::Library { library, .. }) =
            Gbm::open("libdomicile-no-such-gbm.so.1", Path::new("/dev/null"))
        else {
            panic!("a library that is not there is refused");
        };
        assert_eq!(library, "libdomicile-no-such-gbm.so.1");
    }

    #[test]
    fn a_library_that_is_not_libgbm_is_said_by_what_it_lacks() {
        // libc is always present and has no gbm symbols.
        let Err(NoGbm::Symbol { symbol, .. }) = Gbm::open("libc.so.6", Path::new("/dev/null"))
        else {
            panic!("a library with no gbm in it is refused");
        };
        assert_eq!(symbol, "gbm_create_device");
    }

    #[test]
    fn the_real_libgbm_has_every_entry_point_this_uses() {
        // Mesa may fall back to a software device on a non-GPU file, so only
        // assert that no entry point is missing.
        let opened = Gbm::open(LIBRARY, Path::new("/dev/null"));
        assert!(
            matches!(opened, Ok(_) | Err(NoGbm::Device { .. })),
            "{opened:?}"
        );
    }
}
