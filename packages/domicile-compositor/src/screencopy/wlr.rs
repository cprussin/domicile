//! `zwlr_screencopy_manager_v1`, version 3: a monitor or a region of it.
//!
//! The protocol has no session: each frame is its own object. A client's
//! frames of one source share one cast (see [`super::Copies`]), which stops
//! once the client has copied nothing for [`IDLE`]. `copy` fills the buffer at
//! once; `copy_with_damage` waits for damage the client has not seen, as an
//! ext frame does. A frame sends only the events of the version its manager
//! was bound at: one `buffer` before version 3, no `linux_dmabuf` before 3,
//! and no `flags` before 2.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use smithay::reexports::calloop::timer::{TimeoutAction, Timer};
use smithay::reexports::wayland_protocols_wlr::screencopy::v1::server::{
    zwlr_screencopy_frame_v1::{self, ZwlrScreencopyFrameV1},
    zwlr_screencopy_manager_v1::{self, ZwlrScreencopyManagerV1},
};
use smithay::reexports::wayland_server::protocol::{wl_buffer::WlBuffer, wl_output::WlOutput};
use smithay::reexports::wayland_server::{
    backend::ClientId, Client, DataInit, Dispatch, DisplayHandle, GlobalDispatch, New, Resource,
};
use tracing::debug;

use super::taking::Constraints;
use super::{buffer, monitor_of, Taken, Taker, Unlent};
use crate::casting::{fourcc, CursorMode, Rect, Region, Source, StreamId, ToWayland};
use crate::{CalloopData, DomicileCompositor};

/// How long a client's cast outlives its last copy.
const IDLE: Duration = Duration::from_secs(2);

/// Advertises the manager.
pub fn advertise(display: &DisplayHandle) {
    display.create_global::<DomicileCompositor, ZwlrScreencopyManagerV1, _>(3, ());
}

/// What a client's frames share a cast by: the client, the monitor, the
/// region of it and whether the pointer is drawn.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Key {
    client: ClientId,
    monitor: String,
    region: Option<Region>,
    cursor: bool,
}

/// A cast a client's frames share.
pub struct Shared {
    pub key: Key,
    /// Frames made before the cast started, which wait to be told their
    /// buffers.
    waiting: Vec<Frame>,
    last_copied: Instant,
    /// Whether the idle timer runs.
    timing: bool,
}

/// A frame, or of nothing: a frame whose monitor is gone fails as it is
/// made.
pub struct CopyFrame {
    stream: Option<StreamId>,
    /// Whether the frame has been copied. A frame copies once.
    used: AtomicBool,
}

/// A frame of a client's cast.
#[derive(Clone, PartialEq)]
pub struct Frame(ZwlrScreencopyFrameV1);

impl Frame {
    /// Tells the frame the buffers it may copy into.
    fn describe(&self, constraints: &Constraints) {
        let frame = &self.0;
        let (width, height) = constraints.size;
        let stride = buffer::stride(width);
        if frame.version() < 3 {
            if let Some(&pixel) = constraints.shm.first() {
                frame.buffer(buffer::shm_format(pixel), width, height, stride);
            }
            return;
        }
        for &pixel in &constraints.shm {
            frame.buffer(buffer::shm_format(pixel), width, height, stride);
        }
        for (pixel, _) in &constraints.dmabufs {
            frame.linux_dmabuf(fourcc(*pixel), width, height);
        }
        frame.buffer_done();
    }

    /// The frame is copied, damaged in `damage` if it asked for damage.
    pub fn ready(&self, damage: Option<&[Rect]>, (high, low, nanoseconds): (u32, u32, u32)) {
        let frame = &self.0;
        if frame.version() >= 2 {
            frame.flags(zwlr_screencopy_frame_v1::Flags::empty());
        }
        for &(x, y, width, height) in damage.unwrap_or_default() {
            frame.damage(x as u32, y as u32, width as u32, height as u32);
        }
        frame.ready(high, low, nanoseconds);
    }

    pub fn failed(&self) {
        self.0.failed();
    }
}

impl Shared {
    /// Tells every waiting frame its buffers.
    pub fn describe(&mut self, constraints: &Constraints) {
        for frame in self.waiting.drain(..) {
            frame.describe(constraints);
        }
    }

    /// The cast ended: every waiting frame fails.
    pub fn failed(self) {
        for frame in self.waiting {
            frame.failed();
        }
    }
}

impl DomicileCompositor {
    /// Makes a frame of `region` of `output`, or all of it, and offers its
    /// buffers once its cast has started.
    fn frame(
        &mut self,
        client: &Client,
        new: New<ZwlrScreencopyFrameV1>,
        output: &WlOutput,
        region: Option<Region>,
        cursor: bool,
        data_init: &mut DataInit<'_, Self>,
    ) {
        let stream = monitor_of(output)
            .ok_or_else(|| "the output is gone".to_string())
            .and_then(|monitor| self.wlr_stream(client.id(), monitor, region, cursor));
        let stream = match stream {
            Ok(stream) => stream,
            Err(why) => {
                debug!(%why, "a screencopy frame with nothing to copy");
                let frame = data_init.init(
                    new,
                    CopyFrame {
                        stream: None,
                        used: AtomicBool::new(false),
                    },
                );
                frame.failed();
                return;
            }
        };
        let frame = Frame(data_init.init(
            new,
            CopyFrame {
                stream: Some(stream),
                used: AtomicBool::new(false),
            },
        ));
        let copy = self
            .copies
            .casts
            .get_mut(&stream)
            .expect("a client's cast is kept until it ends");
        let Taker::Wlr(shared) = &mut copy.taker else {
            unreachable!("a wlr client's cast is taken by it");
        };
        match copy.taking.constraints() {
            Some(constraints) => frame.describe(constraints),
            None => shared.waiting.push(frame),
        }
    }

    /// The cast `client`'s frames of `region` of `monitor` share, started if
    /// none runs.
    fn wlr_stream(
        &mut self,
        client: ClientId,
        monitor: String,
        region: Option<Region>,
        cursor: bool,
    ) -> Result<StreamId, String> {
        let key = Key {
            client,
            monitor,
            region,
            cursor,
        };
        if let Some(&stream) = self.copies.wlr.get(&key) {
            return Ok(stream);
        }
        let source = match region {
            None => Source::Monitor(key.monitor.clone()),
            Some(region) => Source::Region(self.casting.monitor_region(&key.monitor, region)?),
        };
        let cursor = if cursor {
            CursorMode::Embedded
        } else {
            CursorMode::Hidden
        };
        let stream = self.screen_copying.start_for_client(source, cursor);
        self.copies.wlr.insert(key.clone(), stream);
        self.taken_by(
            stream,
            Taker::Wlr(Shared {
                key,
                waiting: Vec::new(),
                last_copied: Instant::now(),
                timing: false,
            }),
        );
        Ok(stream)
    }

    /// Copies what `frame` shows into `buffer`.
    fn copy(
        &mut self,
        frame: &ZwlrScreencopyFrameV1,
        data: &CopyFrame,
        buffer: WlBuffer,
        damage: bool,
    ) {
        // A frame that failed as it was made has told its client so.
        let Some(stream) = data.stream else {
            return;
        };
        if data.used.swap(true, Ordering::Relaxed) {
            frame.post_error(
                zwlr_screencopy_frame_v1::Error::AlreadyUsed,
                "the frame was already copied",
            );
            return;
        }
        let busy = self
            .copies
            .casts
            .get(&stream)
            .is_some_and(|copy| copy.capturing.is_some());
        if busy {
            debug!(?stream, "a screencopy frame came while another was copying");
            frame.failed();
            return;
        }
        let taken = Taken::Wlr {
            frame: Frame(frame.clone()),
            damage,
        };
        match self.lend(stream, taken, buffer) {
            Ok(()) if !damage => self.cast_news(ToWayland::Wanted { stream }),
            Ok(()) => {}
            Err(Unlent::Ended) => frame.failed(),
            Err(Unlent::Unfit) => frame.post_error(
                zwlr_screencopy_frame_v1::Error::InvalidBuffer,
                "the buffer is not one the frame offered",
            ),
            Err(Unlent::Failed(why)) => {
                debug!(%why, "a screencopy frame could not be lent");
                frame.failed();
            }
        }
    }

    /// A frame of `stream` was copied: the cast stops once none follows for
    /// [`IDLE`].
    pub(super) fn copied_for_wlr(&mut self, stream: StreamId) {
        let Some(Taker::Wlr(shared)) = self
            .copies
            .casts
            .get_mut(&stream)
            .map(|copy| &mut copy.taker)
        else {
            return;
        };
        shared.last_copied = Instant::now();
        if shared.timing {
            return;
        }
        shared.timing = true;
        self.loop_handle
            .insert_source(
                Timer::from_duration(IDLE),
                move |_, _, data: &mut CalloopData| data.state.wlr_idle(stream),
            )
            // Timers register nothing with the kernel, so inserting cannot
            // fail.
            .expect("the compositor's own loop takes a timer");
    }

    /// Stops `stream` if its client has copied nothing for [`IDLE`].
    fn wlr_idle(&mut self, stream: StreamId) -> TimeoutAction {
        let Some(copy) = self.copies.casts.get_mut(&stream) else {
            return TimeoutAction::Drop;
        };
        let Taker::Wlr(shared) = &mut copy.taker else {
            return TimeoutAction::Drop;
        };
        let idle = shared.last_copied.elapsed();
        if copy.capturing.is_some() || !shared.waiting.is_empty() || idle < IDLE {
            return TimeoutAction::ToDuration(IDLE.saturating_sub(idle).max(IDLE / 10));
        }
        self.copies.wlr.remove(&shared.key);
        self.let_go(stream);
        TimeoutAction::Drop
    }
}

impl GlobalDispatch<ZwlrScreencopyManagerV1, ()> for DomicileCompositor {
    fn bind(
        _: &mut Self,
        _: &DisplayHandle,
        _: &Client,
        resource: New<ZwlrScreencopyManagerV1>,
        _: &(),
        data_init: &mut DataInit<'_, Self>,
    ) {
        data_init.init(resource, ());
    }

    fn can_view(client: Client, _: &()) -> bool {
        crate::clients::sees_privileged_globals(&client)
    }
}

impl Dispatch<ZwlrScreencopyManagerV1, ()> for DomicileCompositor {
    fn request(
        state: &mut Self,
        client: &Client,
        _: &ZwlrScreencopyManagerV1,
        request: zwlr_screencopy_manager_v1::Request,
        _: &(),
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        match request {
            zwlr_screencopy_manager_v1::Request::CaptureOutput {
                frame,
                overlay_cursor,
                output,
            } => {
                state.frame(client, frame, &output, None, overlay_cursor != 0, data_init);
            }
            zwlr_screencopy_manager_v1::Request::CaptureOutputRegion {
                frame,
                overlay_cursor,
                output,
                x,
                y,
                width,
                height,
            } => {
                let region = Region {
                    position: (x, y),
                    size: (width, height),
                };
                state.frame(
                    client,
                    frame,
                    &output,
                    Some(region),
                    overlay_cursor != 0,
                    data_init,
                );
            }
            zwlr_screencopy_manager_v1::Request::Destroy => {}
            _ => unreachable!("version 3 has no other requests"),
        }
    }
}

impl Dispatch<ZwlrScreencopyFrameV1, CopyFrame> for DomicileCompositor {
    fn request(
        state: &mut Self,
        _: &Client,
        frame: &ZwlrScreencopyFrameV1,
        request: zwlr_screencopy_frame_v1::Request,
        data: &CopyFrame,
        _: &DisplayHandle,
        _: &mut DataInit<'_, Self>,
    ) {
        match request {
            zwlr_screencopy_frame_v1::Request::Copy { buffer } => {
                state.copy(frame, data, buffer, false);
            }
            zwlr_screencopy_frame_v1::Request::CopyWithDamage { buffer } => {
                state.copy(frame, data, buffer, true);
            }
            zwlr_screencopy_frame_v1::Request::Destroy => {}
            _ => unreachable!("version 3 has no other requests"),
        }
    }

    fn destroyed(state: &mut Self, _: ClientId, frame: &ZwlrScreencopyFrameV1, data: &CopyFrame) {
        let Some(stream) = data.stream else {
            return;
        };
        let frame = Frame(frame.clone());
        if let Some(Taker::Wlr(shared)) = state
            .copies
            .casts
            .get_mut(&stream)
            .map(|copy| &mut copy.taker)
        {
            shared.waiting.retain(|waiting| *waiting != frame);
        }
        state.abandoned(
            stream,
            &Taken::Wlr {
                frame,
                damage: false,
            },
        );
    }
}
