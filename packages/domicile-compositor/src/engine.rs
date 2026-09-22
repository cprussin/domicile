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
//! It is *not* a license to carry on without it. A caller that asked for the
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

/// One display the engine is scanning out on, as it reports it.
///
/// The engine holds DRM master, so on a tty this is the only reading of the
/// screens there is -- `docs/architecture/A-DESKTOP-ON-A-TTY.md`, *Outputs*.
/// It comes off the same `DisplaySnapshot`s the modeset driver configures the
/// CRTCs from, so the desktop advertised and the modes lit cannot disagree.
///
/// The millimeters and the rate are the panel's own, off the same snapshot,
/// and either can be zero -- `wl_output`'s word for a screen with no such
/// number. A connector reports no physical size (a projector, a virtual
/// output) or no mode (connected but unreadable) often enough that this is an
/// ordinary reading rather than a broken one, and the compositor advertises
/// the zero rather than inventing something a client can divide by.
///
/// No scale yet: nothing on the DRM path sets a scale factor at all
/// (`drm_screen.cc` says so where it declines to), and a field that is always
/// 1 is not a reading. That is its own item on that document's checklist.
// Not `Copy` any more: a display carries the panel's own name, which is a
// `String`. Cloned where it used to be copied, on a list as long as the
// machine has monitors and only on a hotplug.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Display {
    /// What the engine calls this display, and what the `wl_output` is named
    /// after. Derived from the EDID, so it survives a hotplug: an output whose
    /// name is in both desktops keeps its global rather than being unplugged
    /// and replaced (`Screens::rearranged_into`).
    pub id: i64,
    /// The panel's own name -- `"<MAKE> <MODEL> <SERIAL>"` off its EDID -- or
    /// empty for a monitor that states none of the three.
    ///
    /// The id above is identity and this is a NAME, and the difference is the
    /// point: an int64 ozone derived from an EDID cannot be guessed from
    /// looking at a desk, so it is no use to somebody writing down which
    /// monitor a layout means. This is what an `output.profiles` entry matches
    /// on.
    ///
    /// MAKE is the three letters an EDID holds and nothing more -- `DEL`, not
    /// `Dell Inc.` -- because that is all the firmware states. The vendor's
    /// own name is hwdata's `pnp.ids`, which libdisplay-info carries and
    /// Chromium does not, so the string kanshi and sway match is this one with
    /// its first word spelled out. `crate::pnp_ids` is where this side reads
    /// that table, and `Screens` is where it is applied: a `wl_output` states
    /// the spelled-out name and a profile matches either spelling, so this
    /// string goes on being one of the names a monitor answers to.
    ///
    /// Called a description rather than a name because that is what it becomes
    /// one layer up: the `wl_output` keeps `drm-<id>` as its name, which is
    /// short, always present, and what clients are already on.
    pub description: String,
    /// Its top-left corner, in the desktop the engine laid out.
    pub position: (i32, i32),
    /// Its native mode, in physical pixels.
    pub size: (u32, u32),
    /// The panel's own size, in millimeters, or `(0, 0)` for a display that
    /// reports none.
    pub physical_mm: (i32, i32),
    /// The rate the CRTC took, in mHz, or zero for a display that reports
    /// none.
    pub refresh_mhz: i32,
}

/// One display, as the compositor wants the connector behind it driven.
///
/// The other direction to [`Display`], and the other kind of fact. That one
/// is the engine's reading of what is plugged in; this is the config's answer
/// about what to do with it -- which connectors to light, and where each
/// one's mode goes on the engine's own desktop.
///
/// By the engine's own id, which is the only name both sides have. The
/// `wl_output` this compositor advertises is called `drm-<id>`, and that is a
/// name it invented out of this number.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Connector {
    /// Which display, as [`Display::id`] named it.
    pub id: i64,
    /// Whether to light it at all.
    pub enabled: bool,
    /// Where this connector's mode goes on the engine's desktop, in physical
    /// pixels -- stated for a dark connector too, because the engine's own
    /// display list carries one whether or not it is lit.
    pub origin: (i32, i32),
}

/// What the browser has to tell the compositor, and what each already is in
/// Wayland terms.
#[derive(Debug, Clone, PartialEq, Eq)]
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
    /// A copy made in the browser, on its way to the seat.
    ///
    /// **The engine is not a Wayland client of this compositor**, so a copy
    /// made in a page or a browser window reaches no seat on its own: the
    /// browser is started before the compositor and connects to whatever
    /// display server it was launched under, which on a tty is none at all.
    /// This is how it reaches one — and it is why the desktop has a single
    /// clipboard rather than the browser having one and everything else
    /// another.
    Copied { clipboard: Clipboard, text: String },

    /// `wl_output`: the whole display list, primary first.
    ///
    /// Sent once when the engine has a screen and again on every hotplug, as
    /// the whole list rather than a delta -- so what is absent from it has
    /// been unplugged. There is no Wayland request this answers, because the
    /// compositor is the one that would normally have read the hardware; here
    /// the engine holds DRM master and this is how the reading crosses.
    Displays(Vec<Display>),
}

/// Which of the desktop's two clipboards a copy is on.
///
/// The pair every desktop has and neither of which is the other: one is what
/// Ctrl-C puts somewhere and the other is what selecting a word does. They
/// cross the ABI as the numbers [`Clipboard::as_raw`] gives, which is what the
/// C header declares and what the engine reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Clipboard {
    /// `wl_data_device`, which is Ctrl-C and Ctrl-V.
    Copy,
    /// `zwp_primary_selection_device_v1`, which is selecting a word and the
    /// middle button.
    Primary,
}

impl Clipboard {
    /// The number this crosses as. See `DomicileClipboard` in the C header.
    fn as_raw(self) -> u32 {
        match self {
            Clipboard::Copy => 0,
            Clipboard::Primary => 1,
        }
    }
}

/// Which clipboard a number off the ABI names.
///
/// Anything else is refused rather than folded onto the ordinary clipboard:
/// the plausible guess is the one a person uses most, and a copy landing there
/// because the engine learned a third would overwrite what they actually
/// copied with something they only brushed past.
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

/// `DomicileDisplay`, exactly as the C header lays it out.
///
/// Flat scalars rather than the pairs [`Display`] carries, because C has no
/// tuples and an array of these is what crosses the ABI. Not public:
/// [`Display`] is what a caller wants.
///
/// One `int64_t`, one pointer and seven `int32_t`, which is 44 bytes in a
/// struct that is 48 -- see the size test below, and the C header this
/// mirrors.
// `Default` for the tests' sake, and it is the right zero: a null name, which
// is what `displays_from` refuses, and zeros everywhere else.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
struct RawDisplay {
    id: i64,
    /// The panel's own name, borrowed for the duration of the callback. Never
    /// null, which [`displays_from`] checks rather than trusts.
    name: *const std::ffi::c_char,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    physical_width_mm: i32,
    physical_height_mm: i32,
    refresh_mhz: i32,
}

/// `DomicileDisplayLayout`, exactly as the C header lays it out.
///
/// Flat scalars and an `int32_t` for what is an `Option` on the safe side,
/// because C has neither tuples nor sum types. One `int64_t` and three
/// `int32_t`, which is 20 bytes in a struct that is 24 -- see the size test
/// below, and the C header this mirrors. Not public: [`Connector`] is what a
/// caller wants.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(C)]
struct RawLayout {
    id: i64,
    /// Nonzero to light this connector. Zero leaves it dark, and then the
    /// corner below says nothing.
    enabled: i32,
    x: i32,
    y: i32,
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

/// Where a color is in the browser's window.
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
/// a coordinate bug look like a missing surface. `bounds` is the color's
/// whole extent, or `None` if it is not in the window at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Capture {
    pub window: (i32, i32),
    pub bounds: Option<Bounds>,
}

impl Engine {
    /// Loads the library and joins the browser's mojo graph over `socket`.
    /// Surfaces come afterward, one per window, from [`Engine::create_surface`].
    ///
    /// `library` is a name or a path; a bare name is looked up the way `dlopen`
    /// looks one up.
    pub fn load(library: impl AsRef<Path>, socket: impl AsRef<Path>) -> Result<Self, EngineError> {
        let path = library.as_ref().to_path_buf();
        // SAFETY: loading a library runs its initializers, which is why this is
        // unsafe; there is no safe way to dlopen and the alternative is linking,
        // which is the thing this exists to avoid.
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
        })
    }

    /// Join the browser that replaced the one this was joined to, over a
    /// socket the new one bound.
    ///
    /// **THE LIBRARY IS NOT LOADED AGAIN AND MUST NOT BE.**
    /// `domicile_engine.cc` initializes mojo core and an `AtExitManager` once
    /// per process on purpose — "Both are process-global and neither can be
    /// torn down and re-created, which is why they outlive every engine rather
    /// than belonging to one" — and guards it with a function-local static, so
    /// a second `domicile_engine_connect` on the same loaded library is the
    /// case that library was written for. Everything that is per-connection is
    /// per-`DomicileEngine`: its own mojo thread, its own `ScopedIPCSupport`,
    /// its own event queue and its own surfaces. A second `dlopen` would hand
    /// back the same handle and the same statics anyway.
    ///
    /// **THE OLD ONE GOES FIRST**, because `domicile_engine_destroy` is what
    /// stops the thread that fires callbacks, and two engines in one process
    /// would be two `ScopedIPCSupport`s over one mojo core.
    ///
    /// The queue is the same allocation — the engine calls back through the
    /// pointer handed to `domicile_engine_connect`, and a `Box` does not move
    /// what it points at — but it is DRAINED first: whatever is in it names
    /// surfaces and buffers of a mojo graph that no longer exists.
    ///
    /// **A failure leaves this inert rather than gone.** The handle is null,
    /// which every entry point in `domicile_engine.h` answers by doing nothing
    /// and which [`Engine::fd`] answers with -1, so the compositor can keep
    /// the session and try again when the next page reaches it. Nothing about
    /// that is quiet: the caller gets the error and says so.
    ///
    /// **NOTHING HERE IS EXERCISED BY ANY CHECK IN THIS REPOSITORY.** It needs
    /// a built `libdomicile_engine.so` and a browser to dial, and no runner
    /// has either. See ROADMAP.md, *Needs a machine with a screen*.
    pub fn reconnect(&mut self, socket: &Path) -> Result<(), EngineError> {
        self.let_the_old_one_go();
        self.events.borrow_mut().clear();
        self.handle = join(&self.library, &self.path, &self.events, socket)?;
        Ok(())
    }

    /// End the connection this holds, if it still holds one.
    ///
    /// Asked twice over on the way out of a reconnect that is then dropped,
    /// which is why the null is checked rather than assumed away: a handle
    /// this has already given up is the ordinary state of an engine whose
    /// re-dial failed.
    fn let_the_old_one_go(&mut self) {
        let handle = std::mem::replace(&mut self.handle, std::ptr::null_mut());
        if !handle.is_null() {
            if let Ok(f) = self.symbol::<unsafe extern "C" fn(*mut Handle)>(
                b"domicile_engine_destroy\0",
                "domicile_engine_destroy",
            ) {
                // SAFETY: the handle is live until exactly here, and nothing
                // uses it afterward — it has been replaced with null above.
                unsafe { f(handle) };
            }
        }
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

    /// Tells the browser what is on one of the desktop's two clipboards.
    ///
    /// **The browser is told rather than asked**, because the compositor
    /// already has the bytes: a selection arriving on the seat is read out of
    /// the client that offered it whether or not anybody pastes, so there is
    /// nothing left to fetch and a page pasting answers out of memory.
    ///
    /// Empty is a clipboard with nothing on it, which is what a desktop that
    /// has just started has, and is said rather than left unsaid: a browser
    /// never told would go on offering whatever it was told last.
    ///
    /// **The bytes are length-carried**, because what a person copies may hold
    /// a nul and a C string would cut it there. Borrowed for the call: the
    /// browser copies before it returns.
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

    /// Tells the browser which connectors to light and where.
    ///
    /// An empty list is not "light nothing": it is the compositor having no
    /// opinion, which is what every desktop but a profile's has, and the
    /// engine answers it by going back to lighting what the hardware reports.
    /// That is the case that UNDOES a profile -- one that turned a panel off
    /// stops matching the moment a monitor is unplugged.
    ///
    /// Nothing comes back. A modeset is committed on the browser's own DRM
    /// thread and answered on a later task, so there is nothing to wait for
    /// here that would not be a lie; what the compositor learns instead is
    /// the display list the engine sends once the hardware has answered.
    pub fn configure_displays(&self, connectors: &[Connector]) {
        let f: Symbol<unsafe extern "C" fn(*mut Handle, *const RawLayout, u32)> = match self.symbol(
            b"domicile_displays_configure\0",
            "domicile_displays_configure",
        ) {
            Ok(symbol) => symbol,
            Err(_) => return,
        };
        let raw = layouts_from(connectors);
        // SAFETY: as above, and `raw` outlives the call -- the engine copies
        // what it is given, which is the same contract the display list
        // crossing the other way states.
        unsafe { f(self.handle, raw.as_ptr(), raw.len() as u32) };
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
    /// at the center of the browser's window, which is where every spike page
    /// puts the `<app>`.
    ///
    /// Here because only one process may hold the browser's invitation and the
    /// compositor is now that process, so nothing else can ask. It goes when
    /// the spike's pages do.
    pub fn spike_window_center(&self) -> Option<u32> {
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
    /// The center stops being enough the moment a page holds two `<app>`
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
    /// probe. That is not the same as the color being absent, and a guard's
    /// negative control turns on the difference: "the color is not there" is
    /// the control passing and "nothing was read" is the control having
    /// measured nothing while looking identical.
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
        self.let_the_old_one_go();
    }
}

/// Join the browser listening at `socket`, with `events` the queue its
/// callbacks push into.
///
/// A free function rather than a method because it is what builds an
/// [`Engine`] as well as what re-dials one, and the first of those has no
/// `self` to be a method on.
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
    };
    let socket_c = CString::new(socket.as_os_str().as_encoded_bytes())?;
    let connect: Symbol<unsafe extern "C" fn(*const c_char, Callbacks) -> *mut Handle> = symbol(
        library,
        path,
        b"domicile_engine_connect\0",
        "domicile_engine_connect",
    )?;
    // SAFETY: the signature matches domicile_engine.h, the string is
    // nul-terminated by CString, and `events` outlives the handle because both
    // are owned by the Engine this is building or re-dialing.
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
    // SAFETY: the caller states the signature, and every call site here states
    // one that matches domicile_engine.h.
    unsafe { library.get(name) }.map_err(|source| EngineError::Symbol {
        path: path.to_path_buf(),
        symbol: readable,
        source,
    })
}

/// The four callbacks, which do nothing but queue: they fire inside
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

/// The only callback that carries an array, so the only one with a length to
/// believe. An empty list is queued as one rather than dropped: `DrmScreen`
/// answers with its displayless display instead of nothing, so zero displays
/// is the engine breaking its own contract and `Screens::from_the_engine` is
/// where that is refused -- silently dropping it here would leave the desktop
/// on a stale list with nothing said.
extern "C" fn on_displays(user_data: *mut c_void, displays: *const RawDisplay, count: u32) {
    // SAFETY: the ABI says `displays` points at `count` records, and the
    // engine's own queue is what fills them in. Borrowed only for this call:
    // `displays_from` copies, so nothing outlives the callback.
    let records = unsafe { std::slice::from_raw_parts(displays, count as usize) };
    push(user_data, Event::Displays(displays_from(records)));
}

/// A copy made in the browser, as the bytes it was made of.
///
/// **Length-carried rather than nul-terminated**, which is the one place this
/// ABI differs from the rest of itself, and for a reason that is about
/// clipboards rather than taste: what a person copies is arbitrary bytes and
/// may hold a nul, which a C string cannot say and would cut short. See
/// `domicile_clipboard_set`, which crosses the other way on the same terms.
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
    // SAFETY: the ABI says `text` points at `length` bytes, borrowed for the
    // duration of this call; `String::from_utf8_lossy` copies before it
    // returns, so nothing outlives the callback.
    let bytes = unsafe { std::slice::from_raw_parts(text.cast::<u8>(), length) };
    push(
        user_data,
        Event::Copied {
            clipboard: clipboard_from(clipboard),
            // Lossy, like a panel's name, and for a reason that makes it
            // unreachable rather than tolerated: the bytes arrive over a mojom
            // `string`, which mojo itself validates as UTF-8 before the
            // browser ever sees them. What lossy buys is that a validator
            // changing its mind costs a replacement character somebody can see
            // rather than the desktop.
            text: String::from_utf8_lossy(bytes).into_owned(),
        },
    );
}

/// The ABI's flat records as the pairs the compositor lays out in.
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

/// The connectors as the flat records that cross the ABI.
///
/// The mirror of [`displays_from`], which does this for the list coming the
/// other way.
fn layouts_from(connectors: &[Connector]) -> Vec<RawLayout> {
    connectors
        .iter()
        .map(|connector| RawLayout {
            id: connector.id,
            enabled: i32::from(connector.enabled),
            x: connector.origin.0,
            y: connector.origin.1,
        })
        .collect()
}

/// The panel's own name, copied out of the record's borrowed characters.
///
/// Null is refused rather than read. The C header states the pointer is never
/// null, so one that is means the engine broke its own contract -- and the
/// cost of trusting it is not a wrong answer but undefined behavior, because
/// `CStr::from_ptr` reads through whatever it is given.
///
/// Lossy, on the other side, and deliberately: the characters are an EDID's,
/// which the engine restricts to printable ASCII before sending, so invalid
/// UTF-8 is a panel doing something no panel does. Replacing it is a name
/// nobody will match and everybody can see, which beats taking the desktop
/// down over a monitor's firmware.
fn description_of(record: &RawDisplay) -> String {
    assert!(
        !record.name.is_null(),
        "the engine names every display, even if it names it nothing"
    );
    // SAFETY: non-null by the assertion above, nul-terminated and valid for
    // the duration of this call by the ABI -- the engine owns the characters
    // and frees them when the callback returns, and this copies before then.
    unsafe { std::ffi::CStr::from_ptr(record.name) }
        .to_string_lossy()
        .into_owned()
}

/// A display's extent as the `u32` a size is here.
///
/// `int32_t` on the wire because a DRM mode is measured the same way a
/// position is and the C header says so once; never negative, because a mode
/// is a mode. Asserted rather than folded: a negative extent is an engine
/// reporting something that is not a screen, and the plausible positive a
/// cast would make is a desktop of the wrong size with nothing to say why.
fn as_extent(measure: i32) -> u32 {
    u32::try_from(measure).expect("a display's mode is never negative")
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
    /// The two clipboards cross as numbers, and which number is which is as
    /// much part of the ABI as any struct's size. Reversed, they would paste
    /// what a person selected where they expected what they copied.
    #[test]
    fn each_clipboard_crosses_as_the_number_the_c_header_gives_it() {
        assert_eq!(Clipboard::Copy.as_raw(), 0);
        assert_eq!(Clipboard::Primary.as_raw(), 1);
        assert_eq!(clipboard_from(0), Clipboard::Copy);
        assert_eq!(clipboard_from(1), Clipboard::Primary);
    }

    /// A number the header does not declare is an engine this compositor does
    /// not understand. Refused rather than folded onto one of the two: the
    /// plausible guess is the ordinary clipboard, and a copy landing on it
    /// because a third one was added is a paste that silently overwrites what
    /// the user actually copied.
    #[test]
    #[should_panic(expected = "clipboard")]
    fn a_clipboard_the_header_does_not_declare_is_refused() {
        clipboard_from(2);
    }

    #[test]
    fn a_capture_is_the_six_int32_the_c_header_declares() {
        assert_eq!(
            std::mem::size_of::<RawCapture>(),
            6 * std::mem::size_of::<i32>()
        );
    }

    /// The same guard as above, for the struct a display list is an array of.
    /// A field added or dropped on one side of the ABI and not the other reads
    /// every display after the first out of the middle of its neighbor.
    ///
    /// Spelled as a number rather than as a sum of its fields, because the
    /// struct is no longer the sum of its fields: one `int64_t` and seven
    /// `int32_t` is 36 bytes, and a struct aligned to its widest member rounds
    /// that to 40. The four bytes of tail padding are as much part of the ABI
    /// as the fields are -- both sides get them from the same rule -- and a
    /// sum would have quietly asserted 36 and failed on a struct that is
    /// correct.
    #[test]
    fn a_display_is_the_one_int64_the_pointer_and_seven_int32_the_c_header_declares() {
        // 8 for the id, 8 for the name's pointer, 28 for the seven `int32_t`,
        // and four bytes of tail padding to the struct's own alignment: 48.
        // Asserted rather than summed for the reason the 40 before it was --
        // the padding is as much part of the ABI as the fields, and a sum
        // would assert 44 and fail on a struct that is correct.
        assert_eq!(std::mem::size_of::<RawDisplay>(), 48);
    }

    #[test]
    fn a_connector_is_the_one_int64_and_three_int32_the_c_header_declares() {
        // 8 for the id, 12 for the three `int32_t`, and four bytes of tail
        // padding to the struct's own alignment: 24. Asserted rather than
        // summed, for the reason the display's 48 is: the padding is as much
        // part of the ABI as the fields are.
        assert_eq!(std::mem::size_of::<RawLayout>(), 24);
    }

    #[test]
    fn a_lit_connector_crosses_as_its_corner_and_a_yes() {
        let raw = layouts_from(&[Connector {
            id: 7,
            enabled: true,
            origin: (3840, 0),
        }]);

        assert_eq!(
            raw,
            vec![RawLayout {
                id: 7,
                enabled: 1,
                x: 3840,
                y: 0,
            }]
        );
    }

    #[test]
    fn a_dark_connector_crosses_as_a_no_and_a_corner_that_still_matters() {
        // The corner is not a leftover. A dark connector is still one the
        // engine's display list has to place, and one left where the card
        // stacked it lands on top of a monitor that is on -- so the compositor
        // gives it a corner of its own, out of the way.
        let raw = layouts_from(&[Connector {
            id: 3,
            enabled: false,
            origin: (11520, 0),
        }]);

        assert_eq!(
            raw,
            vec![RawLayout {
                id: 3,
                enabled: 0,
                x: 11520,
                y: 0,
            }]
        );
    }

    /// A `RawDisplay` naming `name`, which the returned `CString` owns.
    ///
    /// Paired so the storage outlives the record: a bare `CString::new(..)
    /// .as_ptr()` in an argument position is freed at the end of the
    /// statement, and the pointer left behind is exactly the dangling read
    /// this type exists to be careful about.
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
        // What the whole EDID path is for: an int64 nobody can predict beside
        // a string somebody can write down.
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
        // A projector, a virtual output, a panel whose maker left the
        // descriptors out. Empty is the reading, and the id still identifies
        // it.
        let (record, _owned) = named(RawDisplay::default(), "");

        assert_eq!(displays_from(&[record])[0].description, "");
    }

    #[test]
    #[should_panic(expected = "the engine names every display")]
    fn a_null_name_is_refused_rather_than_read() {
        // The header says the pointer is never null, and a null one is the
        // engine breaking its own contract. Checked rather than trusted
        // because the alternative is not a wrong answer but undefined
        // behavior: `CStr::from_ptr` on null reads through it.
        let _ = displays_from(&[RawDisplay::default()]);
    }

    #[test]
    fn a_display_list_crosses_the_abi_as_the_compositor_counts_them() {
        // The ABI counts a corner and an extent separately because C has no
        // tuples; the compositor pairs them because everything it lays out is
        // a pair.
        //
        // The second display carries zeros for the panel, which is not a
        // second display with a bug in it: a connector that reports no
        // millimeters is ordinary -- a projector, a virtual output -- and zero
        // is what `wl_output` states for one. A conversion that invented a
        // size for it would be the fiction this whole path exists to remove.
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
