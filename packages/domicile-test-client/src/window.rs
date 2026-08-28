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

use wayland_client::backend::ObjectId;
use wayland_client::protocol::{
    wl_buffer, wl_callback, wl_compositor, wl_keyboard, wl_output, wl_pointer, wl_registry,
    wl_seat, wl_shm, wl_shm_pool, wl_surface,
};
use wayland_client::{delegate_noop, Connection, Dispatch, Proxy as _, QueueHandle, WEnum};
use wayland_protocols::wp::cursor_shape::v1::client::{
    wp_cursor_shape_device_v1, wp_cursor_shape_manager_v1,
};
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
    /// How this client asks for a cursor, made with the pointer it names.
    ///
    /// A shape rather than a surface of our own: `wp_cursor_shape_v1` is
    /// modelled on the CSS keywords, which is what the compositor passes
    /// through to the chrome — so a check can read the name the client asked
    /// for rather than a picture nobody here can see.
    cursor: Option<wp_cursor_shape_device_v1::WpCursorShapeDeviceV1>,
    // NOTE: still an Option because the pointer it names does not exist until
    // the seat says there is one. `open` refuses a compositor with no manager
    // to make it from, so a `None` here is a seat with no pointer.
    /// What each output said its scale is, as it said so.
    ///
    /// Kept per output rather than as one number because a surface can be on
    /// two screens of different densities, and the answer is then the larger
    /// of them — a buffer drawn for the coarser one is visibly soft on the
    /// finer, where the reverse only wastes pixels.
    scales: Vec<(ObjectId, i32)>,
    /// Which outputs the surface is currently on.
    entered: Vec<ObjectId>,
    /// The registry name each bound output arrived under.
    ///
    /// `wl_registry.global_remove` names a screen by that rather than by the
    /// object, so without this a display that went away would leave its scale
    /// and its entry behind — and `e2e-reload-displays` swaps the display list
    /// while the client runs, so they would accumulate for the life of it.
    outputs: Vec<(u32, ObjectId)>,
}

/// The surface and the pixels behind it, which exist together or not at all.
struct Window {
    surface: wl_surface::WlSurface,
    pixels: Pixels,
    /// The buffer scale these pixels were made for.
    ///
    /// The surface stays [`SIZE`] however dense the screen is; what changes is
    /// how many buffer pixels cover it. That is what `set_buffer_scale` means
    /// and what a check about density reads.
    scale: i32,
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
    cursor: Option<wp_cursor_shape_manager_v1::WpCursorShapeManagerV1>,
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
            cursor: None,
            scales: Vec::new(),
            entered: Vec::new(),
            outputs: Vec::new(),
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
                "wp_cursor_shape_manager_v1" => {
                    self.globals.cursor = Some(registry.bind(name, version.min(1), handle, ()));
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
        // On the same footing as the three above, because it is now just as
        // load-bearing: asking for a cursor is the only thing that tells the
        // compositor there is one to pass to the chrome, and
        // `tests/input.rs::a_pointer_over_a_window_asks_the_chrome_for_that_window_s_cursor`
        // asserts the chrome was told. Left as a silent `None`, a compositor
        // that advertised no manager would fail that check — convicting the
        // compositor of a gap that is this client's.
        if self.globals.cursor.is_none() {
            return Err(ClientError::Missing {
                global: "wp_cursor_shape_manager_v1",
            });
        }

        let surface = compositor.create_surface(handle, ());
        let xdg = wm_base.get_xdg_surface(&surface, handle, ());
        let toplevel = xdg.get_toplevel(handle, ());
        toplevel.set_title(self.title.clone());
        crate::say!(toplevel.id(), "set_title(\"{}\")", self.title);
        // An app id is what a chrome keys a window by, so a window with none
        // is one a shell cannot address. The title is the human name; this is
        // the one programs match on.
        toplevel.set_app_id("dev.domicile.test-client".to_string());
        // Scale 1 here, not whatever the outputs have said: the surface has
        // not entered one yet — that only happens once it is mapped — so there
        // is no screen whose density this window is on. `follow` raises it
        // when `wl_surface.enter` says which.
        let pixels = Pixels::new(shm, handle, SIZE.0, SIZE.1)?;
        // The commit that starts the handshake, and it must carry no buffer:
        // the compositor answers it with the size the surface may use, and
        // attaching before that is asking for a size nobody agreed to.
        surface.commit();
        self.window = Some(Window {
            surface,
            pixels,
            scale: 1,
        });
        Ok(())
    }

    /// The density of the screens this surface is on, if it is on any.
    ///
    /// `None` when it is on none. That is every moment before the first
    /// `wl_surface.enter` — a client cannot know what it is being shown on
    /// until it is told — and also the moment a mapped window is told it left
    /// its last output, which occlusion, a workspace switch or a screen going
    /// away all produce. Answering "1" for the second case would rebuild the
    /// buffers at 1x and then again at 2x on the next `enter`, so the caller
    /// keeps the density it had instead.
    fn wanted_scale(&self) -> Option<i32> {
        self.entered
            .iter()
            .filter_map(|on| self.scales.iter().find(|(id, _)| id == on))
            .map(|(_, scale)| *scale)
            .max()
    }

    /// Redraw for the screen this window is on, if that has changed.
    ///
    /// This is the half of being scale-aware that a check can see: a client
    /// that only reads `wl_output.scale` and never acts on it is a client that
    /// draws a 1x picture on a 2x screen, which is exactly the blurry window
    /// `e2e-hidpi` exists to catch. The buffer grows; the surface does not.
    fn follow(&mut self, handle: &QueueHandle<Client>) -> Result<(), ClientError> {
        // On no screen: keep what we have. See [`Client::wanted_scale`].
        let Some(wanted) = self.wanted_scale() else {
            return Ok(());
        };
        // Before `open`, which is where the outputs' first `scale` events
        // arrive: there is no surface to set a scale on yet, and `open` makes
        // its pixels at 1 because the surface is on no screen until it maps.
        let Some(window) = self.window.as_mut() else {
            return Ok(());
        };
        if window.scale == wanted {
            return Ok(());
        }
        let shm = self
            .globals
            .shm
            .as_ref()
            .expect("open() proved there is a wl_shm before there was a window");

        window.surface.set_buffer_scale(wanted);
        crate::say!(window.surface.id(), "set_buffer_scale({})", wanted);
        // Destroyed, not dropped. Dropping a `wayland-client` proxy sends no
        // destructor, so the old buffers would stay alive on both sides: they
        // would go on delivering `release` into a handler keyed on an index
        // into the *new* pool — measured, six stale releases each clearing a
        // different buffer's slot — and they are the only thing holding the
        // old pool's mapping, since the pool itself is destroyed at creation.
        // That is a leak of 614 KB at 1x and 2.4 MB at 2x per rescale.
        //
        // Destroying says we will not use them again; the compositor keeps
        // whatever it still needs to finish reading them.
        for buffer in &window.pixels.buffers {
            buffer.destroy();
        }
        window.pixels = Pixels::new(shm, handle, SIZE.0 * wanted as u32, SIZE.1 * wanted as u32)?;
        window.scale = wanted;
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

/// Follow the screen's density, or end the process saying why.
///
/// The mirror of [`draw_or_stop`], and for the same reason: the callers are
/// event handlers that cannot return a `Result`, and a client that failed to
/// remake its pixels has no buffers left to draw into. Carrying on would show
/// a check a window that stopped redrawing, which reads as a compositor that
/// stopped sending frames.
fn follow_or_stop(client: &mut Client, handle: &QueueHandle<Client>) {
    if let Err(err) = client.follow(handle) {
        eprintln!("domicile-test-client: {err}");
        std::process::exit(1);
    }
}

impl Dispatch<wl_registry::WlRegistry, ()> for Client {
    fn event(
        client: &mut Client,
        registry: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        (): &(),
        _: &Connection,
        handle: &QueueHandle<Client>,
    ) {
        match event {
            wl_registry::Event::Global {
                name,
                interface,
                version,
            } => {
                crate::say!(
                    registry.id(),
                    "global({}, \"{}\", {})",
                    name,
                    interface,
                    version
                );
                // Outputs are bound here rather than with the rest, because
                // they are the one global that arrives after startup: plugging
                // a display in announces a new one, and a compositor cannot
                // tell a client its window is on a screen the client never
                // bound. A window open across that change would go on being
                // told about the screen it started on and no other.
                //
                // Safe to do from the event, unlike `wl_seat`, because an
                // output's version comes with its announcement rather than
                // having to be weighed against the rest of the list.
                // Version 4 rather than 2 for `wl_output.name`, which is the
                // only place a client learns what a screen is *called*. Every
                // other field — where it sits, its scale, its mode — arrives
                // at 2, so a check that only wants geometry never needed this.
                // `both_configured_displays_are_advertised_to_a_client` does:
                // it asserts a client is told `left` and `right`, and the
                // fixture will not describe a screen it has no name for.
                //
                // Capped, not demanded: a compositor advertising less still
                // binds at what it offers, and the extra events are additive,
                // so a client reading the older ones is unaffected.
                if interface == "wl_output" {
                    let output: wl_output::WlOutput =
                        registry.bind(name, version.min(4), handle, ());
                    client.outputs.push((name, output.id()));
                }
                client.globals.named.push((name, interface, version));
            }
            wl_registry::Event::GlobalRemove { name } => {
                // A screen that went away. The compositor sends no
                // `wl_surface.leave` for one, so without this the client would
                // sit at a dead screen's density for the rest of the run —
                // and `scales`, `entered` and `outputs` would grow with the
                // desktop's history rather than its shape.
                client.globals.named.retain(|(named, _, _)| named != &name);
                let Some(at) = client.outputs.iter().position(|(named, _)| named == &name) else {
                    return;
                };
                let (_, gone) = client.outputs.remove(at);
                client.scales.retain(|(id, _)| id != &gone);
                client.entered.retain(|id| id != &gone);
                follow_or_stop(client, handle);
            }
            _ => {}
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
        // exiting is how a check sees that it did:
        // `a_close_from_the_chrome_reaches_the_client_and_comes_back`
        // (`domicile-compositor/tests/apps.rs`) waits for this process to go.
        // Zero is the only success this binary has, which is what lets that
        // wait mean "the close arrived and was acted on" rather than "the
        // client stopped for some reason".
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
        buffer: &wl_buffer::WlBuffer,
        event: wl_buffer::Event,
        index: &usize,
        _: &Connection,
        _: &QueueHandle<Client>,
    ) {
        // The compositor is done reading this one, so the next frame may draw
        // into it. Without this the client runs out of buffers after two
        // frames and never draws again.
        if let wl_buffer::Event::Release = event {
            crate::say!(buffer.id(), "release()");
            let window = client
                .window
                .as_mut()
                .expect("a buffer was cut from this window's pool");
            // Checked, not assumed. `index` is baked into the udata of the
            // buffer this event is *about*, which after a rescale may be one
            // from the pool before it: `follow` destroys those, but a release
            // the compositor had already sent still arrives afterwards.
            // Clearing on the index alone then marks a live buffer free while
            // the compositor is displaying it, and the next frame draws over
            // the picture.
            //
            // Measured rather than reasoned about, and destroying the old
            // buffers is not enough on its own: with `destroy` in place and
            // this check absent, forcing a rescale produced one such release
            // per rescale, every one naming a buffer that is not the one in
            // that slot. (How many depends on how hard the rescale is
            // driven — it is one per swap with a buffer in flight, not a
            // fixed number.)
            //
            // Latent rather than visible today: this compositor imports and
            // releases before the next attach lands, so the slot being
            // wrongly cleared is already `false`. Against one that holds a
            // buffer across the swap it is a live buffer marked free.
            //
            // Comparing ids and not wire numbers, which matters more than it
            // reads: `destroy` frees the numbers and a later pool takes them
            // back — a `delete_id` round-trip later rather than at once, so it
            // is the pool after next that reuses them, and it reuses them
            // *reversed*. That is the shape a wire-number comparison cannot
            // survive: a stale release naming `@17` would match the new
            // `buffers[0]` by number while being a different object.
            // `ObjectId` equality carries a generation (`id`, `serial` and
            // interface), so the stale one still compares unequal.
            if window.pixels.buffers[*index].id() == buffer.id() {
                window.pixels.held[*index] = false;
            }
        }
    }
}

impl Dispatch<wl_seat::WlSeat, ()> for Client {
    fn event(
        client: &mut Client,
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
                let pointer = seat.get_pointer(handle, ());
                // Made here rather than on the first `enter`: `set_shape` names
                // the pointer it applies to, so the device has to exist before
                // there is a serial to spend on it.
                client.cursor = client
                    .globals
                    .cursor
                    .as_ref()
                    .map(|manager| manager.get_pointer(&pointer, handle, ()));
            }
        }
    }
}

delegate_noop!(Client: ignore wl_compositor::WlCompositor);
delegate_noop!(Client: ignore wl_shm::WlShm);
delegate_noop!(Client: ignore wl_shm_pool::WlShmPool);
delegate_noop!(Client: ignore wp_cursor_shape_manager_v1::WpCursorShapeManagerV1);
delegate_noop!(Client: ignore wp_cursor_shape_device_v1::WpCursorShapeDeviceV1);

/// Which outputs the window is on.
///
/// Reported *and* acted on: this is what tells the client which screen's
/// density to draw for, so `follow` runs on every change. A compositor that
/// never sends these leaves a scale-aware client drawing 1x pixels forever,
/// and leaves the checks that ask which screen a window landed on with
/// nothing to read.
impl Dispatch<wl_surface::WlSurface, ()> for Client {
    fn event(
        client: &mut Client,
        surface: &wl_surface::WlSurface,
        event: wl_surface::Event,
        (): &(),
        _: &Connection,
        handle: &QueueHandle<Client>,
    ) {
        match event {
            wl_surface::Event::Enter { output } => {
                crate::say!(surface.id(), "enter({})", output.id());
                let on = output.id();
                if !client.entered.contains(&on) {
                    client.entered.push(on);
                }
            }
            wl_surface::Event::Leave { output } => {
                crate::say!(surface.id(), "leave({})", output.id());
                let off = output.id();
                client.entered.retain(|on| on != &off);
            }
            _ => return,
        }
        // Which screens the surface is on is half of what its density depends
        // on; the other half is what those screens said their scale was.
        follow_or_stop(client, handle);
    }
}

/// What each screen is, where it is, and how dense.
///
/// `geometry`'s x and y say which screen a window is on once
/// `wl_surface.enter` has named the output, which is what `screens_of` in
/// `e2e-one-window-per-display` reads. `mode` is the physical size a check
/// about density reads back. `scale` is the one this client acts on, and
/// `done` is when it acts: the events above it are one description delivered
/// in pieces, and redrawing on `scale` alone would redraw against half of
/// one.
impl Dispatch<wl_output::WlOutput, ()> for Client {
    fn event(
        client: &mut Client,
        output: &wl_output::WlOutput,
        event: wl_output::Event,
        (): &(),
        _: &Connection,
        handle: &QueueHandle<Client>,
    ) {
        match event {
            wl_output::Event::Geometry {
                x,
                y,
                physical_width,
                physical_height,
                subpixel,
                make,
                model,
                transform,
            } => {
                crate::say!(
                    output.id(),
                    "geometry({}, {}, {}, {}, {}, \"{}\", \"{}\", {})",
                    x,
                    y,
                    physical_width,
                    physical_height,
                    number(subpixel),
                    make,
                    model,
                    number(transform)
                );
            }
            wl_output::Event::Mode {
                flags,
                width,
                height,
                refresh,
            } => {
                crate::say!(
                    output.id(),
                    "mode({}, {}, {}, {})",
                    number(flags),
                    width,
                    height,
                    refresh
                );
            }
            wl_output::Event::Name { name } => {
                crate::say!(output.id(), "name(\"{}\")", name);
            }
            wl_output::Event::Scale { factor } => {
                crate::say!(output.id(), "scale({})", factor);
                let of = output.id();
                match client.scales.iter_mut().find(|(id, _)| id == &of) {
                    Some((_, scale)) => *scale = factor,
                    None => client.scales.push((of, factor)),
                }
            }
            wl_output::Event::Done => {
                crate::say!(output.id(), "done()");
                // The event that says the batch above is complete, which is
                // when a client is meant to act on it. Acting on `scale`
                // directly would redraw against a half-applied description.
                follow_or_stop(client, handle);
            }
            _ => {}
        }
    }
}

/// Keys, as they arrive.
///
/// `modifiers` as well as `key`: a compositor that loses a key release leaves
/// a modifier held for good, and the count of one against the other is what
/// says so.
impl Dispatch<wl_keyboard::WlKeyboard, ()> for Client {
    fn event(
        _: &mut Client,
        keyboard: &wl_keyboard::WlKeyboard,
        event: wl_keyboard::Event,
        (): &(),
        _: &Connection,
        _: &QueueHandle<Client>,
    ) {
        match event {
            wl_keyboard::Event::Key {
                serial,
                time,
                key,
                state,
            } => {
                crate::say!(
                    keyboard.id(),
                    "key({}, {}, {}, {})",
                    serial,
                    time,
                    key,
                    number(state)
                );
            }
            wl_keyboard::Event::Modifiers {
                serial,
                mods_depressed,
                mods_latched,
                mods_locked,
                group,
            } => {
                crate::say!(
                    keyboard.id(),
                    "modifiers({}, {}, {}, {}, {})",
                    serial,
                    mods_depressed,
                    mods_latched,
                    mods_locked,
                    group
                );
            }
            _ => {}
        }
    }
}

/// The pointer, as far as a check needs it.
impl Dispatch<wl_pointer::WlPointer, ()> for Client {
    fn event(
        client: &mut Client,
        pointer: &wl_pointer::WlPointer,
        event: wl_pointer::Event,
        (): &(),
        _: &Connection,
        _: &QueueHandle<Client>,
    ) {
        match event {
            wl_pointer::Event::Enter {
                serial,
                surface,
                surface_x,
                surface_y,
            } => {
                crate::say!(
                    pointer.id(),
                    "enter({}, {}, {}, {})",
                    serial,
                    surface.id(),
                    surface_x,
                    surface_y
                );
                // What a real client does the moment the pointer arrives, and
                // the only way the compositor learns there is a cursor to tell
                // the chrome about.
                client
                    .cursor
                    .as_ref()
                    .expect("the pointer that entered is the one the device names")
                    .set_shape(serial, wp_cursor_shape_device_v1::Shape::Default);
            }
            wl_pointer::Event::Motion {
                time,
                surface_x,
                surface_y,
            } => {
                crate::say!(
                    pointer.id(),
                    "motion({}, {}, {})",
                    time,
                    surface_x,
                    surface_y
                );
            }
            wl_pointer::Event::Button {
                serial,
                time,
                button,
                state,
            } => {
                crate::say!(
                    pointer.id(),
                    "button({}, {}, {}, {})",
                    serial,
                    time,
                    button,
                    number(state)
                );
            }
            _ => {}
        }
    }
}

/// The number behind an enum argument.
///
/// libwayland prints the wire value, and the checks that read these lines
/// match on it. `WEnum` is either the value or the number a newer compositor
/// sent that this client's protocol copy has no name for — and the number is
/// what both cases have.
fn number<T: Into<u32>>(stated: WEnum<T>) -> u32 {
    match stated {
        WEnum::Value(known) => known.into(),
        WEnum::Unknown(raw) => raw,
    }
}
