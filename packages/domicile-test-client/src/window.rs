//! A mapped toplevel that keeps drawing.
//!
//! The smallest client that is a *real* one: it binds the globals a desktop
//! client binds, drives the `xdg_surface` configure handshake, attaches a
//! `wl_shm` buffer, and asks for a frame callback so it draws for as long as
//! it runs. Every one of those is something a check needs — a window that
//! never commits is not mapped, and a window that draws once cannot be the
//! subject of a check about a compositor that is behind.

use std::os::fd::AsFd as _;
use std::os::unix::fs::FileExt as _;

use wayland_client::protocol::{
    wl_buffer, wl_callback, wl_compositor, wl_keyboard, wl_pointer, wl_registry, wl_seat, wl_shm,
    wl_shm_pool, wl_surface,
};
use wayland_client::{delegate_noop, Connection, Dispatch, QueueHandle, WEnum};
use wayland_protocols::xdg::shell::client::{xdg_surface, xdg_toplevel, xdg_wm_base};

/// What can go wrong being a client.
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("there is no compositor to connect to: {0}")]
    NoDisplay(String),

    #[error("the compositor advertises no {global}, which a window needs")]
    Missing { global: &'static str },

    #[error("the connection failed: {0}")]
    Lost(String),

    #[error("could not make a buffer to draw into: {0}")]
    NoBuffer(String),
}

/// The window's size, in the surface's own pixels.
///
/// Fixed rather than asked for: every check in `scripts/` needs *a* window and
/// asserts on what the compositor did with it. Small enough to be cheap to
/// composite and large enough to be a window rather than a dot — and not a
/// screen size, because a client that filled the desktop would hide whichever
/// placement bug a check was looking at. A check that comes to care about the
/// size brings the flag back with it.
const SIZE: (u32, u32) = (320, 240);

/// The two colours a frame alternates between.
///
/// Alternating, so that "is it still drawing" can be answered by looking at
/// the window rather than by trusting a counter this process prints.
const COLOURS: [u32; 2] = [0x00_20_30_50, 0x00_30_50_80];

/// Open a window on `$WAYLAND_DISPLAY` and draw until killed.
///
/// Returns only on a failure: a client whose job is to be a window for the
/// length of a check has nothing to return early *for*, and every caller in
/// `scripts/` ends it with a signal.
pub fn run(title: &str) -> Result<std::convert::Infallible, ClientError> {
    let connection =
        Connection::connect_to_env().map_err(|err| ClientError::NoDisplay(err.to_string()))?;
    let mut queue = connection.new_event_queue();
    let handle = queue.handle();
    // Kept rather than discarded: binding happens once the whole list has
    // arrived, and `bind` is a request on the registry rather than on the
    // connection. Taking it from here instead of from the event means there is
    // no window in which it does not exist.
    let registry = connection.display().get_registry(&handle, ());

    // Two roundtrips: the first brings the globals, the second brings what
    // binding them produced — the `wl_shm.format` list, and the seat's
    // capabilities, which is what says whether there is a keyboard to bind.
    let mut client = Client::new(title.to_string());
    queue
        .roundtrip(&mut client)
        .map_err(|err| ClientError::Lost(err.to_string()))?;
    client.bind(&registry, &handle);
    queue
        .roundtrip(&mut client)
        .map_err(|err| ClientError::Lost(err.to_string()))?;

    client.open(&handle)?;
    loop {
        queue
            .blocking_dispatch(&mut client)
            .map_err(|err| ClientError::Lost(err.to_string()))?;
    }
}

/// The globals a window needs, and the window once it has them.
struct Client {
    title: String,
    globals: Globals,
    /// Made by [`Client::open`], which `run` calls before dispatching anything
    /// that could draw. An event arriving with this still unset would be the
    /// compositor talking about a surface this client never created.
    window: Option<Window>,
    /// Set once the compositor has acknowledged the first configure. Until
    /// then a buffer must not be attached — the surface has no agreed size to
    /// attach one *at*.
    configured: bool,
    /// Which of the two colours the next frame draws.
    frame: u32,
}

/// The surface and the pixels behind it, which exist together or not at all.
struct Window {
    surface: wl_surface::WlSurface,
    pixels: Pixels,
}

/// Two buffers over one shared file, alternating.
///
/// Made once rather than per frame. The first draft allocated, filled and
/// unlinked a fresh file for every callback — correct, and about 34 MB a
/// second of it at the rate a headless compositor hands out frames, inside
/// checks whose subject is timing. Two buffers is what a client does instead:
/// draw into the one the compositor has given back, leave the one it is
/// reading alone.
struct Pixels {
    /// Written through rather than mapped: the compositor's mapping is
    /// `MAP_SHARED` on this same file, so a write through the descriptor is a
    /// write it sees — and no `unsafe` is needed to do it.
    file: std::fs::File,
    buffers: [wl_buffer::WlBuffer; 2],
    /// Whether the compositor still holds each buffer. A client that drew
    /// into a held buffer would be rewriting the frame being displayed.
    held: [bool; 2],
    /// Bytes in one buffer, which is also the second one's offset.
    each: usize,
    /// Each colour laid out as a whole buffer, once.
    ///
    /// A frame is then one `pwrite` of one of these, rather than the row loop
    /// this started as — one syscall per scanline, measured at 240 a frame
    /// against 264 commits, inside checks whose subject is timing. It is now
    /// one per frame. Held rather than built per frame so a frame allocates
    /// nothing.
    colours: [Vec<u8>; 2],
}

/// What the registry advertised, before any of it is bound.
#[derive(Default)]
struct Globals {
    compositor: Option<wl_compositor::WlCompositor>,
    shm: Option<wl_shm::WlShm>,
    wm_base: Option<xdg_wm_base::XdgWmBase>,
    named: Vec<(u32, String, u32)>,
}

impl Client {
    fn new(title: String) -> Client {
        Client {
            title,
            globals: Globals::default(),
            window: None,
            configured: false,
            frame: 0,
        }
    }

    /// Bind what the registry named.
    ///
    /// Separate from the registry event because binding needs the whole list:
    /// `wl_seat` is bound at the version the compositor offered rather than at
    /// a number written here, and a client that guessed high is one the
    /// compositor disconnects.
    fn bind(&mut self, registry: &wl_registry::WlRegistry, handle: &QueueHandle<Client>) {
        let named = std::mem::take(&mut self.globals.named);
        for (name, interface, version) in named {
            match interface.as_str() {
                "wl_compositor" => {
                    self.globals.compositor = Some(registry.bind(name, version.min(4), handle, ()));
                }
                "wl_shm" => {
                    self.globals.shm = Some(registry.bind(name, version.min(1), handle, ()));
                }
                "xdg_wm_base" => {
                    self.globals.wm_base = Some(registry.bind(name, version.min(3), handle, ()));
                }
                // Bound and dropped on purpose: a seat is what carries the
                // keyboard and the pointer, and a compositor only sends input
                // to a client that asked for them. The handler below gets the
                // seat back as its own argument, and dropping a proxy sends no
                // destructor, so there is nothing here worth keeping.
                "wl_seat" => {
                    let _: wl_seat::WlSeat = registry.bind(name, version.min(5), handle, ());
                }
                _ => {}
            }
        }
    }

    /// Make the surface, the pixels, and ask for a window.
    fn open(&mut self, handle: &QueueHandle<Client>) -> Result<(), ClientError> {
        let compositor = self
            .globals
            .compositor
            .as_ref()
            .ok_or(ClientError::Missing {
                global: "wl_compositor",
            })?;
        let wm_base = self.globals.wm_base.as_ref().ok_or(ClientError::Missing {
            global: "xdg_wm_base",
        })?;
        // Here rather than at the first frame, so that a compositor offering
        // no `wl_shm` is a failure `run` returns — a client that discovered it
        // from inside an event handler could only print and carry on, and what
        // a check would see is a window that never mapped.
        let shm = self
            .globals
            .shm
            .as_ref()
            .ok_or(ClientError::Missing { global: "wl_shm" })?;

        let surface = compositor.create_surface(handle, ());
        let xdg = wm_base.get_xdg_surface(&surface, handle, ());
        let toplevel = xdg.get_toplevel(handle, ());
        toplevel.set_title(self.title.clone());
        // An app id is what a chrome keys a window by, so a window with none
        // is one a shell cannot address. The title is the human name; this is
        // the one programs match on.
        toplevel.set_app_id("dev.domicile.test-client".to_string());
        let pixels = Pixels::new(shm, handle, SIZE.0, SIZE.1)?;
        // The commit that starts the handshake, and it must carry no buffer:
        // the compositor answers it with the size the surface may use, and
        // attaching before that is asking for a size nobody agreed to.
        surface.commit();
        self.window = Some(Window { surface, pixels });
        Ok(())
    }

    /// Draw one frame and ask to be woken for the next.
    fn draw(&mut self, handle: &QueueHandle<Client>) -> Result<(), ClientError> {
        let (width, height) = SIZE;
        let colour = (self.frame % 2) as usize;
        let window = self
            .window
            .as_mut()
            .expect("open() runs before anything that could draw");

        // The callback first, and unconditionally: it is what gets this
        // client woken again. Skipping it on a frame with nothing to draw
        // into would stop the loop for good.
        window.surface.frame(handle, ());
        // A `None` here is both buffers still with the compositor, and the
        // commit below is still right: it carries the frame request, which is
        // what asks to be told when there is a point in drawing again.
        //
        // There is no backoff on that path, and it does not need one against
        // this compositor, which releases a buffer every frame — measured at
        // the same ~5% CPU as drawing normally, including with a chrome that
        // reads nothing. Against a compositor that held both past the frame
        // callback it would spin, because a commit carrying only a frame
        // request is answered at once: forced, that measured ~38% CPU and
        // ~6000 commits a second. Left as it is rather than throttled on a
        // case nothing here reaches, but it is a trap if one ever does.
        let drew = match window.pixels.free() {
            Some(index) => {
                window.pixels.fill(index, colour)?;
                window
                    .surface
                    .attach(Some(&window.pixels.buffers[index]), 0, 0);
                window.surface.damage(0, 0, width as i32, height as i32);
                window.pixels.held[index] = true;
                true
            }
            None => false,
        };
        window.surface.commit();
        // Advanced per frame *drawn*, not per buffer used: which of the two
        // buffers is free depends on when the compositor gets round to
        // releasing one, and a colour that tracked that would stop alternating
        // against a compositor that always released the same one first.
        if drew {
            self.frame = self.frame.wrapping_add(1);
        }
        Ok(())
    }
}

impl Pixels {
    fn new(
        shm: &wl_shm::WlShm,
        handle: &QueueHandle<Client>,
        width: u32,
        height: u32,
    ) -> Result<Pixels, ClientError> {
        let each = (width as usize) * (height as usize) * 4;
        let file = anonymous(each * 2)
            .map_err(|err| ClientError::NoBuffer(format!("no memory to draw in: {err}")))?;
        let pool = shm.create_pool(file.as_fd(), (each * 2) as i32, handle, ());
        let buffers = [0usize, 1].map(|index| {
            pool.create_buffer(
                (index * each) as i32,
                width as i32,
                height as i32,
                (width * 4) as i32,
                wl_shm::Format::Xrgb8888,
                handle,
                index,
            )
        });
        // The pool is only a way to cut buffers out of the file; the buffers
        // keep it alive on the compositor's side, so nothing here needs it
        // again.
        pool.destroy();
        let colours = COLOURS.map(|colour| {
            colour
                .to_ne_bytes()
                .iter()
                .copied()
                .cycle()
                .take(each)
                .collect()
        });
        Ok(Pixels {
            file,
            buffers,
            held: [false, false],
            each,
            colours,
        })
    }

    /// A buffer the compositor has given back, if there is one.
    fn free(&self) -> Option<usize> {
        self.held.iter().position(|held| !held)
    }

    /// Fill one buffer with one of the two flat colours.
    fn fill(&self, index: usize, colour: usize) -> Result<(), ClientError> {
        self.file
            .write_all_at(&self.colours[colour], (index * self.each) as u64)
            .map_err(|err| ClientError::NoBuffer(format!("could not fill the buffer: {err}")))
    }
}

/// A file of `bytes` bytes with no name, to share pixels through.
///
/// `memfd` would be tidier and is not on every machine these checks run on; an
/// unlinked temp file is what `wl_shm` has always taken. Unlinked at once, so
/// the mapping outlives the name and nothing is left in `$XDG_RUNTIME_DIR` —
/// which some of these checks assert about.
fn anonymous(bytes: usize) -> std::io::Result<std::fs::File> {
    let directory = std::env::var_os("XDG_RUNTIME_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let path = directory.join(format!("domicile-test-client-{}", std::process::id()));
    let file = std::fs::File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(&path)?;
    std::fs::remove_file(&path)?;
    file.set_len(bytes as u64)?;
    Ok(file)
}

/// Draw, or end the process saying why.
///
/// The two callers are event handlers, which cannot return a `Result`. Ending
/// here rather than printing and carrying on is what keeps `run`'s promise
/// that this client only stops on a failure: a `draw` that failed has already
/// skipped the `frame` request it needed to be woken again, so carrying on
/// means a live process with no window and nothing left to wake it — which a
/// check reads as the compositor never mapping anything.
fn draw_or_stop(client: &mut Client, handle: &QueueHandle<Client>) {
    if let Err(err) = client.draw(handle) {
        eprintln!("domicile-test-client: {err}");
        std::process::exit(1);
    }
}

impl Dispatch<wl_registry::WlRegistry, ()> for Client {
    fn event(
        client: &mut Client,
        _: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        (): &(),
        _: &Connection,
        _: &QueueHandle<Client>,
    ) {
        if let wl_registry::Event::Global {
            name,
            interface,
            version,
        } = event
        {
            client.globals.named.push((name, interface, version));
        }
    }
}

impl Dispatch<xdg_wm_base::XdgWmBase, ()> for Client {
    fn event(
        _: &mut Client,
        wm_base: &xdg_wm_base::XdgWmBase,
        event: xdg_wm_base::Event,
        (): &(),
        _: &Connection,
        _: &QueueHandle<Client>,
    ) {
        // The one event a client must answer or be killed for not answering.
        if let xdg_wm_base::Event::Ping { serial } = event {
            wm_base.pong(serial);
        }
    }
}

impl Dispatch<xdg_surface::XdgSurface, ()> for Client {
    fn event(
        client: &mut Client,
        xdg: &xdg_surface::XdgSurface,
        event: xdg_surface::Event,
        (): &(),
        _: &Connection,
        handle: &QueueHandle<Client>,
    ) {
        if let xdg_surface::Event::Configure { serial } = event {
            xdg.ack_configure(serial);
            // The first configure is what makes the surface attachable, and
            // the frame drawn here is what maps the window. Later ones are
            // answered and left alone: this client keeps the size it asked
            // for, because a check that stated a size wants that size.
            if !client.configured {
                client.configured = true;
                draw_or_stop(client, handle);
            }
        }
    }
}

impl Dispatch<xdg_toplevel::XdgToplevel, ()> for Client {
    fn event(
        _: &mut Client,
        _: &xdg_toplevel::XdgToplevel,
        event: xdg_toplevel::Event,
        (): &(),
        _: &Connection,
        _: &QueueHandle<Client>,
    ) {
        // A compositor that closed the window has ended this client's job, and
        // exiting is how a check sees that it did: `e2e-close.sh` asserts on
        // the process going away.
        if let xdg_toplevel::Event::Close = event {
            std::process::exit(0);
        }
    }
}

impl Dispatch<wl_callback::WlCallback, ()> for Client {
    fn event(
        client: &mut Client,
        _: &wl_callback::WlCallback,
        event: wl_callback::Event,
        (): &(),
        _: &Connection,
        handle: &QueueHandle<Client>,
    ) {
        if let wl_callback::Event::Done { .. } = event {
            draw_or_stop(client, handle);
        }
    }
}

impl Dispatch<wl_buffer::WlBuffer, usize> for Client {
    fn event(
        client: &mut Client,
        _: &wl_buffer::WlBuffer,
        event: wl_buffer::Event,
        index: &usize,
        _: &Connection,
        _: &QueueHandle<Client>,
    ) {
        // The compositor is done reading this one, so the next frame may draw
        // into it. Without this the client runs out of buffers after two
        // frames and never draws again.
        if let wl_buffer::Event::Release = event {
            let window = client
                .window
                .as_mut()
                .expect("a buffer was cut from this window's pool");
            window.pixels.held[*index] = false;
        }
    }
}

impl Dispatch<wl_seat::WlSeat, ()> for Client {
    fn event(
        _: &mut Client,
        seat: &wl_seat::WlSeat,
        event: wl_seat::Event,
        (): &(),
        _: &Connection,
        handle: &QueueHandle<Client>,
    ) {
        // Taking the keyboard and the pointer is what makes the compositor
        // send input here at all. Nothing reads what arrives: the checks that
        // are about input read this client's protocol log.
        if let wl_seat::Event::Capabilities {
            capabilities: WEnum::Value(capabilities),
        } = event
        {
            if capabilities.contains(wl_seat::Capability::Keyboard) {
                seat.get_keyboard(handle, ());
            }
            if capabilities.contains(wl_seat::Capability::Pointer) {
                seat.get_pointer(handle, ());
            }
        }
    }
}

delegate_noop!(Client: ignore wl_compositor::WlCompositor);
delegate_noop!(Client: ignore wl_shm::WlShm);
delegate_noop!(Client: ignore wl_shm_pool::WlShmPool);
delegate_noop!(Client: ignore wl_surface::WlSurface);
delegate_noop!(Client: ignore wl_keyboard::WlKeyboard);
delegate_noop!(Client: ignore wl_pointer::WlPointer);
