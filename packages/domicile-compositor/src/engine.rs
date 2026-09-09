//! `libdomicile_engine.so` behind its C ABI: the seam to the forked engine.
//!
//! The compositor submits a client's dmabuf to viz through this instead of
//! reading it back and sending pixels to the chrome. See
//! `docs/architecture/ENGINE-FORK.md`, "The seam: a C ABI, and what crosses
//! it", and `packages/domicile-engine` for the library itself.
//!
//! **Loaded with `dlopen`, and that is a build decision rather than a runtime
//! one.** The library is a GN artifact that exists only where Chromium is
//! built, so linking it would make `cargo build` need a Chromium checkout —
//! which CI does not have. Loading it by name keeps the build working
//! everywhere.
//!
//! It is *not* a licence to carry on without it. A caller that asked for the
//! engine and cannot have it gets an error naming the library and why; nothing
//! here degrades quietly, because a compositor that comes up and shows nothing
//! is the defect `ERRORS.md` exists to prevent.
//!

use std::cell::RefCell;
use std::ffi::{c_char, c_int, c_void, CString, NulError};
use std::os::fd::RawFd;
use std::path::{Path, PathBuf};

use crate::dmabuf_descriptor::DmabufDescriptor;
use libloading::{Library, Symbol};
use thiserror::Error;

/// The default name. Found on `LD_LIBRARY_PATH` like any other library, which
/// is how a build of the engine is pointed at without a path being compiled in.
pub const LIBRARY: &str = "libdomicile_engine.so";

/// A surface, as the engine names one. Never zero.
pub type SurfaceId = u32;

/// An imported buffer, as the engine names one. Never zero.
pub type BufferId = u64;

/// What went wrong reaching the engine. Every variant names the library,
/// because the commonest cause by far is that it was never built.
#[derive(Debug, Error)]
pub enum EngineError {
    #[error("could not load {path} ({LIBRARY} for the forked engine): {source}. It is built by packages/domicile-engine/scripts/build.sh and is not on this machine unless that has been run")]
    Library {
        path: PathBuf,
        #[source]
        source: libloading::Error,
    },

    #[error("{path} loaded but has no {symbol}: it is not {LIBRARY}, or it is an older one than this compositor was built against")]
    Symbol {
        path: PathBuf,
        symbol: &'static str,
        #[source]
        source: libloading::Error,
    },

    #[error("{LIBRARY} would not join the browser at {socket}: the engine is not running, or it was started without --domicile-broker-socket={socket}")]
    Connect { socket: PathBuf },

    #[error("the browser brokered no frame sink for {app_id}")]
    NoFrameSink { app_id: String },

    #[error("a path the engine has to be told contains a nul byte: {0}")]
    Path(#[from] NulError),
}

/// One plane of a client's dmabuf, as `zwp_linux_buffer_params_v1.add` sent it.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Plane {
    pub fd: c_int,
    pub offset: u32,
    pub stride: u32,
}

/// The most planes the ABI carries. Four is what `zwp_linux_dmabuf_v1` allows
/// and what `DomicileDmabuf` has room for.
pub const MAX_PLANES: usize = 4;

/// A client's buffer, as the ABI takes it. The fds are borrowed for the
/// duration of the call.
#[repr(C)]
pub struct Dmabuf {
    pub width: u32,
    pub height: u32,
    pub fourcc: u32,
    pub modifier: u64,
    pub plane_count: u32,
    pub planes: [Plane; MAX_PLANES],
}

impl Dmabuf {
    /// The same buffer the bridge describes, in the ABI's terms.
    ///
    /// `None` for a buffer with no planes or more than [`MAX_PLANES`] — the
    /// first cannot be drawn and the second cannot be described, and silently
    /// sending four planes of a five-plane buffer would put a corrupt window on
    /// the screen rather than no window.
    pub fn from_descriptor(descriptor: &DmabufDescriptor) -> Option<Self> {
        if descriptor.planes.is_empty() || descriptor.planes.len() > MAX_PLANES {
            return None;
        }
        let mut planes = [Plane {
            fd: -1,
            offset: 0,
            stride: 0,
        }; MAX_PLANES];
        for (slot, plane) in planes.iter_mut().zip(&descriptor.planes) {
            *slot = Plane {
                fd: plane.fd,
                offset: plane.offset,
                stride: plane.stride,
            };
        }
        Some(Self {
            width: descriptor.width,
            height: descriptor.height,
            fourcc: descriptor.fourcc,
            modifier: descriptor.modifier,
            plane_count: descriptor.planes.len() as u32,
            planes,
        })
    }
}

/// What the browser has to tell the compositor, and what each already is in
/// Wayland terms.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    /// `xdg_toplevel.configure`: the page's layout box changed.
    Configure {
        surface: SurfaceId,
        width: u32,
        height: u32,
    },
    /// `wl_surface.frame`: viz asked for a frame.
    Frame {
        surface: SurfaceId,
        deadline_us: u64,
    },
    /// `wl_buffer.release`: viz has stopped sampling that dmabuf, and not one
    /// moment sooner may the client draw into it again.
    Released {
        surface: SurfaceId,
        buffer: BufferId,
    },
}

#[repr(C)]
struct Callbacks {
    user_data: *mut c_void,
    configure: Option<extern "C" fn(*mut c_void, SurfaceId, u32, u32)>,
    frame: Option<extern "C" fn(*mut c_void, SurfaceId, u64)>,
    released: Option<extern "C" fn(*mut c_void, SurfaceId, BufferId)>,
}

/// The engine's opaque handle.
#[repr(C)]
struct Handle {
    _private: [u8; 0],
}

/// A loaded engine, connected to the browser.
///
/// Callbacks fire only from inside [`Engine::dispatch`], on the thread that
/// calls it, which is what lets this hand them back as a plain vector instead
/// of asking the compositor to be thread-safe.
#[derive(Debug)]
pub struct Engine {
    handle: *mut Handle,
    events: Box<RefCell<Vec<Event>>>,
    library: Library,
    path: PathBuf,
}

/// `DomicileSpikeCapture`, exactly as the C header lays it out.
///
/// Six `int32_t` in a struct rather than an array, because Chromium builds
/// with `-Wunsafe-buffer-usage` and indexing a bare pointer is an error there.
/// Not public: [`Capture`] is what a caller wants, and this shape only exists
/// to be filled in across the ABI.
#[derive(Default)]
#[repr(C)]
struct RawCapture {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    window_width: i32,
    window_height: i32,
}

/// Where a colour is in the browser's window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// THROWAWAY, with the rest of the spike. What one look at the browser's
/// window found.
///
/// `window` is the captured bitmap's size, which is not obliged to be the size
/// the browser was asked for — and a probe that could not say so is what makes
/// a coordinate bug look like a missing surface. `bounds` is the colour's
/// whole extent, or `None` if it is not in the window at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Capture {
    pub window: (i32, i32),
    pub bounds: Option<Bounds>,
}

impl Engine {
    /// Loads the library and joins the browser's mojo graph over `socket`.
    /// Surfaces come afterwards, one per window, from [`Engine::create_surface`].
    ///
    /// `library` is a name or a path; a bare name is looked up the way `dlopen`
    /// looks one up.
    pub fn load(library: impl AsRef<Path>, socket: impl AsRef<Path>) -> Result<Self, EngineError> {
        let path = library.as_ref().to_path_buf();
        // SAFETY: loading a library runs its initialisers, which is why this is
        // unsafe; there is no safe way to dlopen and the alternative is linking,
        // which is the thing this exists to avoid.
        let library = unsafe { Library::new(&path) }.map_err(|source| EngineError::Library {
            path: path.clone(),
            source,
        })?;

        let events = Box::new(RefCell::new(Vec::new()));
        let callbacks = Callbacks {
            user_data: (&*events as *const RefCell<Vec<Event>>) as *mut c_void,
            configure: Some(on_configure),
            frame: Some(on_frame),
            released: Some(on_released),
        };

        let socket_path = socket.as_ref().to_path_buf();
        let socket_c = CString::new(socket_path.as_os_str().as_encoded_bytes())?;

        let connect: Symbol<unsafe extern "C" fn(*const c_char, Callbacks) -> *mut Handle> =
            symbol(
                &library,
                &path,
                b"domicile_engine_connect\0",
                "domicile_engine_connect",
            )?;
        // SAFETY: the signature matches domicile_engine.h, the string is
        // nul-terminated by CString, and `events` outlives the handle because
        // both are owned by the value being built here.
        let handle = unsafe { connect(socket_c.as_ptr(), callbacks) };
        if handle.is_null() {
            return Err(EngineError::Connect {
                socket: socket_path,
            });
        }

        Ok(Self {
            handle,
            events,
            library,
            path,
        })
    }

    /// The fd to poll. Readable exactly when [`Engine::dispatch`] has something
    /// to do, which is what makes it a `calloop` source and not a timer.
    pub fn fd(&self) -> RawFd {
        let f: Symbol<unsafe extern "C" fn(*mut Handle) -> c_int> = self
            .symbol(b"domicile_engine_fd\0", "domicile_engine_fd")
            .expect("the library was checked at load");
        // SAFETY: the handle is live for the life of self.
        unsafe { f(self.handle) }
    }

    /// Runs the work the fd woke us for and returns what the browser said.
    pub fn dispatch(&self) -> Vec<Event> {
        let f: Symbol<unsafe extern "C" fn(*mut Handle)> = self
            .symbol(b"domicile_engine_dispatch\0", "domicile_engine_dispatch")
            .expect("the library was checked at load");
        // SAFETY: as above. The callbacks fire synchronously inside this call,
        // on this thread, and push into `events`.
        unsafe { f(self.handle) };
        self.events.borrow_mut().drain(..).collect()
    }

    /// Asks the browser to broker a frame sink. This is a window appearing.
    pub fn create_surface(&self, app_id: &str) -> Result<SurfaceId, EngineError> {
        let name = CString::new(app_id)?;
        let f: Symbol<unsafe extern "C" fn(*mut Handle, *const c_char) -> SurfaceId> =
            self.symbol(b"domicile_surface_create\0", "domicile_surface_create")?;
        // SAFETY: as above.
        let surface = unsafe { f(self.handle, name.as_ptr()) };
        if surface == 0 {
            return Err(EngineError::NoFrameSink {
                app_id: app_id.to_owned(),
            });
        }
        Ok(surface)
    }

    /// Imports a client's dmabuf. `None` if the browser refused it — which on
    /// an ozone platform without `CreateNativePixmapFromHandle` it always will.
    ///
    /// The fds are borrowed: the caller keeps the client's `wl_buffer`.
    pub fn import(&self, surface: SurfaceId, dmabuf: &Dmabuf) -> Option<BufferId> {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, SurfaceId, *const Dmabuf) -> BufferId> =
            self.symbol(b"domicile_surface_import\0", "domicile_surface_import")
                .ok()?;
        // SAFETY: as above, and `dmabuf` outlives the call.
        let buffer = unsafe { f(self.handle, surface, dmabuf as *const Dmabuf) };
        (buffer != 0).then_some(buffer)
    }

    /// Submits a frame showing `buffer`. An empty damage rectangle means the
    /// whole surface. This is `wl_surface.commit`.
    pub fn submit(&self, surface: SurfaceId, buffer: BufferId, damage: (i32, i32, i32, i32)) {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, SurfaceId, BufferId, i32, i32, i32, i32)> =
            match self.symbol(b"domicile_surface_submit\0", "domicile_surface_submit") {
                Ok(symbol) => symbol,
                Err(_) => return,
            };
        let (x, y, width, height) = damage;
        // SAFETY: as above.
        unsafe { f(self.handle, surface, buffer, x, y, width, height) };
    }

    /// Drops an imported buffer, when the client destroys the `wl_buffer`
    /// behind it.
    pub fn forget(&self, surface: SurfaceId, buffer: BufferId) {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, SurfaceId, BufferId)> =
            match self.symbol(b"domicile_buffer_destroy\0", "domicile_buffer_destroy") {
                Ok(symbol) => symbol,
                Err(_) => return,
            };
        // SAFETY: as above.
        unsafe { f(self.handle, surface, buffer) };
    }

    /// THROWAWAY, with the rest of the spike. What the display compositor drew
    /// at the centre of the browser's window, which is where every spike page
    /// puts the `<app>`.
    ///
    /// Here because only one process may hold the browser's invitation and the
    /// compositor is now that process, so nothing else can ask. It goes when
    /// the spike's pages do.
    pub fn spike_window_centre(&self) -> Option<u32> {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, *mut u32) -> bool> = self
            .symbol(
                b"domicile_engine_spike_sample_window_center\0",
                "domicile_engine_spike_sample_window_center",
            )
            .ok()?;
        let mut argb = 0u32;
        // SAFETY: as elsewhere — the handle is live, and `argb` outlives the
        // call.
        unsafe { f(self.handle, &mut argb) }.then_some(argb)
    }

    /// THROWAWAY, with the rest of the spike. What the display compositor drew
    /// at `x`, `y` in the browser's window.
    ///
    /// The centre stops being enough the moment a page holds two `<app>`
    /// elements: side by side, no pixel is inside both, and two windows on one
    /// page is the claim the broker's unit tests cannot make for themselves.
    pub fn spike_pixel(&self, x: i32, y: i32) -> Option<u32> {
        // The two failures are told apart rather than merged into one `None`.
        // A missing symbol means the library was built without this — an old
        // out/ directory, or a build that did not include it — and a refused
        // call means the point is outside the window. They have nothing in
        // common and the first is invisible unless it is said.
        let f: Symbol<unsafe extern "C" fn(*mut Handle, i32, i32, *mut u32) -> bool> = match self
            .symbol(
                b"domicile_engine_spike_sample_pixel\0",
                "domicile_engine_spike_sample_pixel",
            ) {
            Ok(symbol) => symbol,
            Err(err) => {
                tracing::error!(
                    %err,
                    "libdomicile_engine.so has no \
                     domicile_engine_spike_sample_pixel; it was built before the probe \
                     grew a coordinate. Rebuild it: autoninja -C out/Domicile \
                     domicile_engine"
                );
                return None;
            }
        };
        let mut argb = 0u32;
        // SAFETY: as elsewhere — the handle is live, and `argb` outlives the
        // call.
        unsafe { f(self.handle, x, y, &mut argb) }.then_some(argb)
    }

    /// THROWAWAY, with the rest of the spike. Where `argb` is in the
    /// browser's window, and how big that window is.
    ///
    /// `None` means nothing could be read — no window, nothing drawn, or no
    /// probe. That is not the same as the colour being absent, and a guard's
    /// negative control turns on the difference: "the colour is not there" is
    /// the control passing and "nothing was read" is the control having
    /// measured nothing while looking identical.
    pub fn spike_find(&self, argb: u32) -> Option<Capture> {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, u32, *mut RawCapture) -> i32> = match self
            .symbol(
                b"domicile_engine_spike_find_colour\0",
                "domicile_engine_spike_find_colour",
            ) {
            Ok(symbol) => symbol,
            Err(err) => {
                tracing::error!(
                    %err,
                    "libdomicile_engine.so has no domicile_engine_spike_find_colour; it was \
                     built before the shell guard existed. Rebuild it: autoninja -C \
                     out/Domicile domicile_engine"
                );
                return None;
            }
        };
        // Zeroed, so that a field the library does not write is read as 0
        // rather than as whatever was on the stack — the contract says only
        // the size is written on 0, and only the box as well on 1.
        let mut out = RawCapture::default();
        // SAFETY: as elsewhere — the handle is live, and `out` is the
        // `DomicileSpikeCapture` the header documents and outlives the call.
        let status = unsafe { f(self.handle, argb, &mut out) };
        let window = (out.window_width, out.window_height);
        match status {
            0 => Some(Capture {
                window,
                bounds: None,
            }),
            1 => Some(Capture {
                window,
                bounds: Some(Bounds {
                    height: out.height,
                    width: out.width,
                    x: out.x,
                    y: out.y,
                }),
            }),
            _ => None,
        }
    }

    fn symbol<T>(&self, name: &[u8], readable: &'static str) -> Result<Symbol<'_, T>, EngineError> {
        symbol(&self.library, &self.path, name, readable)
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        if let Ok(f) = self.symbol::<unsafe extern "C" fn(*mut Handle)>(
            b"domicile_engine_destroy\0",
            "domicile_engine_destroy",
        ) {
            // SAFETY: the handle is live until exactly here, and nothing uses
            // it afterwards.
            unsafe { f(self.handle) };
        }
    }
}

fn symbol<'library, T>(
    library: &'library Library,
    path: &Path,
    name: &[u8],
    readable: &'static str,
) -> Result<Symbol<'library, T>, EngineError> {
    // SAFETY: the caller states the signature, and every call site here states
    // one that matches domicile_engine.h.
    unsafe { library.get(name) }.map_err(|source| EngineError::Symbol {
        path: path.to_path_buf(),
        symbol: readable,
        source,
    })
}

/// The three callbacks, which do nothing but queue: they fire inside
/// `dispatch`, and what to do about them is the compositor's business rather
/// than this module's.
extern "C" fn on_configure(user_data: *mut c_void, surface: SurfaceId, width: u32, height: u32) {
    push(
        user_data,
        Event::Configure {
            surface,
            width,
            height,
        },
    );
}

extern "C" fn on_frame(user_data: *mut c_void, surface: SurfaceId, deadline_us: u64) {
    push(
        user_data,
        Event::Frame {
            surface,
            deadline_us,
        },
    );
}

extern "C" fn on_released(user_data: *mut c_void, surface: SurfaceId, buffer: BufferId) {
    push(user_data, Event::Released { surface, buffer });
}

fn push(user_data: *mut c_void, event: Event) {
    if user_data.is_null() {
        return;
    }
    // SAFETY: `user_data` is the pointer handed to domicile_engine_connect,
    // which is the boxed queue owned by the Engine, and the engine only calls
    // back from inside dispatch — so the box is alive and nothing else holds a
    // borrow.
    let events = unsafe { &*(user_data as *const RefCell<Vec<Event>>) };
    events.borrow_mut().push(event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dmabuf_descriptor::DmabufPlane as BridgePlane;

    /// What the C header's `static_assert` cannot see: that this side still
    /// has six fields. It catches a field added or dropped, which is the
    /// mistake that reads the wrong half of a bounding box. It does not catch
    /// a reorder or a signedness change — those keep the size and there is
    /// nothing on this side that could notice them.
    #[test]
    fn a_capture_is_the_six_int32_the_c_header_declares() {
        assert_eq!(
            std::mem::size_of::<RawCapture>(),
            6 * std::mem::size_of::<i32>()
        );
    }

    fn descriptor(planes: usize) -> DmabufDescriptor {
        DmabufDescriptor {
            width: 320,
            height: 240,
            fourcc: 0x3432_4241,
            modifier: 0x0300_0000_0cdb_0140,
            planes: (0..planes)
                .map(|index| BridgePlane {
                    fd: 10 + index as i32,
                    offset: 4 * index as u32,
                    stride: 1280,
                })
                .collect(),
        }
    }

    #[test]
    fn a_single_plane_buffer_crosses_the_abi_intact() {
        let converted = Dmabuf::from_descriptor(&descriptor(1)).expect("one plane is describable");

        assert_eq!(converted.width, 320);
        assert_eq!(converted.height, 240);
        assert_eq!(converted.fourcc, 0x3432_4241);
        assert_eq!(converted.modifier, 0x0300_0000_0cdb_0140);
        assert_eq!(converted.plane_count, 1);
        assert_eq!(converted.planes[0].fd, 10);
        assert_eq!(converted.planes[0].stride, 1280);
    }

    #[test]
    fn every_plane_is_carried_in_order() {
        let converted = Dmabuf::from_descriptor(&descriptor(MAX_PLANES))
            .expect("four planes is the most the ABI takes");

        assert_eq!(converted.plane_count, MAX_PLANES as u32);
        for (index, plane) in converted.planes.iter().enumerate() {
            assert_eq!(plane.fd, 10 + index as i32, "plane {index}");
            assert_eq!(plane.offset, 4 * index as u32, "plane {index}");
        }
    }

    // Refused rather than truncated. A five-plane buffer sent as its first four
    // is a window drawn from part of a buffer, which is worse than no window:
    // it looks like a rendering bug rather than an unsupported format.
    #[test]
    fn more_planes_than_the_abi_carries_are_refused() {
        assert!(Dmabuf::from_descriptor(&descriptor(MAX_PLANES + 1)).is_none());
    }

    #[test]
    fn a_buffer_with_no_planes_is_refused() {
        assert!(Dmabuf::from_descriptor(&descriptor(0)).is_none());
    }

    // The error path is the whole of what can be tested without a Chromium
    // build, and it is also the part that matters most: once phase 2 removes
    // the copy path, this message is the only thing between a missing library
    // and a compositor that comes up showing nothing.

    #[test]
    fn a_missing_library_names_itself_and_how_to_build_it() {
        let error = Engine::load("libdomicile_engine_that_is_not_there.so", "/tmp/nowhere")
            .expect_err("a library that is not there cannot load");

        let message = error.to_string();
        assert!(
            matches!(error, EngineError::Library { .. }),
            "expected a load failure, got {error:?}"
        );
        assert!(
            message.contains("libdomicile_engine_that_is_not_there.so"),
            "the message has to name the library it looked for: {message}"
        );
        assert!(
            message.contains("build.sh"),
            "and say where it comes from, because not-built is the usual cause: {message}"
        );
    }

    // A library that loads but is the wrong one fails differently, and says so
    // differently: "you have a library, it is not this one" is a different
    // afternoon from "you have no library".
    #[test]
    fn a_library_without_the_abi_says_it_is_the_wrong_one() {
        let error = Engine::load("libc.so.6", "/tmp/nowhere")
            .expect_err("libc has no domicile_engine_connect");

        let message = error.to_string();
        assert!(
            matches!(error, EngineError::Symbol { .. }),
            "expected a missing symbol, got {error:?}"
        );
        assert!(
            message.contains("domicile_engine_connect"),
            "the message has to name the symbol that was missing: {message}"
        );
    }

    #[test]
    fn a_path_with_a_nul_is_refused_rather_than_truncated() {
        let error = Engine::load("libc.so.6", "/tmp/no\0where")
            .expect_err("a nul byte cannot cross the ABI");

        assert!(
            matches!(error, EngineError::Path(_)),
            "expected the path to be refused, got {error:?}"
        );
    }
}
