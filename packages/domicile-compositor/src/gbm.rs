//! GPU buffers of the compositor's own, allocated through libgbm.
//!
//! An shm client has no dmabuf, and the engine takes nothing else, so the
//! compositor makes one per frame it copies — see [`crate::uploads`]. EGL
//! cannot allocate a dmabuf and Smithay's allocator links libgbm, which would
//! break the promise `Cargo.toml` makes about linking nothing but
//! libxkbcommon; so libgbm is `dlopen`ed, the way libEGL and libpam are.
//!
//! **A buffer is exported and the gbm object dropped at once.** The dmabuf fd
//! holds its own reference to the memory, so the compositor keeps an fd and
//! nothing else — which is also all the engine is ever handed.

use std::ffi::{c_int, c_void, CString};
use std::fs::File;
use std::os::fd::{AsRawFd as _, FromRawFd as _, OwnedFd};
use std::path::{Path, PathBuf};

use libloading::Library;
use smithay::backend::allocator::dmabuf::{Dmabuf, DmabufFlags};
use smithay::backend::allocator::{Fourcc, Modifier};
use thiserror::Error;

use crate::uploads::Shape;

/// The name every Mesa and NVIDIA install answers to.
pub const LIBRARY: &str = "libgbm.so.1";

/// Why there is no allocator. Each says what to install or what is wrong.
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

/// Why one buffer could not be made.
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
    /// The node the device was created on. libgbm does not own the fd, so it
    /// is kept open for as long as the device is.
    _node: File,
}

impl std::fmt::Debug for Gbm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Gbm").finish_non_exhaustive()
    }
}

impl Gbm {
    /// A device on `node`, through the libgbm named `library`.
    pub fn open(library: &str, node: &Path) -> Result<Gbm, NoGbm> {
        let functions = Functions::load(library)?;
        let file = File::options()
            .read(true)
            .write(true)
            .open(node)
            .map_err(|source| NoGbm::Node {
                node: node.to_path_buf(),
                source,
            })?;
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

    /// A buffer of `shape` the GPU can render into, laid out with one of
    /// `modifiers` — or as the driver likes, when none is named.
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

    /// Every plane of `bo` as a Smithay dmabuf.
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

/// `GBM_BO_USE_RENDERING`: the GPU draws into it, which is how the copy lands.
const USE_RENDERING: u32 = 1 << 2;

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

/// The entry points of libgbm this uses, and the library that keeps them
/// valid.
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
    /// Held so the entry points above stay mapped. Never read.
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

/// One entry point out of `library`, or which one it lacks.
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
        // libc is on every machine this runs on, and it is not gbm.
        let Err(NoGbm::Symbol { symbol, .. }) = Gbm::open("libc.so.6", Path::new("/dev/null"))
        else {
            panic!("a library with no gbm in it is refused");
        };
        assert_eq!(symbol, "gbm_create_device");
    }

    #[test]
    fn the_real_libgbm_has_every_entry_point_this_uses() {
        // Whether a device comes up on a file that is no GPU is Mesa's to
        // decide -- it falls back to a software one -- so what is asserted is
        // only that nothing this module calls is missing.
        let opened = Gbm::open(LIBRARY, Path::new("/dev/null"));
        assert!(
            matches!(opened, Ok(_) | Err(NoGbm::Device { .. })),
            "{opened:?}"
        );
    }
}
