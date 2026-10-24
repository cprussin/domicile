//! Wayland screen capture: `ext-image-copy-capture-v1` with
//! `ext-image-capture-source-v1` output sources, and `wlr-screencopy` (see
//! [`wlr`]) for tools that predate it.
//!
//! Each session is a cast of its monitor (see [`crate::casting`]), which
//! fills the client's shm or dmabuf buffers as it fills PipeWire's. A frame is
//! ready once the monitor has damage the client has not seen (see
//! [`taking`]). No toplevel sources and no cursor sessions: a cursor
//! session's capture session stops at once. See `docs/PORTALS.md`.

mod buffer;
mod frame;
mod taking;
mod wlr;

use std::collections::HashMap;
use std::os::fd::OwnedFd;
use std::sync::{Arc, Mutex};

use smithay::output::Output;
use smithay::reexports::calloop::generic::Generic;
use smithay::reexports::calloop::{Interest, Mode, PostAction};
use smithay::reexports::wayland_protocols::ext::image_capture_source::v1::server::{
    ext_image_capture_source_v1::{self, ExtImageCaptureSourceV1},
    ext_output_image_capture_source_manager_v1::{self, ExtOutputImageCaptureSourceManagerV1},
};
use smithay::reexports::wayland_protocols::ext::image_copy_capture::v1::server::{
    ext_image_copy_capture_cursor_session_v1::{self, ExtImageCopyCaptureCursorSessionV1},
    ext_image_copy_capture_frame_v1::{self, ExtImageCopyCaptureFrameV1, FailureReason},
    ext_image_copy_capture_manager_v1::{self, ExtImageCopyCaptureManagerV1, Options},
    ext_image_copy_capture_session_v1::{self, ExtImageCopyCaptureSessionV1},
};
use smithay::reexports::wayland_server::protocol::{wl_buffer::WlBuffer, wl_output};
use smithay::reexports::wayland_server::{
    backend::ClientId, Client, DataInit, Dispatch, DisplayHandle, GlobalDispatch, New, Resource,
    WEnum,
};
use smithay::wayland::dmabuf::get_dmabuf;
use smithay::wayland::shm::with_buffer_contents_mut;
use tracing::debug;

use crate::casting::memory::Mapping;
use crate::casting::{
    fourcc, BufferId, CursorMode, Rect, Source as CastSource, StreamId, Target, ToPipewire,
    ToWayland, MAX_FRAMERATE,
};
use crate::{CalloopData, DomicileCompositor};
use frame::{Frame, Misuse};
use taking::{Constraints, Layout, Lending, Taking};

/// Advertises the ext capture globals and `wlr-screencopy`.
pub fn advertise(display: &DisplayHandle) {
    display.create_global::<DomicileCompositor, ExtOutputImageCaptureSourceManagerV1, _>(1, ());
    display.create_global::<DomicileCompositor, ExtImageCopyCaptureManagerV1, _>(1, ());
    wlr::advertise(display);
}

/// Every cast a Wayland capture client takes, on the Wayland thread.
#[derive(Default)]
pub struct Copies {
    casts: HashMap<StreamId, Copy>,
    /// The cast a `wlr-screencopy` client's frames of one source share.
    wlr: HashMap<wlr::Key, StreamId>,
}

/// One client's cast.
struct Copy {
    taking: Taking<WlBuffer>,
    taker: Taker,
    /// The frame whose buffer the cast holds.
    capturing: Option<Taken>,
    /// Each shm buffer's copy in the compositor, which the cast fills and a
    /// ready frame is copied from.
    staged: HashMap<BufferId, Arc<Mapping>>,
}

/// Who takes a cast's frames.
enum Taker {
    Ext(ExtImageCopyCaptureSessionV1),
    Wlr(wlr::Shared),
    /// The client let go, and the cast is ending.
    Gone,
}

/// A frame being captured.
#[derive(Clone)]
enum Taken {
    Ext(ExtImageCopyCaptureFrameV1),
    /// `damage` for `copy_with_damage`.
    Wlr {
        frame: wlr::Frame,
        damage: bool,
    },
}

/// Why a frame's buffer was not lent to its cast.
enum Unlent {
    /// The cast has ended.
    Ended,
    /// The buffer is not one the client was told it may use.
    Unfit,
    Failed(String),
}

/// A capture source: the `wl_output` name of the monitor it shows. `None`
/// for an output that was already gone.
pub struct Source(Option<String>);

/// A capture session: the cast of its monitor. `None` for a session that
/// shows nothing, which stops at once.
pub struct Session {
    stream: Option<StreamId>,
    /// Whether a frame of this session is alive. The protocol allows one.
    framing: Mutex<bool>,
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
    /// A request for a client's cast, which this side answers in PipeWire's
    /// place.
    pub fn screen_copy_requested(&mut self, request: ToPipewire) {
        let stream = request.stream();
        match request {
            ToPipewire::Start { offered, size, .. } => {
                let device = self.render_device();
                if let Some(copy) = self.copies.casts.get_mut(&stream) {
                    let constraints = copy.taking.started(size, &offered);
                    copy.taker.constrain(&constraints, device);
                }
                self.cast_news(ToWayland::Filling { stream, on: true });
            }
            ToPipewire::Resize { size, .. } => {
                let device = self.render_device();
                let Some(copy) = self.copies.casts.get_mut(&stream) else {
                    return;
                };
                let (constraints, failed) = copy.taking.resized(size);
                copy.taker.constrain(&constraints, device);
                if failed {
                    if let Some(taken) = copy.capturing.take() {
                        taken.failed(FailureReason::BufferConstraints);
                    }
                }
            }
            ToPipewire::Filled {
                buffer,
                damage,
                fence,
                ..
            } => self.filled(stream, buffer, damage, fence),
            ToPipewire::Starved { .. } => {}
            ToPipewire::End { why, .. } => {
                if let Some(copy) = self.copies.casts.remove(&stream) {
                    debug!(?stream, ?why, "a Wayland capture client's cast ended");
                    if let Some(taken) = copy.capturing {
                        taken.failed(FailureReason::Stopped);
                    }
                    match copy.taker {
                        Taker::Ext(session) => session.stopped(),
                        Taker::Wlr(shared) => {
                            self.copies.wlr.remove(&shared.key);
                            shared.failed();
                        }
                        Taker::Gone => {}
                    }
                }
                self.cast_news(ToWayland::Ended { stream });
            }
        }
    }

    /// The node casts allocate dmabufs on, for clients to allocate on too.
    fn render_device(&self) -> Option<u64> {
        self.gpu.as_ref()?.importer.main_device()
    }

    /// Keeps `stream`, a client's cast, which `taker` takes.
    fn taken_by(&mut self, stream: StreamId, taker: Taker) {
        let checks_modifiers = matches!(taker, Taker::Ext(_));
        self.copies.casts.insert(
            stream,
            Copy {
                taking: Taking::new(checks_modifiers),
                taker,
                capturing: None,
                staged: HashMap::new(),
            },
        );
    }

    /// The client let go of `stream`'s cast.
    fn let_go(&mut self, stream: StreamId) {
        if let Some(copy) = self.copies.casts.get_mut(&stream) {
            copy.taker = Taker::Gone;
            copy.capturing = None;
            self.screen_copying.stop(stream);
        }
    }

    /// Lends `stream`'s cast `buffer` for `taken`.
    fn lend(&mut self, stream: StreamId, taken: Taken, buffer: WlBuffer) -> Result<(), Unlent> {
        let copy = self.copies.casts.get_mut(&stream).ok_or(Unlent::Ended)?;
        let layout = buffer::layout_of(&buffer).ok_or(Unlent::Unfit)?;
        let lending = copy
            .taking
            .capture(buffer.clone(), layout)
            .ok_or(Unlent::Unfit)?;
        let mut news = Vec::new();
        for lent in lending {
            match lent {
                Lending::Format(format) => {
                    copy.staged.clear();
                    news.push(ToWayland::Format {
                        stream,
                        format,
                        framerate: MAX_FRAMERATE,
                    });
                }
                Lending::Added(id) => {
                    let target = match layout {
                        Layout::Shm { size, .. } => {
                            let length = (buffer::stride(size.0) * size.1) as usize;
                            let mapping = Mapping::new(c"domicile-screencopy", length)
                                .map(Arc::new)
                                .map_err(|why| Unlent::Failed(why.to_string()))?;
                            copy.staged.insert(id, mapping.clone());
                            Target::Shm(mapping)
                        }
                        Layout::Dmabuf { .. } => Target::Dmabuf(
                            get_dmabuf(&buffer)
                                .expect("a dmabuf layout is a dmabuf's")
                                .clone(),
                        ),
                    };
                    news.push(ToWayland::Added {
                        stream,
                        buffer: id,
                        target,
                    });
                }
                Lending::Lent(id) => news.push(ToWayland::Lent { stream, buffer: id }),
            }
        }
        copy.capturing = Some(taken);
        for news in news {
            self.cast_news(news);
        }
        Ok(())
    }

    /// `taken` is gone before its frame was filled. The cast gives its
    /// buffer back.
    fn abandoned(&mut self, stream: StreamId, taken: &Taken) {
        let Some(copy) = self.copies.casts.get_mut(&stream) else {
            return;
        };
        if copy.capturing.as_ref() != Some(taken) {
            return;
        }
        copy.capturing = None;
        if let Some(buffer) = copy.taking.abandoned() {
            copy.staged.remove(&buffer);
            self.cast_news(ToWayland::Removed { stream, buffer });
        }
    }

    /// The cast filled `buffer`: once `fence` signals, the frame is ready.
    fn filled(
        &mut self,
        stream: StreamId,
        buffer: BufferId,
        damage: Vec<Rect>,
        fence: Option<OwnedFd>,
    ) {
        let Some(copy) = self.copies.casts.get_mut(&stream) else {
            return;
        };
        let Some(client_buffer) = copy.taking.filled(buffer) else {
            return;
        };
        let staged = copy.staged.get(&buffer).cloned();
        let Some(taken) = copy.capturing.take() else {
            return;
        };
        let ready = Ready {
            taken,
            buffer: client_buffer,
            staged,
            damage,
        };
        match fence {
            None => self.ready(stream, ready),
            Some(fence) => {
                let mut ready = Some(ready);
                self.loop_handle
                    .insert_source(
                        Generic::new(fence, Interest::READ, Mode::OneShot),
                        move |_, _, data: &mut CalloopData| {
                            if let Some(ready) = ready.take() {
                                data.state.ready(stream, ready);
                            }
                            Ok(PostAction::Remove)
                        },
                    )
                    .expect("the compositor's loop takes a fence");
            }
        }
    }

    /// Hands a filled frame to its client.
    fn ready(&mut self, stream: StreamId, ready: Ready) {
        let Ready {
            taken,
            buffer,
            staged,
            damage,
        } = ready;
        if let Some(staged) = staged {
            if let Err(why) = unstaged(&staged, &buffer) {
                debug!(%why, "a captured frame could not be copied");
                taken.failed(FailureReason::Unknown);
                return;
            }
        }
        let (seconds_high, seconds_low, nanoseconds) = now();
        match taken {
            Taken::Ext(frame) => {
                frame.transform(wl_output::Transform::Normal);
                for (x, y, width, height) in damage {
                    frame.damage(x, y, width, height);
                }
                frame.presentation_time(seconds_high, seconds_low, nanoseconds);
                frame.ready();
            }
            Taken::Wlr {
                frame,
                damage: with_damage,
            } => {
                frame.ready(
                    with_damage.then_some(damage.as_slice()),
                    (seconds_high, seconds_low, nanoseconds),
                );
                self.copied_for_wlr(stream);
            }
        }
    }
}

/// A filled frame on its way to its client.
struct Ready {
    taken: Taken,
    buffer: WlBuffer,
    /// The compositor's copy of an shm buffer, which the cast filled.
    staged: Option<Arc<Mapping>>,
    damage: Vec<Rect>,
}

impl Taker {
    /// Tells the client what it may capture into.
    fn constrain(&mut self, constraints: &Constraints, device: Option<u64>) {
        match self {
            Taker::Ext(session) => constrain(session, constraints, device),
            Taker::Wlr(shared) => shared.describe(constraints),
            Taker::Gone => {}
        }
    }
}

/// The same frame, whatever it asked for.
impl PartialEq for Taken {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Taken::Ext(one), Taken::Ext(other)) => one == other,
            (Taken::Wlr { frame: one, .. }, Taken::Wlr { frame: other, .. }) => one == other,
            _ => false,
        }
    }
}

impl Taken {
    fn failed(&self, reason: FailureReason) {
        match self {
            Taken::Ext(frame) => frame.failed(reason),
            Taken::Wlr { frame, .. } => frame.failed(),
        }
    }
}

/// Sends `session` what it may capture into.
fn constrain(
    session: &ExtImageCopyCaptureSessionV1,
    constraints: &Constraints,
    device: Option<u64>,
) {
    let (width, height) = constraints.size;
    session.buffer_size(width, height);
    for &pixel in &constraints.shm {
        session.shm_format(buffer::shm_format(pixel));
    }
    if let Some(device) = device.filter(|_| !constraints.dmabufs.is_empty()) {
        session.dmabuf_device(device.to_ne_bytes().to_vec());
        for (pixel, modifiers) in &constraints.dmabufs {
            let modifiers = modifiers.iter().flat_map(|modifier| modifier.to_ne_bytes());
            session.dmabuf_format(fourcc(*pixel), modifiers.collect());
        }
    }
    session.done();
}

/// Copies the frame in `staged` into the client's shm `buffer`.
fn unstaged(staged: &Mapping, buffer: &WlBuffer) -> Result<(), String> {
    with_buffer_contents_mut(buffer, |pointer, length, data| {
        let offset = data.offset as usize;
        if offset + staged.len() > length {
            return Err("the buffer's pool shrank".to_string());
        }
        // SAFETY: Smithay maps the pool `length` bytes long at `pointer`
        // while this closure runs, and nothing else touches it meanwhile.
        let pool = unsafe { std::slice::from_raw_parts_mut(pointer, length) };
        // SAFETY: the cast handed the buffer back, so nothing writes it.
        pool[offset..offset + staged.len()].copy_from_slice(unsafe { staged.bytes() });
        Ok(())
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

    fn can_view(client: Client, _: &()) -> bool {
        crate::clients::sees_privileged_globals(&client)
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

    fn can_view(client: Client, _: &()) -> bool {
        crate::clients::sees_privileged_globals(&client)
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
                let options = match options {
                    WEnum::Value(options) => options,
                    WEnum::Unknown(options) => {
                        manager.post_error(
                            ext_image_copy_capture_manager_v1::Error::InvalidOption,
                            format!("unknown capture options {options:#x}"),
                        );
                        return;
                    }
                };
                let Some(monitor) = source.data::<Source>().expect("a source").0.clone() else {
                    stopped_session(session, data_init);
                    return;
                };
                let cursor = if options.contains(Options::PaintCursors) {
                    CursorMode::Embedded
                } else {
                    CursorMode::Hidden
                };
                let stream = state
                    .screen_copying
                    .start_for_client(CastSource::Monitor(monitor), cursor);
                let session = data_init.init(
                    session,
                    Session {
                        stream: Some(stream),
                        framing: Mutex::new(false),
                    },
                );
                state.taken_by(stream, Taker::Ext(session));
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

/// Makes `new` a session that shows nothing, and stops it.
fn stopped_session(
    new: New<ExtImageCopyCaptureSessionV1>,
    data_init: &mut DataInit<'_, DomicileCompositor>,
) {
    data_init
        .init(
            new,
            Session {
                stream: None,
                framing: Mutex::new(false),
            },
        )
        .stopped();
}

impl Dispatch<ExtImageCopyCaptureCursorSessionV1, ()> for DomicileCompositor {
    fn request(
        _: &mut Self,
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
            stopped_session(session, data_init);
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
            let mut framing = data.framing.lock().unwrap();
            if *framing {
                session.post_error(
                    ext_image_copy_capture_session_v1::Error::DuplicateFrame,
                    "a session has one frame at a time",
                );
                return;
            }
            *framing = true;
            data_init.init(
                frame,
                CaptureFrame {
                    session: session.clone(),
                    frame: Mutex::new(Frame::new()),
                },
            );
        }
    }

    fn destroyed(state: &mut Self, _: ClientId, _: &ExtImageCopyCaptureSessionV1, data: &Session) {
        if let Some(stream) = data.stream {
            state.let_go(stream);
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
            Ok(Some(buffer)) => {
                let Some(stream) = data.session.data::<Session>().expect("a session").stream else {
                    frame.failed(FailureReason::Stopped);
                    return;
                };
                match state.lend(stream, Taken::Ext(frame.clone()), buffer) {
                    Ok(()) => {}
                    Err(Unlent::Ended) => frame.failed(FailureReason::Stopped),
                    Err(Unlent::Unfit) => frame.failed(FailureReason::BufferConstraints),
                    Err(Unlent::Failed(why)) => {
                        debug!(%why, "a capture frame could not be lent");
                        frame.failed(FailureReason::Unknown);
                    }
                }
            }
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

    fn destroyed(
        state: &mut Self,
        _: ClientId,
        frame: &ExtImageCopyCaptureFrameV1,
        data: &CaptureFrame,
    ) {
        let session = data
            .session
            .data::<Session>()
            .expect("a frame's session is a session");
        *session.framing.lock().unwrap() = false;
        if let Some(stream) = session.stream {
            state.abandoned(stream, &Taken::Ext(frame.clone()));
        }
    }
}
