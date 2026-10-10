//! Wayland capture tools copy a monitor from the same display captures as the
//! Screenshot portal.
//!
//! No engine runs, so `DOMICILE_CAST_TEST_PATTERN` stands in for its display
//! captures: every pixel is one color. `grim` copies through
//! `ext-image-copy-capture-v1` from 1.5 and `zwlr_screencopy_manager_v1`
//! before it, so the client here checks both protocols itself.

mod running;

use std::fs::File;
use std::os::fd::{AsFd as _, FromRawFd as _, OwnedFd};
use std::os::unix::fs::FileExt as _;
use std::os::unix::net::UnixStream;
use std::process::Stdio;

use wayland_client::protocol::{wl_buffer, wl_output, wl_registry, wl_shm, wl_shm_pool};
use wayland_client::{Connection, Dispatch, EventQueue, QueueHandle, WEnum};
use wayland_protocols::ext::image_capture_source::v1::client::{
    ext_image_capture_source_v1::ExtImageCaptureSourceV1,
    ext_output_image_capture_source_manager_v1::ExtOutputImageCaptureSourceManagerV1,
};
use wayland_protocols::ext::image_copy_capture::v1::client::{
    ext_image_copy_capture_frame_v1::{self, ExtImageCopyCaptureFrameV1, FailureReason},
    ext_image_copy_capture_manager_v1::{ExtImageCopyCaptureManagerV1, Options},
    ext_image_copy_capture_session_v1::{self, ExtImageCopyCaptureSessionV1},
};
use wayland_protocols_wlr::screencopy::v1::client::{
    zwlr_screencopy_frame_v1::{self, ZwlrScreencopyFrameV1},
    zwlr_screencopy_manager_v1::ZwlrScreencopyManagerV1,
};

use crate::running::Compositor;

/// One 320x240 monitor at twice the density.
const DENSE_DISPLAY: &str = r#"
{ "output": { "displays": [{ "name": "only", "size": [320, 240], "scale": 2 }] } }
"#;

/// The test pattern's color, as red, green and blue.
const PATTERN: [u8; 3] = [96, 64, 32];

fn started() -> Compositor {
    Compositor::started_with_env(DENSE_DISPLAY, None, &[("DOMICILE_CAST_TEST_PATTERN", "1")])
}

/// `grim` saves the monitor at its density, in the display capture's pixels.
#[test]
fn grim_saves_the_monitor_from_the_display_capture() {
    let compositor = started();

    let grim = compositor
        .command("grim")
        .arg("-")
        // The protocol trace, for when it fails.
        .env("WAYLAND_DEBUG", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("grim starts; it is in `nix develop .#full`");
    let trace = uncolored(&String::from_utf8_lossy(&grim.stderr));
    assert!(
        grim.status.success(),
        "grim failed; it said:\n{trace}\nThe compositor said:\n{}",
        compositor.complaint()
    );

    let decoder = png::Decoder::new(std::io::Cursor::new(grim.stdout));
    let mut reader = decoder.read_info().expect("grim wrote a PNG");
    let mut pixels = vec![0; reader.output_buffer_size().expect("a size")];
    let info = reader.next_frame(&mut pixels).expect("the PNG decodes");
    assert_eq!((info.width, info.height), (640, 480));
    let channels = info.line_size / info.width as usize;
    let center = (240 * info.width as usize + 320) * channels;
    assert_eq!(pixels[center..center + 3], PATTERN);
}

/// A `zwlr_screencopy_manager_v1` client copies a region of the monitor, cut
/// at its edge, at the monitor's density.
#[test]
fn a_wlr_screencopy_client_copies_a_region_of_the_monitor() {
    let compositor = started();
    let (mut queue, mut copier) = connected(&compositor, 3);
    let handle = queue.handle();

    let manager = copier.wlr.clone().expect("zwlr_screencopy_manager_v1");
    // Logical pixels: 300..320 across and 200..240 down, past the edge.
    manager.capture_output_region(0, copier.output(), 300, 200, 50, 100, &handle, ());
    while !copier.described {
        queue
            .blocking_dispatch(&mut copier)
            .expect("the frame described");
    }
    let (width, height, stride) = *copier.offers.first().expect("an shm buffer offered");
    assert_eq!((width, height), (40, 80), "20x40 logical pixels at 2x");
    assert_eq!(stride, width * 4);
    let (buffer, memory) = copier.buffer((width, height), &handle);
    copier
        .wlr_frame
        .clone()
        .expect("the frame")
        .copy_with_damage(&buffer);

    assert_eq!(
        copier.outcome(&mut queue),
        Outcome::Ready,
        "the compositor said:\n{}",
        compositor.complaint()
    );
    assert_eq!(copier.damage, Some((0, 0, 40, 80)));
    assert_eq!(center(&memory, (width, height)), PATTERN);
}

/// A client bound before version 3 is offered one buffer, with no
/// `buffer_done`, and copies into it. One bound at version 1 gets no `flags`.
/// `grim` 1.4 binds version 1.
#[test]
fn a_wlr_screencopy_client_before_version_3_is_offered_one_buffer() {
    let compositor = started();
    for version in [1, 2] {
        let (mut queue, mut copier) = connected(&compositor, version);
        let handle = queue.handle();

        let manager = copier.wlr.clone().expect("zwlr_screencopy_manager_v1");
        manager.capture_output(0, copier.output(), &handle, ());
        queue.roundtrip(&mut copier).expect("the frame described");
        assert_eq!(
            copier.offers,
            [(640, 480, 640 * 4)],
            "version {version} is offered one buffer"
        );
        assert!(!copier.described, "version {version} has no buffer_done");
        let (buffer, memory) = copier.buffer((640, 480), &handle);
        let frame = copier.wlr_frame.clone().expect("the frame");
        if version == 1 {
            frame.copy(&buffer);
        } else {
            frame.copy_with_damage(&buffer);
        }

        assert_eq!(
            copier.outcome(&mut queue),
            Outcome::Ready,
            "version {version}; the compositor said:\n{}",
            compositor.complaint()
        );
        assert_eq!(center(&memory, (640, 480)), PATTERN);
        assert_eq!(copier.flagged, version >= 2, "version {version}'s flags");
    }
}

/// An ext capture copies into a buffer the session offered, and fails into
/// one it did not. After the monitor changes size, the session offers the new
/// size, and a buffer of the old one fails.
#[test]
fn an_ext_capture_session_offers_the_monitors_size_and_follows_it() {
    let compositor = started();
    let (mut queue, mut copier) = connected(&compositor, 3);
    let handle = queue.handle();
    let sources = copier.sources.clone().expect("the output source manager");
    let manager = copier
        .ext
        .clone()
        .expect("ext_image_copy_capture_manager_v1");
    let source = sources.create_source(copier.output(), &handle, ());
    let session = manager.create_session(&source, Options::empty(), &handle, ());
    while copier.sizes.is_empty() {
        queue
            .blocking_dispatch(&mut copier)
            .expect("the session's constraints");
    }
    assert_eq!(copier.sizes, [(640, 480)]);
    assert_eq!(
        copier.formats,
        [wl_shm::Format::Argb8888, wl_shm::Format::Xrgb8888]
    );

    let (small, _) = copier.buffer((320, 240), &handle);
    let frame = session.create_frame(&handle, ());
    frame.attach_buffer(&small);
    frame.capture();
    assert_eq!(
        copier.outcome(&mut queue),
        Outcome::Failed(FailureReason::BufferConstraints)
    );
    frame.destroy();

    let (fitting, memory) = copier.buffer((640, 480), &handle);
    let frame = session.create_frame(&handle, ());
    frame.attach_buffer(&fitting);
    frame.capture();
    assert_eq!(
        copier.outcome(&mut queue),
        Outcome::Ready,
        "the compositor said:\n{}",
        compositor.complaint()
    );
    assert_eq!(center(&memory, (640, 480)), PATTERN);
    frame.destroy();

    compositor.reconfigure(&DENSE_DISPLAY.replace("[320, 240]", "[400, 300]"));
    while copier.mode != Some((800, 600)) {
        queue.blocking_dispatch(&mut copier).expect("the new mode");
    }
    let frame = session.create_frame(&handle, ());
    frame.attach_buffer(&fitting);
    frame.capture();
    assert_eq!(
        copier.outcome(&mut queue),
        Outcome::Failed(FailureReason::BufferConstraints)
    );
    assert_eq!(copier.sizes, [(640, 480), (800, 600)]);
}

/// How a copy ended.
#[derive(Debug, PartialEq)]
enum Outcome {
    Ready,
    Failed(FailureReason),
}

/// A client's globals and what its capture objects were told.
#[derive(Default)]
struct Copier {
    wlr: Option<ZwlrScreencopyManagerV1>,
    ext: Option<ExtImageCopyCaptureManagerV1>,
    sources: Option<ExtOutputImageCaptureSourceManagerV1>,
    output: Option<wl_output::WlOutput>,
    shm: Option<wl_shm::WlShm>,
    /// The output's current mode, in pixels.
    mode: Option<(i32, i32)>,
    /// The `zwlr_screencopy_manager_v1` version to bind.
    wlr_version: u32,
    wlr_frame: Option<ZwlrScreencopyFrameV1>,
    /// Each shm buffer the wlr frame offered: width, height and stride.
    offers: Vec<(u32, u32, u32)>,
    described: bool,
    /// Whether the wlr frame sent `flags`.
    flagged: bool,
    damage: Option<(u32, u32, u32, u32)>,
    /// Each buffer size an ext session offered, in order.
    sizes: Vec<(u32, u32)>,
    formats: Vec<wl_shm::Format>,
    outcome: Option<Outcome>,
}

/// A client of `compositor`'s apps' display, with its globals bound, at
/// `wlr_version` for `zwlr_screencopy_manager_v1`, and its output described.
fn connected(compositor: &Compositor, wlr_version: u32) -> (EventQueue<Copier>, Copier) {
    let socket = UnixStream::connect(compositor.scratch_file(compositor.wayland_display()))
        .expect("the apps' display takes a connection");
    let connection = Connection::from_socket(socket).expect("a Wayland connection");
    let mut queue = connection.new_event_queue();
    connection.display().get_registry(&queue.handle(), ());
    let mut copier = Copier {
        wlr_version,
        ..Copier::default()
    };
    queue.roundtrip(&mut copier).expect("globals listed");
    queue.roundtrip(&mut copier).expect("the output described");
    (queue, copier)
}

impl Copier {
    fn output(&self) -> &wl_output::WlOutput {
        self.output.as_ref().expect("a wl_output")
    }

    /// An `argb8888` shm buffer of `size`, and its memory.
    fn buffer(
        &self,
        size: (u32, u32),
        handle: &QueueHandle<Self>,
    ) -> (wl_buffer::WlBuffer, OwnedFd) {
        let (width, height) = (size.0 as i32, size.1 as i32);
        let length = width * 4 * height;
        let memory = memory(length as u64);
        let pool =
            self.shm
                .as_ref()
                .expect("wl_shm")
                .create_pool(memory.as_fd(), length, handle, ());
        let buffer = pool.create_buffer(
            0,
            width,
            height,
            width * 4,
            wl_shm::Format::Argb8888,
            handle,
            (),
        );
        pool.destroy();
        (buffer, memory)
    }

    /// How the pending copy ends, waiting for it.
    fn outcome(&mut self, queue: &mut EventQueue<Self>) -> Outcome {
        while self.outcome.is_none() {
            queue.blocking_dispatch(self).expect("the copy ended");
        }
        self.outcome.take().expect("checked above")
    }
}

/// The red, green and blue of the center pixel of an `argb8888` buffer of
/// `size` in `memory`.
fn center(memory: &OwnedFd, size: (u32, u32)) -> [u8; 3] {
    let (width, height) = size;
    let mut pixel = [0; 4];
    File::from(memory.try_clone().expect("a duplicate"))
        .read_exact_at(&mut pixel, u64::from((height / 2 * width + width / 2) * 4))
        .expect("the copied pixels read back");
    let [blue, green, red, _] = pixel;
    [red, green, blue]
}

impl Dispatch<wl_registry::WlRegistry, ()> for Copier {
    fn event(
        copier: &mut Self,
        registry: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        handle: &QueueHandle<Self>,
    ) {
        if let wl_registry::Event::Global {
            name, interface, ..
        } = event
        {
            match interface.as_str() {
                "zwlr_screencopy_manager_v1" => {
                    copier.wlr = Some(registry.bind(name, copier.wlr_version, handle, ()));
                }
                "ext_image_copy_capture_manager_v1" => {
                    copier.ext = Some(registry.bind(name, 1, handle, ()));
                }
                "ext_output_image_capture_source_manager_v1" => {
                    copier.sources = Some(registry.bind(name, 1, handle, ()));
                }
                "wl_output" => copier.output = Some(registry.bind(name, 4, handle, ())),
                "wl_shm" => copier.shm = Some(registry.bind(name, 1, handle, ())),
                _ => {}
            }
        }
    }
}

impl Dispatch<wl_output::WlOutput, ()> for Copier {
    fn event(
        copier: &mut Self,
        _: &wl_output::WlOutput,
        event: wl_output::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let wl_output::Event::Mode { width, height, .. } = event {
            copier.mode = Some((width, height));
        }
    }
}

impl Dispatch<ZwlrScreencopyFrameV1, ()> for Copier {
    fn event(
        copier: &mut Self,
        frame: &ZwlrScreencopyFrameV1,
        event: zwlr_screencopy_frame_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        copier.wlr_frame = Some(frame.clone());
        match event {
            zwlr_screencopy_frame_v1::Event::Buffer {
                width,
                height,
                stride,
                ..
            } => copier.offers.push((width, height, stride)),
            zwlr_screencopy_frame_v1::Event::BufferDone => copier.described = true,
            zwlr_screencopy_frame_v1::Event::Flags { .. } => copier.flagged = true,
            zwlr_screencopy_frame_v1::Event::Damage {
                x,
                y,
                width,
                height,
            } => copier.damage = Some((x, y, width, height)),
            zwlr_screencopy_frame_v1::Event::Ready { .. } => copier.outcome = Some(Outcome::Ready),
            zwlr_screencopy_frame_v1::Event::Failed => {
                copier.outcome = Some(Outcome::Failed(FailureReason::Unknown));
            }
            _ => {}
        }
    }
}

impl Dispatch<ExtImageCopyCaptureSessionV1, ()> for Copier {
    fn event(
        copier: &mut Self,
        _: &ExtImageCopyCaptureSessionV1,
        event: ext_image_copy_capture_session_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            ext_image_copy_capture_session_v1::Event::BufferSize { width, height } => {
                copier.sizes.push((width, height));
                copier.formats.clear();
            }
            ext_image_copy_capture_session_v1::Event::ShmFormat {
                format: WEnum::Value(format),
            } => copier.formats.push(format),
            _ => {}
        }
    }
}

impl Dispatch<ExtImageCopyCaptureFrameV1, ()> for Copier {
    fn event(
        copier: &mut Self,
        _: &ExtImageCopyCaptureFrameV1,
        event: ext_image_copy_capture_frame_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            ext_image_copy_capture_frame_v1::Event::Ready => copier.outcome = Some(Outcome::Ready),
            ext_image_copy_capture_frame_v1::Event::Failed {
                reason: WEnum::Value(reason),
            } => copier.outcome = Some(Outcome::Failed(reason)),
            _ => {}
        }
    }
}

/// Objects that send this test nothing it reads.
macro_rules! ignored {
    ($($interface:ty),*) => {
        $(impl Dispatch<$interface, ()> for Copier {
            fn event(
                _: &mut Self,
                _: &$interface,
                _: <$interface as wayland_client::Proxy>::Event,
                _: &(),
                _: &Connection,
                _: &QueueHandle<Self>,
            ) {
            }
        })*
    };
}

ignored!(
    ZwlrScreencopyManagerV1,
    ExtImageCopyCaptureManagerV1,
    ExtOutputImageCaptureSourceManagerV1,
    ExtImageCaptureSourceV1,
    wl_shm::WlShm,
    wl_shm_pool::WlShmPool,
    wl_buffer::WlBuffer
);

/// Shared memory `length` bytes long.
fn memory(length: u64) -> OwnedFd {
    // SAFETY: a fresh memfd, owned here.
    let fd = unsafe { libc::memfd_create(c"screencopy".as_ptr(), 0) };
    assert!(fd >= 0, "a memfd");
    // SAFETY: `fd` is open and owned by nothing else.
    let fd = unsafe { OwnedFd::from_raw_fd(fd) };
    File::from(fd.try_clone().expect("a duplicate"))
        .set_len(length)
        .expect("sized");
    fd
}

/// `said` without its terminal color codes, which libwayland's trace has.
fn uncolored(said: &str) -> String {
    let mut plain = String::new();
    let mut characters = said.chars();
    while let Some(character) = characters.next() {
        if character == '\u{1b}' {
            characters.by_ref().find(|&ending| ending == 'm');
        } else {
            plain.push(character);
        }
    }
    plain
}
