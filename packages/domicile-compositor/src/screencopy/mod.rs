//! Wayland screen capture: `ext-image-copy-capture-v1` with
//! `ext-image-capture-source-v1` output sources, and `wlr-screencopy` (see
//! [`wlr`]) for tools that predate it.
//!
//! Each frame is one shot of a monitor from the display captures the
//! Screenshot portal uses ([`crate::casting::Casting::shoot_monitor`]), copied
//! into the client's shm buffer. No dmabufs, no toplevel sources and no
//! cursor: a cursor session's capture session stops at once. See
//! `docs/PORTALS.md`.

mod buffer;
mod frame;
mod wlr;

use std::sync::Mutex;

use domicile_host::screenshot::Shot;
use smithay::output::Output;
use smithay::reexports::wayland_protocols::ext::image_capture_source::v1::server::{
    ext_image_capture_source_v1::{self, ExtImageCaptureSourceV1},
    ext_output_image_capture_source_manager_v1::{self, ExtOutputImageCaptureSourceManagerV1},
};
use smithay::reexports::wayland_protocols::ext::image_copy_capture::v1::server::{
    ext_image_copy_capture_cursor_session_v1::{self, ExtImageCopyCaptureCursorSessionV1},
    ext_image_copy_capture_frame_v1::{self, ExtImageCopyCaptureFrameV1, FailureReason},
    ext_image_copy_capture_manager_v1::{self, ExtImageCopyCaptureManagerV1},
    ext_image_copy_capture_session_v1::{self, ExtImageCopyCaptureSessionV1},
};
use smithay::reexports::wayland_server::protocol::{wl_buffer::WlBuffer, wl_output};
use smithay::reexports::wayland_server::{
    backend::ClientId, Client, DataInit, Dispatch, DisplayHandle, GlobalDispatch, New, Resource,
    WEnum,
};
use smithay::wayland::shm::with_buffer_contents_mut;
use tracing::debug;

use crate::casting::Desk;
use crate::DomicileCompositor;
use frame::{Frame, Misuse};

/// Advertises the ext capture globals and `wlr-screencopy`.
pub fn advertise(display: &DisplayHandle) {
    display.create_global::<DomicileCompositor, ExtOutputImageCaptureSourceManagerV1, _>(1, ());
    display.create_global::<DomicileCompositor, ExtImageCopyCaptureManagerV1, _>(1, ());
    wlr::advertise(display);
}

/// A capture source: the `wl_output` name of the monitor it shows. `None`
/// for an output that was already gone.
pub struct Source(Option<String>);

/// A capture session of one monitor.
pub struct Session {
    /// The monitor's `wl_output` name. `None` for a session that shows
    /// nothing, which stops at once.
    monitor: Option<String>,
    state: Mutex<SessionState>,
}

struct SessionState {
    /// The buffer size last sent.
    size: (u32, u32),
    /// Whether a frame of this session is alive. The protocol allows one.
    framing: bool,
}

/// A frame of a session.
pub struct CaptureFrame {
    session: ExtImageCopyCaptureSessionV1,
    frame: Mutex<Frame<WlBuffer>>,
}

/// The name of the monitor `output` is, if it is still plugged in.
fn monitor_of(output: &wl_output::WlOutput) -> Option<String> {
    Output::from_resource(output).map(|output| output.name())
}

impl DomicileCompositor {
    /// Starts a session of `monitor`: sends its buffer constraints, or stops
    /// it if there is nothing to capture.
    fn open_session(
        &self,
        new: New<ExtImageCopyCaptureSessionV1>,
        monitor: Option<String>,
        data_init: &mut DataInit<'_, Self>,
    ) {
        let size = monitor
            .as_deref()
            .map(|name| self.casting.monitor_shot_size(name, None));
        let session = data_init.init(
            new,
            Session {
                monitor,
                state: Mutex::new(SessionState {
                    size: (0, 0),
                    framing: false,
                }),
            },
        );
        match size {
            Some(Ok(size)) => constrain(&session, size),
            Some(Err(why)) => {
                debug!(%why, "a capture session of a monitor with nothing to capture");
                session.stopped();
            }
            None => session.stopped(),
        }
    }

    /// Copies a shot of `frame`'s monitor into `buffer`, or fails the frame.
    fn capture(&self, frame: &ExtImageCopyCaptureFrameV1, data: &CaptureFrame, buffer: WlBuffer) {
        let session = data
            .session
            .data::<Session>()
            .expect("a frame's session is a session");
        let Some(monitor) = session.monitor.clone() else {
            frame.failed(FailureReason::Stopped);
            return;
        };
        let size = match self.casting.monitor_shot_size(&monitor, None) {
            Ok(size) => size,
            Err(why) => {
                debug!(%why, %monitor, "a captured monitor is gone");
                data.session.stopped();
                frame.failed(FailureReason::Stopped);
                return;
            }
        };
        if session.state.lock().unwrap().size != size {
            constrain(&data.session, size);
            frame.failed(FailureReason::BufferConstraints);
            return;
        }
        if !fits(&buffer, size) {
            frame.failed(FailureReason::BufferConstraints);
            return;
        }
        let frame = frame.clone();
        self.screen_copying.shoot_monitor(
            monitor,
            None,
            Box::new(move |desk| match copied(&buffer, desk) {
                Ok((width, height)) => {
                    let (seconds_high, seconds_low, nanoseconds) = now();
                    frame.transform(wl_output::Transform::Normal);
                    frame.damage(0, 0, width as i32, height as i32);
                    frame.presentation_time(seconds_high, seconds_low, nanoseconds);
                    frame.ready();
                }
                Err(why) => {
                    debug!(%why, "a capture frame could not be copied");
                    frame.failed(FailureReason::Unknown);
                }
            }),
        );
    }
}

/// Sends `session` a buffer size and the formats it takes.
fn constrain(session: &ExtImageCopyCaptureSessionV1, size: (u32, u32)) {
    session
        .data::<Session>()
        .expect("a session")
        .state
        .lock()
        .unwrap()
        .size = size;
    session.buffer_size(size.0, size.1);
    for format in buffer::FORMATS {
        session.shm_format(format);
    }
    session.done();
}

/// Whether `buffer` is a shm buffer that takes a shot `size` big.
fn fits(buffer: &WlBuffer, size: (u32, u32)) -> bool {
    // A dmabuf, or shm the compositor cannot write, takes no shot. A bad map
    // has already disconnected the client.
    matches!(
        with_buffer_contents_mut(buffer, |_, _, data| buffer::fits(&data, size)),
        Ok(true)
    )
}

/// Copies the shot in `desk` into `buffer`, and returns its size.
fn copied(buffer: &WlBuffer, desk: Result<Desk, String>) -> Result<(u32, u32), String> {
    let Shot {
        width,
        height,
        bgra,
    } = desk?.shot;
    with_buffer_contents_mut(buffer, |pointer, length, data| {
        if !buffer::fits(&data, (width, height)) {
            return Err("the monitor changed size during the capture".to_string());
        }
        // SAFETY: Smithay maps the pool `length` bytes long at `pointer`
        // while this closure runs, and nothing else touches it meanwhile.
        let pool = unsafe { std::slice::from_raw_parts_mut(pointer, length) };
        let offset = data.offset as usize;
        pool[offset..offset + bgra.len()].copy_from_slice(&bgra);
        Ok((width, height))
    })
    .map_err(|why| why.to_string())?
}

/// `CLOCK_MONOTONIC`, the presentation clock, as the protocols split it:
/// seconds' high and low halves, and nanoseconds.
fn now() -> (u32, u32, u32) {
    let mut now = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: a valid clock and a live timespec.
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut now) };
    let seconds = now.tv_sec as u64;
    ((seconds >> 32) as u32, seconds as u32, now.tv_nsec as u32)
}

impl GlobalDispatch<ExtOutputImageCaptureSourceManagerV1, ()> for DomicileCompositor {
    fn bind(
        _: &mut Self,
        _: &DisplayHandle,
        _: &Client,
        resource: New<ExtOutputImageCaptureSourceManagerV1>,
        _: &(),
        data_init: &mut DataInit<'_, Self>,
    ) {
        data_init.init(resource, ());
    }
}

impl Dispatch<ExtOutputImageCaptureSourceManagerV1, ()> for DomicileCompositor {
    fn request(
        _: &mut Self,
        _: &Client,
        _: &ExtOutputImageCaptureSourceManagerV1,
        request: ext_output_image_capture_source_manager_v1::Request,
        _: &(),
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let ext_output_image_capture_source_manager_v1::Request::CreateSource {
            source,
            output,
        } = request
        {
            data_init.init(source, Source(monitor_of(&output)));
        }
    }
}

impl Dispatch<ExtImageCaptureSourceV1, Source> for DomicileCompositor {
    fn request(
        _: &mut Self,
        _: &Client,
        _: &ExtImageCaptureSourceV1,
        _: ext_image_capture_source_v1::Request,
        _: &Source,
        _: &DisplayHandle,
        _: &mut DataInit<'_, Self>,
    ) {
    }
}

impl GlobalDispatch<ExtImageCopyCaptureManagerV1, ()> for DomicileCompositor {
    fn bind(
        _: &mut Self,
        _: &DisplayHandle,
        _: &Client,
        resource: New<ExtImageCopyCaptureManagerV1>,
        _: &(),
        data_init: &mut DataInit<'_, Self>,
    ) {
        data_init.init(resource, ());
    }
}

impl Dispatch<ExtImageCopyCaptureManagerV1, ()> for DomicileCompositor {
    fn request(
        state: &mut Self,
        _: &Client,
        manager: &ExtImageCopyCaptureManagerV1,
        request: ext_image_copy_capture_manager_v1::Request,
        _: &(),
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        match request {
            ext_image_copy_capture_manager_v1::Request::CreateSession {
                session,
                source,
                options,
            } => {
                if let WEnum::Unknown(options) = options {
                    manager.post_error(
                        ext_image_copy_capture_manager_v1::Error::InvalidOption,
                        format!("unknown capture options {options:#x}"),
                    );
                    return;
                }
                let monitor = source.data::<Source>().expect("a source").0.clone();
                state.open_session(session, monitor, data_init);
            }
            ext_image_copy_capture_manager_v1::Request::CreatePointerCursorSession {
                session,
                ..
            } => {
                data_init.init(session, ());
            }
            ext_image_copy_capture_manager_v1::Request::Destroy => {}
            _ => unreachable!("version 1 has no other requests"),
        }
    }
}

impl Dispatch<ExtImageCopyCaptureCursorSessionV1, ()> for DomicileCompositor {
    fn request(
        state: &mut Self,
        _: &Client,
        _: &ExtImageCopyCaptureCursorSessionV1,
        request: ext_image_copy_capture_cursor_session_v1::Request,
        _: &(),
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let ext_image_copy_capture_cursor_session_v1::Request::GetCaptureSession { session } =
            request
        {
            state.open_session(session, None, data_init);
        }
    }
}

impl Dispatch<ExtImageCopyCaptureSessionV1, Session> for DomicileCompositor {
    fn request(
        _: &mut Self,
        _: &Client,
        session: &ExtImageCopyCaptureSessionV1,
        request: ext_image_copy_capture_session_v1::Request,
        data: &Session,
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let ext_image_copy_capture_session_v1::Request::CreateFrame { frame } = request {
            let mut state = data.state.lock().unwrap();
            if state.framing {
                session.post_error(
                    ext_image_copy_capture_session_v1::Error::DuplicateFrame,
                    "a session has one frame at a time",
                );
                return;
            }
            state.framing = true;
            data_init.init(
                frame,
                CaptureFrame {
                    session: session.clone(),
                    frame: Mutex::new(Frame::new()),
                },
            );
        }
    }
}

impl Dispatch<ExtImageCopyCaptureFrameV1, CaptureFrame> for DomicileCompositor {
    fn request(
        state: &mut Self,
        _: &Client,
        frame: &ExtImageCopyCaptureFrameV1,
        request: ext_image_copy_capture_frame_v1::Request,
        data: &CaptureFrame,
        _: &DisplayHandle,
        _: &mut DataInit<'_, Self>,
    ) {
        let mut held = data.frame.lock().unwrap();
        let done = match request {
            ext_image_copy_capture_frame_v1::Request::AttachBuffer { buffer } => {
                held.attach(buffer).map(|()| None)
            }
            ext_image_copy_capture_frame_v1::Request::DamageBuffer {
                x,
                y,
                width,
                height,
            } => held.damage((x, y, width, height)).map(|()| None),
            ext_image_copy_capture_frame_v1::Request::Capture => held.capture().map(Some),
            ext_image_copy_capture_frame_v1::Request::Destroy => Ok(None),
            _ => unreachable!("version 1 has no other requests"),
        };
        drop(held);
        match done {
            Ok(Some(buffer)) => state.capture(frame, data, buffer),
            Ok(None) => {}
            Err(misuse) => {
                let (error, message) = match misuse {
                    Misuse::NoBuffer => (
                        ext_image_copy_capture_frame_v1::Error::NoBuffer,
                        "captured with no buffer attached",
                    ),
                    Misuse::InvalidBufferDamage => (
                        ext_image_copy_capture_frame_v1::Error::InvalidBufferDamage,
                        "damage must have a size and start inside the buffer",
                    ),
                    Misuse::AlreadyCaptured => (
                        ext_image_copy_capture_frame_v1::Error::AlreadyCaptured,
                        "the frame was already captured",
                    ),
                };
                frame.post_error(error, message);
            }
        }
    }

    fn destroyed(_: &mut Self, _: ClientId, _: &ExtImageCopyCaptureFrameV1, data: &CaptureFrame) {
        data.session
            .data::<Session>()
            .expect("a frame's session is a session")
            .state
            .lock()
            .unwrap()
            .framing = false;
    }
}
