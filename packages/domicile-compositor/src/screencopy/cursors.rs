//! Cursor sessions: the pointer over a monitor or window, and a capture
//! session of its image (see [`pointing`](super::pointing)).
//!
//! The pointer is the one casts draw: where the engine or a window reports
//! it, with the image the engine draws, at the source's density
//! ([`crate::casting::Streams::pointer_over`]).

use smithay::reexports::wayland_protocols::ext::image_copy_capture::v1::server::{
    ext_image_copy_capture_cursor_session_v1::{self, ExtImageCopyCaptureCursorSessionV1},
    ext_image_copy_capture_frame_v1::{ExtImageCopyCaptureFrameV1, FailureReason},
    ext_image_copy_capture_session_v1::ExtImageCopyCaptureSessionV1,
};
use smithay::reexports::wayland_server::protocol::{wl_buffer::WlBuffer, wl_output, wl_shm};
use smithay::reexports::wayland_server::{
    backend::{ClientId, ObjectId},
    Client, DataInit, Dispatch, DisplayHandle, New, Resource,
};
use smithay::wayland::shm::with_buffer_contents_mut;
use tracing::debug;

use super::pointing::{Imaged, Imaging, Pointing, Told};
use super::taking::Layout;
use super::{buffer, now, stopped_session, Session, Shows};
use crate::casting::{Source, Sprite};
use crate::DomicileCompositor;

/// A cursor session of a source, as long as its source is.
pub struct Cursor {
    source: Source,
    session: ExtImageCopyCaptureCursorSessionV1,
    pointing: Pointing,
    /// The capture session of the pointer's image, once asked for.
    capture: Option<ExtImageCopyCaptureSessionV1>,
    imaging: Imaging<(ExtImageCopyCaptureFrameV1, WlBuffer)>,
}

impl DomicileCompositor {
    /// Starts a cursor session of `source`, and tells it where the pointer is.
    pub(super) fn cursor_session(
        &mut self,
        new: New<ExtImageCopyCaptureCursorSessionV1>,
        source: Option<Source>,
        data_init: &mut DataInit<'_, Self>,
    ) {
        let session = data_init.init(new, ());
        let Some(source) = source else {
            return;
        };
        self.copies.cursors.insert(
            session.id(),
            Cursor {
                source,
                session,
                pointing: Pointing::default(),
                capture: None,
                imaging: Imaging::new(),
            },
        );
        self.pointers_moved();
    }

    /// The pointer moved or changed: each cursor session hears what is new.
    pub fn pointers_moved(&mut self) {
        for cursor in self.copies.cursors.values_mut() {
            let over = self.casting.pointer_over(&cursor.source);
            for told in cursor.pointing.moved(over.as_ref()) {
                match told {
                    Told::Enter => cursor.session.enter(),
                    Told::Leave => cursor.session.leave(),
                    Told::Position((x, y)) => cursor.session.position(x, y),
                    Told::Hotspot((x, y)) => cursor.session.hotspot(x, y),
                }
            }
            if let Some(capture) = &cursor.capture {
                let sprite = over.as_ref().map(|over| &over.sprite);
                imaged(capture, cursor.imaging.drawn(sprite));
            }
        }
    }

    /// The capture session of cursor session `cursor`'s image.
    fn cursor_capture(
        &mut self,
        cursor: &ExtImageCopyCaptureCursorSessionV1,
        new: New<ExtImageCopyCaptureSessionV1>,
        data_init: &mut DataInit<'_, Self>,
    ) {
        let Some(held) = self.copies.cursors.get_mut(&cursor.id()) else {
            stopped_session(new, data_init);
            return;
        };
        if held.capture.is_some() {
            cursor.post_error(
                ext_image_copy_capture_cursor_session_v1::Error::DuplicateSession,
                "a cursor session has one capture session",
            );
            return;
        }
        let capture = data_init.init(new, Session::new(Shows::Cursor(cursor.id())));
        let over = self.casting.pointer_over(&held.source);
        imaged(
            &capture,
            held.imaging.drawn(over.as_ref().map(|over| &over.sprite)),
        );
        held.capture = Some(capture);
    }

    /// `frame` of cursor session `cursor`'s image captures into `buffer`.
    pub(super) fn capture_cursor(
        &mut self,
        cursor: &ObjectId,
        frame: &ExtImageCopyCaptureFrameV1,
        buffer: WlBuffer,
    ) {
        let Some(held) = self.copies.cursors.get_mut(cursor) else {
            frame.failed(FailureReason::Stopped);
            return;
        };
        let Some(Layout::Shm { size, .. }) = buffer::layout_of(&buffer) else {
            frame.failed(FailureReason::BufferConstraints);
            return;
        };
        let over = self.casting.pointer_over(&held.source);
        let sprite = over.as_ref().map(|over| &over.sprite);
        match held.imaging.capture((frame.clone(), buffer), size, sprite) {
            Some(done) => imaged(
                held.capture.as_ref().expect("a frame's capture session"),
                done,
            ),
            None => frame.failed(FailureReason::BufferConstraints),
        }
    }

    /// A frame of cursor session `cursor`'s image is gone.
    pub(super) fn cursor_frame_gone(&mut self, cursor: &ObjectId) {
        if let Some(held) = self.copies.cursors.get_mut(cursor) {
            held.imaging.abandoned();
        }
    }
}

/// Does what a cursor capture session's image asks.
fn imaged(
    capture: &ExtImageCopyCaptureSessionV1,
    done: Vec<Imaged<(ExtImageCopyCaptureFrameV1, WlBuffer)>>,
) {
    for imaged in done {
        match imaged {
            Imaged::Constrain((width, height)) => {
                capture.buffer_size(width, height);
                capture.shm_format(wl_shm::Format::Argb8888);
                capture.done();
            }
            Imaged::Fail((frame, _)) => frame.failed(FailureReason::BufferConstraints),
            Imaged::Copy((frame, buffer), sprite) => match drawn(&buffer, &sprite) {
                Ok(()) => {
                    let (seconds_high, seconds_low, nanoseconds) = now();
                    let (width, height) = sprite.size;
                    frame.transform(wl_output::Transform::Normal);
                    frame.damage(0, 0, width as i32, height as i32);
                    frame.presentation_time(seconds_high, seconds_low, nanoseconds);
                    frame.ready();
                }
                Err(why) => {
                    debug!(%why, "the pointer's image could not be copied");
                    frame.failed(FailureReason::Unknown);
                }
            },
        }
    }
}

/// Copies `sprite`'s pixels into the shm `buffer`, which is its size.
fn drawn(buffer: &WlBuffer, sprite: &Sprite) -> Result<(), String> {
    with_buffer_contents_mut(buffer, |pointer, length, data| {
        let offset = data.offset as usize;
        if offset + sprite.pixels.len() > length {
            return Err("the buffer's pool shrank".to_string());
        }
        // SAFETY: Smithay maps the pool `length` bytes long at `pointer`
        // while this closure runs, and nothing else touches it meanwhile.
        let pool = unsafe { std::slice::from_raw_parts_mut(pointer, length) };
        pool[offset..offset + sprite.pixels.len()].copy_from_slice(&sprite.pixels);
        Ok(())
    })
    .map_err(|why| why.to_string())?
}

impl Dispatch<ExtImageCopyCaptureCursorSessionV1, ()> for DomicileCompositor {
    fn request(
        state: &mut Self,
        _: &Client,
        cursor: &ExtImageCopyCaptureCursorSessionV1,
        request: ext_image_copy_capture_cursor_session_v1::Request,
        _: &(),
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let ext_image_copy_capture_cursor_session_v1::Request::GetCaptureSession { session } =
            request
        {
            state.cursor_capture(cursor, session, data_init);
        }
    }

    fn destroyed(
        state: &mut Self,
        _: ClientId,
        cursor: &ExtImageCopyCaptureCursorSessionV1,
        _: &(),
    ) {
        if let Some(Cursor {
            capture: Some(capture),
            ..
        }) = state.copies.cursors.remove(&cursor.id())
        {
            capture.stopped();
        }
    }
}
