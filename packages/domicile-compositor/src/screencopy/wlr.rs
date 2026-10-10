//! `zwlr_screencopy_manager_v1`, version 3: a monitor or a region of it,
//! copied once per frame into a shm buffer.
//!
//! `copy_with_damage` copies at once, as `copy` does, and reports the whole
//! buffer damaged. A frame sends only the events of the version its manager
//! was bound at: one `buffer` before version 3, and no `flags` before 2.

use std::sync::atomic::{AtomicBool, Ordering};

use smithay::reexports::wayland_protocols_wlr::screencopy::v1::server::{
    zwlr_screencopy_frame_v1::{self, ZwlrScreencopyFrameV1},
    zwlr_screencopy_manager_v1::{self, ZwlrScreencopyManagerV1},
};
use smithay::reexports::wayland_server::protocol::{wl_buffer::WlBuffer, wl_output::WlOutput};
use smithay::reexports::wayland_server::{
    Client, DataInit, Dispatch, DisplayHandle, GlobalDispatch, New, Resource,
};
use tracing::debug;

use super::{buffer, copied, fits, monitor_of, now};
use crate::casting::Region;
use crate::DomicileCompositor;

/// Advertises the manager.
pub fn advertise(display: &DisplayHandle) {
    display.create_global::<DomicileCompositor, ZwlrScreencopyManagerV1, _>(3, ());
}

/// A frame of a monitor, or of nothing: a frame whose monitor is gone fails
/// as it is made.
pub struct CopyFrame(Option<Copying>);

/// What a frame copies.
pub struct Copying {
    monitor: String,
    region: Option<Region>,
    size: (u32, u32),
    /// Whether the frame has been copied. A frame copies once.
    used: AtomicBool,
}

impl DomicileCompositor {
    /// Makes a frame of `region` of `output`, or all of it, and offers its
    /// buffers.
    fn frame(
        &self,
        new: New<ZwlrScreencopyFrameV1>,
        output: &WlOutput,
        region: Option<Region>,
        data_init: &mut DataInit<'_, Self>,
    ) {
        let copying = monitor_of(output)
            .ok_or_else(|| "the output is gone".to_string())
            .and_then(|monitor| {
                let size = self.casting.monitor_shot_size(&monitor, region)?;
                Ok(Copying {
                    monitor,
                    region,
                    size,
                    used: AtomicBool::new(false),
                })
            });
        match copying {
            Ok(copying) => {
                let (width, height) = copying.size;
                let frame = data_init.init(new, CopyFrame(Some(copying)));
                let stride = buffer::stride(width);
                if frame.version() >= 3 {
                    for format in buffer::FORMATS {
                        frame.buffer(format, width, height, stride);
                    }
                    frame.buffer_done();
                } else {
                    frame.buffer(buffer::FORMATS[0], width, height, stride);
                }
            }
            Err(why) => {
                debug!(%why, "a screencopy frame with nothing to copy");
                data_init.init(new, CopyFrame(None)).failed();
            }
        }
    }

    /// Copies a shot of what `frame` shows into `buffer`.
    fn copy(
        &self,
        frame: &ZwlrScreencopyFrameV1,
        data: &CopyFrame,
        buffer: WlBuffer,
        damage: bool,
    ) {
        // A frame that failed as it was made has told its client so.
        let Some(copying) = &data.0 else {
            return;
        };
        if copying.used.swap(true, Ordering::Relaxed) {
            frame.post_error(
                zwlr_screencopy_frame_v1::Error::AlreadyUsed,
                "the frame was already copied",
            );
            return;
        }
        if !fits(&buffer, copying.size) {
            frame.post_error(
                zwlr_screencopy_frame_v1::Error::InvalidBuffer,
                "the buffer is not one the frame offered",
            );
            return;
        }
        let frame = frame.clone();
        self.screen_copying.shoot_monitor(
            copying.monitor.clone(),
            copying.region,
            Box::new(move |desk| match copied(&buffer, desk) {
                Ok((width, height)) => {
                    if frame.version() >= 2 {
                        frame.flags(zwlr_screencopy_frame_v1::Flags::empty());
                    }
                    if damage {
                        frame.damage(0, 0, width, height);
                    }
                    let (seconds_high, seconds_low, nanoseconds) = now();
                    frame.ready(seconds_high, seconds_low, nanoseconds);
                }
                Err(why) => {
                    debug!(%why, "a screencopy frame could not be copied");
                    frame.failed();
                }
            }),
        );
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
}

impl Dispatch<ZwlrScreencopyManagerV1, ()> for DomicileCompositor {
    fn request(
        state: &mut Self,
        _: &Client,
        _: &ZwlrScreencopyManagerV1,
        request: zwlr_screencopy_manager_v1::Request,
        _: &(),
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        match request {
            zwlr_screencopy_manager_v1::Request::CaptureOutput { frame, output, .. } => {
                state.frame(frame, &output, None, data_init);
            }
            zwlr_screencopy_manager_v1::Request::CaptureOutputRegion {
                frame,
                output,
                x,
                y,
                width,
                height,
                ..
            } => {
                let region = Region {
                    position: (x, y),
                    size: (width, height),
                };
                state.frame(frame, &output, Some(region), data_init);
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
}
