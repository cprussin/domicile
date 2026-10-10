//! Bindings to `libdomicile_engine.so`, the forked engine's C ABI.
//!
//! The compositor submits client dmabufs to viz through this. See
//! `docs/architecture/ENGINE-FORK.md#the-c-abi` and `packages/domicile-engine`.
//!
//! The library is loaded with `dlopen` so `cargo build` does not need a
//! Chromium build. A missing library is still an error, never a silent
//! fallback.

use std::cell::{Cell, RefCell};
use std::ffi::{c_char, c_int, c_void, CString, NulError};
use std::os::fd::{BorrowedFd, OwnedFd, RawFd};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::buffer_transform::Sampled;
use crate::dmabuf_descriptor::DmabufDescriptor;
use domicile_config::{Desk, Transform};
use libloading::{Library, Symbol};
use smithay::utils::Transform as BufferTransform;
use thiserror::Error;

/// The default library name, looked up on `LD_LIBRARY_PATH`.
pub const LIBRARY: &str = "libdomicile_engine.so";

/// A surface, as the engine names one. Never zero.
pub type SurfaceId = u32;

/// An imported buffer, as the engine names one. Never zero.
pub type BufferId = u64;

/// A display capture, as the engine names one. Never zero.
pub type CaptureId = u32;

/// Why the engine could not be reached. Messages name the library, because
/// the usual cause is that it was never built.
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

    #[error("the browser shows display {display} in no window, so it cannot be captured")]
    NoCapture { display: i64 },

    #[error("a path the engine has to be told contains a nul byte: {0}")]
    Path(#[from] NulError),
}

/// One plane of a client's dmabuf, from `zwp_linux_buffer_params_v1.add`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Plane {
    pub fd: c_int,
    pub offset: u32,
    pub stride: u32,
}

/// The most planes `zwp_linux_dmabuf_v1` and `DomicileDmabuf` allow.
pub const MAX_PLANES: usize = 4;

/// The DRM fourccs the engine imports, matching `FormatFromFourcc` in
/// `packages/domicile-engine/src/components/domicile/browser/brokered_frame_sink.cc`.
/// `scripts/test-the-engines-fourccs-agree.sh` checks the two lists match.
pub const FOURCCS: [u32; 4] = [
    0x3432_5241, // DRM_FORMAT_ARGB8888
    0x3432_5258, // DRM_FORMAT_XRGB8888
    0x3432_4241, // DRM_FORMAT_ABGR8888
    0x3432_4258, // DRM_FORMAT_XBGR8888
];

/// `DomicileDmabuf`: a client's buffer. The fds are borrowed for the call.
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
    /// Converts a descriptor to the ABI struct.
    ///
    /// `None` for no planes or more than [`MAX_PLANES`]. Truncating the planes
    /// would draw a corrupt window.
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

/// One frame of a display capture, with fds of its own.
#[derive(Clone, Debug, PartialEq)]
pub struct CapturedFrame {
    pub pixels: CapturedPixels,
    pub size: (u32, u32),
    /// `DRM_FORMAT_ARGB8888` or `DRM_FORMAT_ABGR8888`.
    pub fourcc: u32,
    /// The part of the frame that shows the display. The engine letterboxes
    /// the rest when the display's aspect differs from the size asked for.
    pub content: (i32, i32, i32, i32),
    /// What changed since the previous frame. `None` is all of it.
    pub damage: Option<(i32, i32, i32, i32)>,
}

/// Where a captured frame's pixels are.
#[derive(Clone, Debug, PartialEq)]
pub enum CapturedPixels {
    /// The browser composites on the GPU.
    Dmabuf {
        modifier: u64,
        planes: Vec<CapturedPlane>,
    },
    /// The browser composites in software: rows `stride` bytes apart from the
    /// start of `fd`.
    Shm { fd: SharedFd, stride: u32 },
}

/// One plane of a captured dmabuf.
#[derive(Clone, Debug, PartialEq)]
pub struct CapturedPlane {
    pub fd: SharedFd,
    pub offset: u32,
    pub stride: u32,
}

/// An fd shared by the clones of an event. Equal only to itself.
#[derive(Clone, Debug)]
pub struct SharedFd(pub Arc<OwnedFd>);

impl PartialEq for SharedFd {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

/// A display the engine scans out on, as the engine reports it.
///
/// The engine holds DRM master, so on a tty this is the only source of display
/// information. See `docs/architecture/A-DESKTOP-ON-A-TTY.md#outputs` and
/// `docs/DISPLAYS.md`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Display {
    /// The engine's id, which the `wl_output` is named after. Derived from the
    /// EDID, so it is stable across hotplugs (`Screens::rearranged_into`).
    pub id: i64,
    /// `"<MAKE> <MODEL> <SERIAL>"` from the EDID, or empty if it has none.
    ///
    /// `output.profiles` entries match on this. MAKE is the EDID's
    /// three-letter PNP id (`DEL`); `Screens` expands it with
    /// `crate::pnp_ids`. Becomes the `wl_output` description; the name stays
    /// `drm-<id>`. See `docs/DISPLAYS.md#monitor-names`.
    pub description: String,
    /// Its top-left corner, in the desktop the engine laid out.
    pub position: (i32, i32),
    /// Its native mode, in physical pixels.
    pub size: (u32, u32),
    /// The panel's size in millimeters, or `(0, 0)` if unreported.
    pub physical_mm: (i32, i32),
    /// The CRTC's refresh rate in mHz, or zero if unreported.
    pub refresh_mhz: i32,
}

/// How the compositor wants a connector driven: the config's answer to a
/// [`Display`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Connector {
    /// The display, by [`Display::id`].
    pub id: i64,
    /// Whether to light it at all.
    pub enabled: bool,
    /// The connector's position on the engine's desktop, in physical pixels.
    /// Needed for dark connectors too, since the engine still places them.
    pub origin: (i32, i32),
    /// The monitor's rotation. The engine rotates the window so the page lays
    /// out upright.
    pub transform: Transform,
    /// Device pixels per logical pixel, applied by the engine to the window.
    pub scale: f64,
    /// The display's place on the logical desktop, or `None` if dark. The
    /// engine moves the pointer between monitors by it.
    pub desk: Option<Desk>,
}

/// Names the box the engine showed last, in [`Engine::submit`].
pub const LAST_SHOWN_BOX: u64 = 0;
/// Names the page's newest box, in [`Engine::submit`].
pub const NEWEST_BOX: u64 = u64::MAX;

/// A message from the engine, and its Wayland equivalent.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// `xdg_toplevel.configure`: the page's layout box changed.
    ///
    /// `width` and `height` are in device pixels; `scale` is device pixels per
    /// CSS pixel. `scale` is `None` from an engine without
    /// `configure_at`.
    ///
    /// `number` names the box for [`Engine::submit`]. `None` from an engine
    /// without `configure_box`.
    Configure {
        surface: SurfaceId,
        width: u32,
        height: u32,
        scale: Option<f64>,
        number: Option<u64>,
    },
    /// `wl_surface.frame`: viz asked for a frame.
    Frame {
        surface: SurfaceId,
        deadline_us: u64,
    },
    /// `wl_buffer.release`: viz has stopped reading the dmabuf, so the client
    /// may reuse it.
    Released {
        surface: SurfaceId,
        buffer: BufferId,
    },
    /// A copy made in the browser, for the seat's clipboard.
    ///
    /// The engine is not a Wayland client of this compositor, so this is how
    /// its copies reach Wayland clients.
    Copied { clipboard: Clipboard, text: String },

    /// The full display list, primary first, for `wl_output`.
    ///
    /// Sent at startup and on every hotplug. A display missing from the list
    /// has been unplugged.
    Displays(Vec<Display>),

    /// A frame of a display capture. Release `frame` with
    /// [`Engine::release_captured`] once read; `Err` says why it could not be
    /// kept, and must be released too.
    Captured {
        capture: CaptureId,
        frame: u64,
        captured: Result<CapturedFrame, String>,
    },

    /// The browser ended a display capture. No frame of it follows.
    CaptureEnded { capture: CaptureId },
}

/// Which clipboard a copy is on. Crosses the ABI as [`Clipboard::as_raw`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Clipboard {
    /// `wl_data_device`: Ctrl-C and Ctrl-V.
    Copy,
    /// `zwp_primary_selection_device_v1`: select and middle-click.
    Primary,
}

impl Clipboard {
    /// The ABI value, as `DomicileClipboard` in the C header defines it.
    fn as_raw(self) -> u32 {
        match self {
            Clipboard::Copy => 0,
            Clipboard::Primary => 1,
        }
    }
}

/// The clipboard an ABI value names.
///
/// Panics on an unknown value rather than guessing, which could overwrite the
/// user's clipboard.
fn clipboard_from(raw: u32) -> Clipboard {
    match raw {
        0 => Clipboard::Copy,
        1 => Clipboard::Primary,
        _ => panic!("the engine named a clipboard this compositor has no name for: {raw}"),
    }
}

#[repr(C)]
struct Callbacks {
    user_data: *mut c_void,
    configure: Option<extern "C" fn(*mut c_void, SurfaceId, u32, u32)>,
    frame: Option<extern "C" fn(*mut c_void, SurfaceId, u64)>,
    released: Option<extern "C" fn(*mut c_void, SurfaceId, BufferId)>,
    displays: Option<extern "C" fn(*mut c_void, *const RawDisplay, u32)>,
    copied: Option<extern "C" fn(*mut c_void, u32, *const c_char, usize)>,
    configure_at: Option<extern "C" fn(*mut c_void, SurfaceId, u32, u32, f64)>,
    captured: Option<extern "C" fn(*mut c_void, CaptureId, u64, *const RawCapturedFrame)>,
    capture_ended: Option<extern "C" fn(*mut c_void, CaptureId)>,
    configure_box: Option<extern "C" fn(*mut c_void, SurfaceId, u32, u32, f64, u64)>,
}

/// The engine's opaque handle.
#[repr(C)]
struct Handle {
    _private: [u8; 0],
}

/// A loaded engine, connected to the browser.
///
/// Callbacks fire only inside [`Engine::dispatch`], on the calling thread, so
/// events are returned as a plain vector.
#[derive(Debug)]
pub struct Engine {
    handle: *mut Handle,
    events: Box<RefCell<Vec<Event>>>,
    library: Library,
    path: PathBuf,
    /// Whether the missing-crop warning was logged. Logged once because
    /// submit runs every frame.
    said_it_cannot_crop: Cell<bool>,
    /// Whether the missing `domicile_surface_submit_for_box` was logged.
    said_it_cannot_wait: Cell<bool>,
    /// Whether the missing `domicile_surface_submit_transformed` was logged.
    said_it_cannot_turn: Cell<bool>,
}

/// `DomicileDisplay`, laid out as in the C header. 48 bytes, including 4 of
/// tail padding.
// `Default` is for tests. Its null name is refused by `displays_from`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
struct RawDisplay {
    id: i64,
    /// The panel's name, borrowed for the callback. Never null; checked in
    /// [`displays_from`].
    name: *const std::ffi::c_char,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    physical_width_mm: i32,
    physical_height_mm: i32,
    refresh_mhz: i32,
}

/// `DomicileDisplayLayout`, laid out as in the C header. 48 bytes, no
/// padding.
#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(C)]
struct RawLayout {
    id: i64,
    /// Nonzero to light this connector.
    enabled: i32,
    x: i32,
    y: i32,
    /// `DomicileDisplayTransform`: the `wl_output` order, normal first.
    transform: u32,
    scale: f64,
    /// The display's place on the logical desktop. Zeros for a dark display.
    desk_x: i32,
    desk_y: i32,
    desk_width: i32,
    desk_height: i32,
}

/// `DomicileCapturedFrame`, laid out as in the C header. The fds are lent for
/// the callback.
#[derive(Clone, Copy)]
#[repr(C)]
struct RawCapturedFrame {
    /// `DomicileCaptureMemory`: 0 a dmabuf, 1 shared memory.
    memory: u32,
    width: u32,
    height: u32,
    fourcc: u32,
    modifier: u64,
    plane_count: u32,
    planes: [Plane; MAX_PLANES],
    content_x: i32,
    content_y: i32,
    content_width: i32,
    content_height: i32,
    damage_x: i32,
    damage_y: i32,
    damage_width: i32,
    damage_height: i32,
}

/// `DomicileSpikeCapture`, laid out as in the C header.
///
/// A struct rather than an array because Chromium's `-Wunsafe-buffer-usage`
/// forbids indexing a bare pointer.
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

/// Where a color is in the browser's window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Spike only. The result of searching the browser window for a color.
///
/// `window` is the captured bitmap's size, which may differ from the
/// requested size; reporting it exposes coordinate bugs. `bounds` is the
/// color's extent, or `None` if absent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Capture {
    pub window: (i32, i32),
    pub bounds: Option<Bounds>,
}

impl Engine {
    /// Loads the library and connects to the browser over `socket`.
    ///
    /// `library` is a name or a path, resolved as `dlopen` does.
    pub fn load(library: impl AsRef<Path>, socket: impl AsRef<Path>) -> Result<Self, EngineError> {
        let path = library.as_ref().to_path_buf();
        // SAFETY: loading runs the library's initializers, and there is no
        // safe way to `dlopen`.
        let library = unsafe { Library::new(&path) }.map_err(|source| EngineError::Library {
            path: path.clone(),
            source,
        })?;

        let events = Box::new(RefCell::new(Vec::new()));
        let handle = join(&library, &path, &events, socket.as_ref())?;

        Ok(Self {
            handle,
            events,
            library,
            path,
            said_it_cannot_crop: Cell::new(false),
            said_it_cannot_wait: Cell::new(false),
            said_it_cannot_turn: Cell::new(false),
        })
    }

    /// Connects to a replacement browser over the `socket` it bound.
    ///
    /// Reuses the loaded library: it initializes process-global mojo state
    /// once, and supports several connections in one process. The old
    /// connection is destroyed first, since two cannot share mojo core. Queued
    /// events are discarded because they name the old connection's surfaces.
    ///
    /// On failure the handle is null, which every ABI entry point ignores and
    /// [`Engine::fd`] reports as -1, so the caller can retry later.
    ///
    /// No automated check covers this; see
    /// `docs/HARDWARE-CHECKS.md#dead-engine-with-windows-open`.
    pub fn reconnect(&mut self, socket: &Path) -> Result<(), EngineError> {
        self.let_the_old_one_go();
        self.events.borrow_mut().clear();
        self.handle = join(&self.library, &self.path, &self.events, socket)?;
        Ok(())
    }

    /// Destroys the connection, if any. The handle is null after a failed
    /// reconnect.
    fn let_the_old_one_go(&mut self) {
        let handle = std::mem::replace(&mut self.handle, std::ptr::null_mut());
        if !handle.is_null() {
            if let Ok(f) = self.symbol::<unsafe extern "C" fn(*mut Handle)>(
                b"domicile_engine_destroy\0",
                "domicile_engine_destroy",
            ) {
                // SAFETY: the handle is live, and was replaced with null so
                // nothing uses it afterward.
                unsafe { f(handle) };
            }
        }
    }

    /// The fd to poll. Readable when [`Engine::dispatch`] has work.
    pub fn fd(&self) -> RawFd {
        let f: Symbol<unsafe extern "C" fn(*mut Handle) -> c_int> = self
            .symbol(b"domicile_engine_fd\0", "domicile_engine_fd")
            .expect("the library was checked at load");
        // SAFETY: the handle is live for the life of self.
        unsafe { f(self.handle) }
    }

    /// Runs pending work and returns the events the browser sent.
    pub fn dispatch(&self) -> Vec<Event> {
        let f: Symbol<unsafe extern "C" fn(*mut Handle)> = self
            .symbol(b"domicile_engine_dispatch\0", "domicile_engine_dispatch")
            .expect("the library was checked at load");
        // SAFETY: as above. The callbacks fire synchronously inside this call,
        // on this thread, and push into `events`.
        unsafe { f(self.handle) };
        self.events.borrow_mut().drain(..).collect()
    }

    /// Asks the browser to broker a frame sink for a new window.
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

    /// Destroys a window's surface and its frame sink.
    pub fn destroy_surface(&self, surface: SurfaceId) {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, SurfaceId)> =
            match self.symbol(b"domicile_surface_destroy\0", "domicile_surface_destroy") {
                Ok(symbol) => symbol,
                Err(_) => return,
            };
        // SAFETY: as above.
        unsafe { f(self.handle, surface) };
    }

    /// Imports a client's dmabuf. `None` if the browser refused it, as it
    /// always does on an ozone platform without `CreateNativePixmapFromHandle`.
    ///
    /// The fds are borrowed; the caller keeps the client's `wl_buffer`.
    pub fn import(&self, surface: SurfaceId, dmabuf: &Dmabuf) -> Option<BufferId> {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, SurfaceId, *const Dmabuf) -> BufferId> =
            self.symbol(b"domicile_surface_import\0", "domicile_surface_import")
                .ok()?;
        // SAFETY: as above, and `dmabuf` outlives the call.
        let buffer = unsafe { f(self.handle, surface, dmabuf as *const Dmabuf) };
        (buffer != 0).then_some(buffer)
    }

    /// Tells the browser the contents of a clipboard.
    ///
    /// The compositor reads every new selection eagerly, so the browser can
    /// paste from memory. Send empty text for an empty clipboard, or the
    /// browser keeps the old contents. Passed with a length because copied
    /// text may contain a nul; the browser copies it before returning.
    pub fn set_clipboard(&self, clipboard: Clipboard, text: &str) {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, u32, *const c_char, usize)> =
            match self.symbol(b"domicile_clipboard_set\0", "domicile_clipboard_set") {
                Ok(symbol) => symbol,
                Err(_) => return,
            };
        // SAFETY: as above, and the slice outlives the call because `text`
        // does.
        unsafe {
            f(
                self.handle,
                clipboard.as_raw(),
                text.as_ptr().cast::<c_char>(),
                text.len(),
            );
        };
    }

    /// Submits a frame showing the `sampled` part of `buffer`
    /// (`wl_surface.commit`), turned upright, at the newest box numbered at
    /// most `at_box` (see [`Event::Configure`]).
    ///
    /// The crop is the window geometry, which excludes client-drawn shadows
    /// (see [`crate::window_geometry`]). An empty crop means the whole buffer;
    /// empty damage means the whole surface.
    pub fn submit(
        &self,
        surface: SurfaceId,
        buffer: BufferId,
        sampled: Sampled,
        damage: (i32, i32, i32, i32),
        at_box: u64,
    ) {
        #[allow(clippy::type_complexity)] // the C signature, spelled out
        let f: Symbol<
            unsafe extern "C" fn(
                *mut Handle,
                SurfaceId,
                BufferId,
                i32,
                i32,
                i32,
                i32,
                i32,
                i32,
                i32,
                i32,
                u64,
                u32,
            ),
        > = match self.symbol(
            b"domicile_surface_submit_transformed\0",
            "domicile_surface_submit_transformed",
        ) {
            Ok(symbol) => symbol,
            // An older engine shows every buffer as drawn, so a client that
            // turned its buffer for a rotated monitor is shown turned.
            Err(why) => {
                if sampled.transform != BufferTransform::Normal
                    && !self.said_it_cannot_turn.replace(true)
                {
                    tracing::warn!(%why, "windows drawn turned are shown turned");
                }
                return self.submit_unturned(surface, buffer, sampled.crop, damage, at_box);
            }
        };
        let (crop_x, crop_y, crop_width, crop_height) = sampled.crop;
        let (x, y, width, height) = damage;
        // SAFETY: as above.
        unsafe {
            f(
                self.handle,
                surface,
                buffer,
                crop_x,
                crop_y,
                crop_width,
                crop_height,
                x,
                y,
                width,
                height,
                at_box,
                abi_transform(sampled.transform),
            )
        };
    }

    /// Submits without a transform, for an engine without
    /// `domicile_surface_submit_transformed`.
    fn submit_unturned(
        &self,
        surface: SurfaceId,
        buffer: BufferId,
        crop: (i32, i32, i32, i32),
        damage: (i32, i32, i32, i32),
        at_box: u64,
    ) {
        #[allow(clippy::type_complexity)] // the C signature, spelled out
        let f: Symbol<
            unsafe extern "C" fn(
                *mut Handle,
                SurfaceId,
                BufferId,
                i32,
                i32,
                i32,
                i32,
                i32,
                i32,
                i32,
                i32,
                u64,
            ),
        > = match self.symbol(
            b"domicile_surface_submit_for_box\0",
            "domicile_surface_submit_for_box",
        ) {
            Ok(symbol) => symbol,
            // An older engine shows every frame at the newest box, so a
            // resized window's old frame is stretched until it redraws.
            Err(why) => {
                if !self.said_it_cannot_wait.replace(true) {
                    tracing::warn!(%why, "resized windows stretch until they redraw");
                }
                return self.submit_at_the_newest_box(surface, buffer, crop, damage);
            }
        };
        let (crop_x, crop_y, crop_width, crop_height) = crop;
        let (x, y, width, height) = damage;
        // SAFETY: as above.
        unsafe {
            f(
                self.handle,
                surface,
                buffer,
                crop_x,
                crop_y,
                crop_width,
                crop_height,
                x,
                y,
                width,
                height,
                at_box,
            )
        };
    }

    /// Submits at the newest box, for an engine without
    /// `domicile_surface_submit_for_box`.
    fn submit_at_the_newest_box(
        &self,
        surface: SurfaceId,
        buffer: BufferId,
        crop: (i32, i32, i32, i32),
        damage: (i32, i32, i32, i32),
    ) {
        #[allow(clippy::type_complexity)] // the C signature, spelled out
        let f: Symbol<
            unsafe extern "C" fn(
                *mut Handle,
                SurfaceId,
                BufferId,
                i32,
                i32,
                i32,
                i32,
                i32,
                i32,
                i32,
                i32,
            ),
        > = match self.symbol(
            b"domicile_surface_submit_crop\0",
            "domicile_surface_submit_crop",
        ) {
            Ok(symbol) => symbol,
            // An older engine without cropping: draw the whole buffer,
            // shadow included.
            Err(why) => {
                if !self.said_it_cannot_crop.replace(true) {
                    tracing::warn!(%why, "windows are drawn uncropped, shadows and all");
                }
                return self.submit_uncropped(surface, buffer, damage);
            }
        };
        let (crop_x, crop_y, crop_width, crop_height) = crop;
        let (x, y, width, height) = damage;
        // SAFETY: as above.
        unsafe {
            f(
                self.handle,
                surface,
                buffer,
                crop_x,
                crop_y,
                crop_width,
                crop_height,
                x,
                y,
                width,
                height,
            )
        };
    }

    /// Submits the whole buffer, for an engine without
    /// `domicile_surface_submit_crop`.
    fn submit_uncropped(&self, surface: SurfaceId, buffer: BufferId, damage: (i32, i32, i32, i32)) {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, SurfaceId, BufferId, i32, i32, i32, i32)> =
            match self.symbol(b"domicile_surface_submit\0", "domicile_surface_submit") {
                Ok(symbol) => symbol,
                Err(_) => return,
            };
        let (x, y, width, height) = damage;
        // SAFETY: as above.
        unsafe { f(self.handle, surface, buffer, x, y, width, height) };
    }

    /// Tells the browser which connectors to light and where.
    ///
    /// An empty list means no profile: the engine lights what the hardware
    /// reports, undoing any earlier profile. The result arrives later as an
    /// [`Event::Displays`].
    pub fn configure_displays(&self, connectors: &[Connector]) {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, *const RawLayout, u32)> = match self.symbol(
            b"domicile_displays_configure\0",
            "domicile_displays_configure",
        ) {
            Ok(symbol) => symbol,
            Err(_) => return,
        };
        let raw = layouts_from(connectors);
        // SAFETY: as above, and `raw` outlives the call; the engine copies it.
        unsafe { f(self.handle, raw.as_ptr(), raw.len() as u32) };
    }

    /// Releases an imported buffer after the client destroys its `wl_buffer`.
    pub fn forget(&self, surface: SurfaceId, buffer: BufferId) {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, SurfaceId, BufferId)> =
            match self.symbol(b"domicile_buffer_destroy\0", "domicile_buffer_destroy") {
                Ok(symbol) => symbol,
                Err(_) => return,
            };
        // SAFETY: as above.
        unsafe { f(self.handle, surface, buffer) };
    }

    /// Captures what display `display` shows, `size` big, at most `max_fps`
    /// frames a second, for a screen cast. Frames arrive as
    /// [`Event::Captured`].
    ///
    /// `display` is a [`Display::id`]; zero names a nested engine's only
    /// window. An engine older than display capture has no symbol for it.
    pub fn start_capture(
        &self,
        display: i64,
        size: (u32, u32),
        max_fps: u32,
    ) -> Result<CaptureId, EngineError> {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, i64, u32, u32, u32) -> CaptureId> = self
            .symbol(
                b"domicile_display_capture_start\0",
                "domicile_display_capture_start",
            )?;
        // SAFETY: the handle is live for the life of self.
        let capture = unsafe { f(self.handle, display, size.0, size.1, max_fps) };
        match capture {
            0 => Err(EngineError::NoCapture { display }),
            capture => Ok(capture),
        }
    }

    /// Captures at `size` from the next frame on.
    pub fn resize_capture(&self, capture: CaptureId, size: (u32, u32)) {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, CaptureId, u32, u32)> = self
            .symbol(
                b"domicile_display_capture_resize\0",
                "domicile_display_capture_resize",
            )
            .expect("an engine that started a capture can resize it");
        // SAFETY: as above.
        unsafe { f(self.handle, capture, size.0, size.1) };
    }

    /// Stops a capture and releases every frame of it still held.
    pub fn stop_capture(&self, capture: CaptureId) {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, CaptureId)> = self
            .symbol(
                b"domicile_display_capture_stop\0",
                "domicile_display_capture_stop",
            )
            .expect("an engine that started a capture can stop it");
        // SAFETY: as above.
        unsafe { f(self.handle, capture) };
    }

    /// Gives a captured frame's buffer back to the engine.
    pub fn release_captured(&self, capture: CaptureId, frame: u64) {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, CaptureId, u64)> = self
            .symbol(
                b"domicile_captured_frame_release\0",
                "domicile_captured_frame_release",
            )
            .expect("an engine that sent a frame can take it back");
        // SAFETY: as above.
        unsafe { f(self.handle, capture, frame) };
    }

    /// Spike only. The ARGB pixel at the center of the browser's window,
    /// where spike pages put the `<app>`.
    ///
    /// Lives here because only the compositor holds the browser's invitation.
    pub fn spike_window_center(&self) -> Option<u32> {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, *mut u32) -> bool> = self
            .symbol(
                b"domicile_engine_spike_sample_window_center\0",
                "domicile_engine_spike_sample_window_center",
            )
            .ok()?;
        let mut argb = 0u32;
        // SAFETY: the handle is live, and `argb` outlives the call.
        unsafe { f(self.handle, &mut argb) }.then_some(argb)
    }

    /// Spike only. The ARGB pixel at `x`, `y` in the browser's window, for
    /// pages with more than one `<app>`.
    pub fn spike_pixel(&self, x: i32, y: i32) -> Option<u32> {
        // A missing symbol means a stale library build; log it, because it
        // would otherwise look like a point outside the window.
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
        // SAFETY: the handle is live, and `argb` outlives the call.
        unsafe { f(self.handle, x, y, &mut argb) }.then_some(argb)
    }

    /// Spike only. Where `argb` is in the browser's window, and the window's
    /// size.
    ///
    /// `None` means nothing could be read, which differs from the color being
    /// absent (`bounds: None`); negative-control checks rely on the
    /// difference.
    pub fn spike_find(&self, argb: u32) -> Option<Capture> {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, u32, *mut RawCapture) -> i32> = match self
            .symbol(
                b"domicile_engine_spike_find_color\0",
                "domicile_engine_spike_find_color",
            ) {
            Ok(symbol) => symbol,
            Err(err) => {
                tracing::error!(
                    %err,
                    "libdomicile_engine.so has no domicile_engine_spike_find_color; it was \
                     built before the shell guard existed. Rebuild it: autoninja -C \
                     out/Domicile domicile_engine"
                );
                return None;
            }
        };
        // Zeroed because the library writes only the size on status 0, and
        // the box too on status 1.
        let mut out = RawCapture::default();
        // SAFETY: the handle is live, and `out` is a `DomicileSpikeCapture`
        // that outlives the call.
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
        self.let_the_old_one_go();
    }
}

/// Connects to the browser at `socket`; callbacks push into `events`.
///
/// A free function because [`Engine::load`] calls it before an `Engine`
/// exists.
fn join(
    library: &Library,
    path: &Path,
    events: &RefCell<Vec<Event>>,
    socket: &Path,
) -> Result<*mut Handle, EngineError> {
    let callbacks = Callbacks {
        user_data: (events as *const RefCell<Vec<Event>>) as *mut c_void,
        configure: Some(on_configure),
        frame: Some(on_frame),
        released: Some(on_released),
        displays: Some(on_displays),
        copied: Some(on_copied),
        configure_at: Some(on_configure_at),
        captured: Some(on_captured),
        capture_ended: Some(on_capture_ended),
        configure_box: Some(on_configure_box),
    };
    let socket_c = CString::new(socket.as_os_str().as_encoded_bytes())?;
    let connect: Symbol<unsafe extern "C" fn(*const c_char, Callbacks) -> *mut Handle> = symbol(
        library,
        path,
        b"domicile_engine_connect\0",
        "domicile_engine_connect",
    )?;
    // SAFETY: the signature matches domicile_engine.h, the string is
    // nul-terminated, and `events` outlives the handle because the same
    // `Engine` owns both.
    let handle = unsafe { connect(socket_c.as_ptr(), callbacks) };
    match handle.is_null() {
        true => Err(EngineError::Connect {
            socket: socket.to_path_buf(),
        }),
        false => Ok(handle),
    }
}

fn symbol<'library, T>(
    library: &'library Library,
    path: &Path,
    name: &[u8],
    readable: &'static str,
) -> Result<Symbol<'library, T>, EngineError> {
    // SAFETY: every caller states a signature that matches domicile_engine.h.
    unsafe { library.get(name) }.map_err(|source| EngineError::Symbol {
        path: path.to_path_buf(),
        symbol: readable,
        source,
    })
}

/// The callbacks only queue events; they fire inside `dispatch`.
extern "C" fn on_configure(user_data: *mut c_void, surface: SurfaceId, width: u32, height: u32) {
    push(
        user_data,
        Event::Configure {
            surface,
            width,
            height,
            scale: None,
            number: None,
        },
    );
}

extern "C" fn on_configure_at(
    user_data: *mut c_void,
    surface: SurfaceId,
    width: u32,
    height: u32,
    scale: f64,
) {
    push(
        user_data,
        Event::Configure {
            surface,
            width,
            height,
            scale: Some(scale),
            number: None,
        },
    );
}

extern "C" fn on_configure_box(
    user_data: *mut c_void,
    surface: SurfaceId,
    width: u32,
    height: u32,
    scale: f64,
    number: u64,
) {
    push(
        user_data,
        Event::Configure {
            surface,
            width,
            height,
            scale: Some(scale),
            number: Some(number),
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

/// Queues the display list.
///
/// An empty list is queued, not dropped: the engine never sends one, so
/// `Screens::from_the_engine` reports it as an error.
extern "C" fn on_displays(user_data: *mut c_void, displays: *const RawDisplay, count: u32) {
    // SAFETY: the ABI says `displays` points at `count` records, valid for
    // this call. `displays_from` copies them.
    let records = unsafe { std::slice::from_raw_parts(displays, count as usize) };
    push(user_data, Event::Displays(displays_from(records)));
}

/// Queues a copy made in the browser.
///
/// The text has a length rather than a nul terminator, because copied text
/// may contain a nul. `domicile_clipboard_set` works the same way.
extern "C" fn on_copied(
    user_data: *mut c_void,
    clipboard: u32,
    text: *const c_char,
    length: usize,
) {
    assert!(
        !text.is_null(),
        "the engine sends the bytes that were copied, even if it sends none"
    );
    // SAFETY: the ABI says `text` points at `length` bytes, valid for this
    // call. `String::from_utf8_lossy` copies them.
    let bytes = unsafe { std::slice::from_raw_parts(text.cast::<u8>(), length) };
    push(
        user_data,
        Event::Copied {
            clipboard: clipboard_from(clipboard),
            // Mojo already validates the text as UTF-8; lossy conversion
            // avoids a panic if that ever changes.
            text: String::from_utf8_lossy(bytes).into_owned(),
        },
    );
}

/// Copies a captured frame out of its record, duplicating the lent fds.
///
/// Panics on a memory kind the C header does not declare, rather than read
/// the planes wrongly.
fn captured_from(record: &RawCapturedFrame) -> Result<CapturedFrame, String> {
    let lent = &record.planes[..(record.plane_count as usize).min(MAX_PLANES)];
    let own = |plane: &Plane| {
        // SAFETY: the ABI lends each plane's fd for the callback this runs in.
        let fd = unsafe { BorrowedFd::borrow_raw(plane.fd) };
        fd.try_clone_to_owned()
            .map(|fd| SharedFd(Arc::new(fd)))
            .map_err(|why| format!("a captured frame's fd would not duplicate: {why}"))
    };
    let pixels = match record.memory {
        0 => CapturedPixels::Dmabuf {
            modifier: record.modifier,
            planes: lent
                .iter()
                .map(|plane| {
                    Ok(CapturedPlane {
                        fd: own(plane)?,
                        offset: plane.offset,
                        stride: plane.stride,
                    })
                })
                .collect::<Result<_, String>>()?,
        },
        1 => {
            let plane = lent
                .first()
                .ok_or("a shared memory frame came with no plane")?;
            CapturedPixels::Shm {
                fd: own(plane)?,
                stride: plane.stride,
            }
        }
        memory => {
            panic!("the engine sent a frame in memory the C header does not declare: {memory}")
        }
    };
    let damage = (
        record.damage_x,
        record.damage_y,
        record.damage_width,
        record.damage_height,
    );
    Ok(CapturedFrame {
        pixels,
        size: (record.width, record.height),
        fourcc: record.fourcc,
        content: (
            record.content_x,
            record.content_y,
            record.content_width,
            record.content_height,
        ),
        damage: (damage.2 > 0 && damage.3 > 0).then_some(damage),
    })
}

/// Queues a captured frame, with fds of its own.
extern "C" fn on_captured(
    user_data: *mut c_void,
    capture: CaptureId,
    frame: u64,
    record: *const RawCapturedFrame,
) {
    // SAFETY: the ABI lends a valid record for this call.
    let record = unsafe { &*record };
    push(
        user_data,
        Event::Captured {
            capture,
            frame,
            captured: captured_from(record),
        },
    );
}

extern "C" fn on_capture_ended(user_data: *mut c_void, capture: CaptureId) {
    push(user_data, Event::CaptureEnded { capture });
}

/// Converts the ABI's display records.
fn displays_from(records: &[RawDisplay]) -> Vec<Display> {
    records
        .iter()
        .map(|record| Display {
            id: record.id,
            description: description_of(record),
            position: (record.x, record.y),
            size: (as_extent(record.width), as_extent(record.height)),
            physical_mm: (record.physical_width_mm, record.physical_height_mm),
            refresh_mhz: record.refresh_mhz,
        })
        .collect()
}

/// A buffer transform as the ABI's `DomicileBufferTransform`: the
/// `wl_output.transform` order.
fn abi_transform(transform: BufferTransform) -> u32 {
    match transform {
        BufferTransform::Normal => 0,
        BufferTransform::_90 => 1,
        BufferTransform::_180 => 2,
        BufferTransform::_270 => 3,
        BufferTransform::Flipped => 4,
        BufferTransform::Flipped90 => 5,
        BufferTransform::Flipped180 => 6,
        BufferTransform::Flipped270 => 7,
    }
}

/// Converts connectors to the ABI's layout records.
fn layouts_from(connectors: &[Connector]) -> Vec<RawLayout> {
    connectors
        .iter()
        .map(|connector| RawLayout {
            id: connector.id,
            enabled: i32::from(connector.enabled),
            x: connector.origin.0,
            y: connector.origin.1,
            transform: match connector.transform {
                Transform::Normal => 0,
                Transform::Rotate90 => 1,
                Transform::Rotate180 => 2,
                Transform::Rotate270 => 3,
            },
            scale: connector.scale,
            desk_x: connector.desk.map_or(0, |desk| desk.position.0),
            desk_y: connector.desk.map_or(0, |desk| desk.position.1),
            desk_width: connector.desk.map_or(0, |desk| logical(desk.size.0)),
            desk_height: connector.desk.map_or(0, |desk| logical(desk.size.1)),
        })
        .collect()
}

/// A logical size as an `int32_t`. Profiles that do not fit are refused
/// earlier, so this cannot fail.
fn logical(size: u32) -> i32 {
    i32::try_from(size).expect("a laid-out desktop fits an int32_t")
}

/// Copies the panel's name out of the record.
///
/// Panics on null, which the C header forbids, instead of reading it. Lossy
/// because the engine already limits names to printable ASCII, and bad
/// firmware should not crash the desktop.
fn description_of(record: &RawDisplay) -> String {
    assert!(
        !record.name.is_null(),
        "the engine names every display, even if it names it nothing"
    );
    // SAFETY: non-null per the assertion; the ABI guarantees a nul-terminated
    // string valid for this callback, and this copies it.
    unsafe { std::ffi::CStr::from_ptr(record.name) }
        .to_string_lossy()
        .into_owned()
}

/// A display extent from the ABI's `int32_t`. Panics if negative rather
/// than casting to a wrong size.
fn as_extent(measure: i32) -> u32 {
    u32::try_from(measure).expect("a display's mode is never negative")
}

fn push(user_data: *mut c_void, event: Event) {
    if user_data.is_null() {
        return;
    }
    // SAFETY: `user_data` is the `Engine`'s boxed queue, passed to
    // domicile_engine_connect. Callbacks fire only inside dispatch, so the box
    // is alive and not borrowed elsewhere.
    let events = unsafe { &*(user_data as *const RefCell<Vec<Event>>) };
    events.borrow_mut().push(event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dmabuf_descriptor::DmabufPlane as BridgePlane;
    use std::os::fd::{AsRawFd as _, IntoRawFd as _};

    #[test]
    fn a_captured_frame_is_the_record_the_c_header_declares() {
        // 16 (four `uint32_t`) + 8 (modifier) + 4 (count) + 48 (four planes)
        // + 32 (content and damage) + 4 tail padding.
        assert_eq!(std::mem::size_of::<RawCapturedFrame>(), 112);
    }

    /// A pipe's read end, standing in for a buffer's fd.
    fn an_fd() -> RawFd {
        let (read, _write) = std::io::pipe().expect("a pipe");
        OwnedFd::from(read).into_raw_fd()
    }

    fn record(memory: u32, fds: &[RawFd]) -> RawCapturedFrame {
        let mut planes = [Plane {
            fd: -1,
            offset: 0,
            stride: 0,
        }; MAX_PLANES];
        for (index, (slot, &fd)) in planes.iter_mut().zip(fds).enumerate() {
            *slot = Plane {
                fd,
                offset: index as u32 * 4096,
                stride: 1600,
            };
        }
        RawCapturedFrame {
            memory,
            width: 400,
            height: 300,
            fourcc: FOURCCS[0],
            modifier: 7,
            plane_count: fds.len() as u32,
            planes,
            content_x: 0,
            content_y: 25,
            content_width: 400,
            content_height: 250,
            damage_x: 0,
            damage_y: 0,
            damage_width: 0,
            damage_height: 0,
        }
    }

    #[test]
    fn a_shared_memory_frame_crosses_as_its_own_fd_and_stride() {
        let lent = an_fd();

        let captured = captured_from(&record(1, &[lent])).expect("a frame");

        let CapturedPixels::Shm { fd, stride } = &captured.pixels else {
            panic!("a shared memory frame crossed as {:?}", captured.pixels);
        };
        // Its own: the engine closes the lent fd after the callback.
        assert_ne!(fd.0.as_raw_fd(), lent);
        assert_eq!(*stride, 1600);
        assert_eq!(captured.size, (400, 300));
        assert_eq!(captured.content, (0, 25, 400, 250));
        // Empty damage is all of it.
        assert_eq!(captured.damage, None);
    }

    #[test]
    fn a_dmabuf_frame_crosses_with_every_plane_and_its_damage() {
        let mut raw = record(0, &[an_fd(), an_fd()]);
        (
            raw.damage_x,
            raw.damage_y,
            raw.damage_width,
            raw.damage_height,
        ) = (1, 2, 3, 4);

        let captured = captured_from(&raw).expect("a frame");

        let CapturedPixels::Dmabuf { modifier, planes } = &captured.pixels else {
            panic!("a dmabuf frame crossed as {:?}", captured.pixels);
        };
        assert_eq!(*modifier, 7);
        assert_eq!(
            planes
                .iter()
                .map(|plane| (plane.offset, plane.stride))
                .collect::<Vec<_>>(),
            [(0, 1600), (4096, 1600)]
        );
        assert_eq!(captured.damage, Some((1, 2, 3, 4)));
    }

    #[test]
    #[should_panic(expected = "memory")]
    fn a_frame_in_memory_the_header_does_not_declare_is_refused() {
        let _ = captured_from(&record(2, &[an_fd()]));
    }

    /// The clipboard numbers are part of the ABI.
    #[test]
    fn each_clipboard_crosses_as_the_number_the_c_header_gives_it() {
        assert_eq!(Clipboard::Copy.as_raw(), 0);
        assert_eq!(Clipboard::Primary.as_raw(), 1);
        assert_eq!(clipboard_from(0), Clipboard::Copy);
        assert_eq!(clipboard_from(1), Clipboard::Primary);
    }

    /// An undeclared clipboard number panics rather than guessing.
    #[test]
    #[should_panic(expected = "clipboard")]
    fn a_clipboard_the_header_does_not_declare_is_refused() {
        clipboard_from(2);
    }

    /// Struct size checks mirror the C header's `static_assert`s. They catch
    /// added or dropped fields, not reorders.
    #[test]
    fn a_capture_is_the_six_int32_the_c_header_declares() {
        assert_eq!(
            std::mem::size_of::<RawCapture>(),
            6 * std::mem::size_of::<i32>()
        );
    }

    #[test]
    fn a_display_is_the_one_int64_the_pointer_and_seven_int32_the_c_header_declares() {
        // 8 (id) + 8 (name) + 28 (seven `int32_t`) + 4 tail padding. A
        // literal, because padding is part of the ABI.
        assert_eq!(std::mem::size_of::<RawDisplay>(), 48);
    }

    #[test]
    fn a_connector_is_the_int64_four_int32s_double_and_desk_the_c_header_declares() {
        // 8 (id) + 16 (three `int32_t`, one `uint32_t`) + 8 (`double`) + 16
        // (desk). No padding: the `double` is already aligned.
        assert_eq!(std::mem::size_of::<RawLayout>(), 48);
    }

    #[test]
    fn a_connector_crosses_with_the_turn_and_scale_its_window_is_drawn_at() {
        // `DomicileDisplayTransform` uses the `wl_output` order.
        let turned = |transform| layouts_from(&[Connector { transform, ..LIT }])[0].transform;
        assert_eq!(
            [
                turned(Transform::Normal),
                turned(Transform::Rotate90),
                turned(Transform::Rotate180),
                turned(Transform::Rotate270),
            ],
            [0, 1, 2, 3]
        );
        assert_eq!(layouts_from(&[LIT])[0].scale, 1.2);
    }

    #[test]
    fn a_buffer_transform_crosses_in_the_wl_output_order() {
        // `DomicileBufferTransform` uses the `wl_output.transform` order.
        assert_eq!(
            [
                BufferTransform::Normal,
                BufferTransform::_90,
                BufferTransform::_180,
                BufferTransform::_270,
                BufferTransform::Flipped,
                BufferTransform::Flipped90,
                BufferTransform::Flipped180,
                BufferTransform::Flipped270,
            ]
            .map(abi_transform),
            [0, 1, 2, 3, 4, 5, 6, 7]
        );
    }

    #[test]
    fn a_configure_carries_the_scale_of_the_page_that_laid_it_out() {
        // Only the engine knows the scale a box was laid out at.
        let events = RefCell::new(Vec::new());
        let queue = (&events as *const RefCell<Vec<Event>>) as *mut c_void;
        on_configure_box(queue, 2, 640, 480, 2.0, 9);
        on_configure_at(queue, 3, 1200, 900, 1.5);
        on_configure(queue, 4, 800, 600);

        assert_eq!(
            events.into_inner(),
            vec![
                Event::Configure {
                    surface: 2,
                    width: 640,
                    height: 480,
                    scale: Some(2.0),
                    number: Some(9),
                },
                // An engine without `configure_box` numbers no box.
                Event::Configure {
                    surface: 3,
                    width: 1200,
                    height: 900,
                    scale: Some(1.5),
                    number: None,
                },
                // An engine without `configure_at` sends no scale.
                Event::Configure {
                    surface: 4,
                    width: 800,
                    height: 600,
                    scale: None,
                    number: None,
                },
            ]
        );
    }

    /// A lit, scaled and rotated connector for tests to vary.
    const LIT: Connector = Connector {
        id: 7,
        enabled: true,
        origin: (3840, 0),
        transform: Transform::Rotate270,
        scale: 1.2,
        desk: Some(Desk {
            position: (1800, 0),
            size: (1800, 3200),
        }),
    };

    #[test]
    fn a_lit_connector_crosses_as_its_corner_and_a_yes() {
        let raw = layouts_from(&[LIT]);

        assert_eq!(
            raw,
            vec![RawLayout {
                id: 7,
                enabled: 1,
                x: 3840,
                y: 0,
                transform: 3,
                scale: 1.2,
                desk_x: 1800,
                desk_y: 0,
                desk_width: 1800,
                desk_height: 3200,
            }]
        );
    }

    #[test]
    fn a_dark_connector_crosses_as_a_no_and_a_corner_that_still_matters() {
        // A dark connector still needs a position, or the engine places it
        // over a lit monitor.
        let raw = layouts_from(&[Connector {
            id: 3,
            enabled: false,
            origin: (11520, 0),
            transform: Transform::Normal,
            scale: 1.0,
            desk: None,
        }]);

        assert_eq!(
            raw,
            vec![RawLayout {
                id: 3,
                enabled: 0,
                x: 11520,
                y: 0,
                transform: 0,
                scale: 1.0,
                // Not on the desk: zeros.
                desk_x: 0,
                desk_y: 0,
                desk_width: 0,
                desk_height: 0,
            }]
        );
    }

    /// `record` with its name set to `name`. Keep the returned `CString`
    /// alive while the record is used.
    fn named(record: RawDisplay, name: &str) -> (RawDisplay, std::ffi::CString) {
        let owned = std::ffi::CString::new(name).expect("a test name has no nul in it");
        (
            RawDisplay {
                name: owned.as_ptr(),
                ..record
            },
            owned,
        )
    }

    #[test]
    fn a_displays_name_crosses_as_the_panel_spelled_it() {
        let (record, _owned) = named(
            RawDisplay {
                id: 7,
                width: 2880,
                height: 1920,
                ..RawDisplay::default()
            },
            "DEL DELL U3219Q 2ZLS413",
        );

        assert_eq!(
            displays_from(&[record])[0].description,
            "DEL DELL U3219Q 2ZLS413"
        );
    }

    #[test]
    fn a_display_that_names_itself_nothing_crosses_as_nothing() {
        // E.g. a projector or virtual output. The id still identifies it.
        let (record, _owned) = named(RawDisplay::default(), "");

        assert_eq!(displays_from(&[record])[0].description, "");
    }

    #[test]
    #[should_panic(expected = "the engine names every display")]
    fn a_null_name_is_refused_rather_than_read() {
        // Reading a null pointer would be undefined behavior.
        let _ = displays_from(&[RawDisplay::default()]);
    }

    #[test]
    fn a_display_list_crosses_the_abi_as_the_compositor_counts_them() {
        // The projector reports no size or rate; zeros pass through as
        // zeros, which is what `wl_output` expects.
        let (panel, _panel_name) = named(
            RawDisplay {
                id: 7,
                x: 0,
                y: 0,
                width: 2880,
                height: 1920,
                physical_width_mm: 597,
                physical_height_mm: 336,
                refresh_mhz: 59_997,
                ..RawDisplay::default()
            },
            "BOE NE135A1M-NY1",
        );
        let (projector, _projector_name) = named(
            RawDisplay {
                id: 9,
                x: 2880,
                y: 0,
                width: 1920,
                height: 1080,
                physical_width_mm: 0,
                physical_height_mm: 0,
                refresh_mhz: 0,
                ..RawDisplay::default()
            },
            "",
        );
        assert_eq!(
            displays_from(&[panel, projector]),
            vec![
                Display {
                    id: 7,
                    description: "BOE NE135A1M-NY1".into(),
                    position: (0, 0),
                    size: (2880, 1920),
                    physical_mm: (597, 336),
                    refresh_mhz: 59_997,
                },
                Display {
                    id: 9,
                    description: String::new(),
                    position: (2880, 0),
                    size: (1920, 1080),
                    physical_mm: (0, 0),
                    refresh_mhz: 0,
                },
            ]
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

    // Refused rather than truncated, which would draw a corrupt window.
    #[test]
    fn more_planes_than_the_abi_carries_are_refused() {
        assert!(Dmabuf::from_descriptor(&descriptor(MAX_PLANES + 1)).is_none());
    }

    #[test]
    fn a_buffer_with_no_planes_is_refused() {
        assert!(Dmabuf::from_descriptor(&descriptor(0)).is_none());
    }

    // Only the error paths can be tested without a Chromium build.

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

    // A wrong library gets a different error from a missing one.
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
