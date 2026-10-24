//! The compositor's side of screen casting: what can be cast, and the frames,
//! pointer and screens the casts follow. Streams are `crate::casting`'s.

use std::time::Instant;

use smithay::reexports::{
    calloop::timer::{TimeoutAction, Timer},
    wayland_server::protocol::wl_buffer,
};
use smithay::wayland::{
    compositor::with_states,
    shell::xdg::{ToplevelSurface, XdgToplevelSurfaceData},
};
use tracing::{debug, info, warn};

use crate::buffer_transform::Sampled;
use crate::client_damage::Region;
use crate::engine_session::EngineSession;
use crate::surface_commit::committed_buffer;
use crate::{casting, engine};
use crate::{CalloopData, DomicileCompositor, Gpu};

impl DomicileCompositor {
    /// A cast request, from any thread.
    pub fn cast_requested(&mut self, request: casting::Request) {
        let open = self.cast_candidates();
        let renderer = self.gpu.as_mut().map(Gpu::renderer);
        let capturer = capturer(&mut self.engine, &mut self.cast_test_pattern);
        self.casting.request(request, || open, renderer, capturer);
        self.follow_the_casts();
    }

    /// The windows that can be cast, in the order they opened, then the
    /// monitors.
    fn cast_candidates(&self) -> Vec<casting::Candidate> {
        let host = self.hub.host.lock().unwrap();
        let windows = self.toplevels.iter().map(|(id, toplevel)| {
            let app_id = with_states(toplevel.wl_surface(), |states| {
                states
                    .data_map
                    .get::<XdgToplevelSurfaceData>()
                    .and_then(|data| data.lock().unwrap().app_id.clone())
            });
            casting::Candidate {
                source: casting::Source::Window(id.clone()),
                title: host
                    .app(id)
                    .and_then(|app| app.title.clone())
                    .unwrap_or_default(),
                app_id: app_id.unwrap_or_default(),
                bounds: self
                    .held_frames
                    .shown_box(&self.app_bounds, id)
                    .map(|bounds| casting::Region {
                        position: (bounds.min.x.round() as i32, bounds.min.y.round() as i32),
                        size: (
                            (bounds.max.x - bounds.min.x).round() as i32,
                            (bounds.max.y - bounds.min.y).round() as i32,
                        ),
                    }),
            }
        });
        windows.chain(self.screens.cast_monitors()).collect()
    }

    /// News from the PipeWire thread.
    pub fn cast_news(&mut self, news: casting::ToWayland) {
        let ended = matches!(news, casting::ToWayland::Ended { .. });
        let renderer = self.gpu.as_mut().map(Gpu::renderer);
        let capturer = capturer(&mut self.engine, &mut self.cast_test_pattern);
        let due = self.casting.news(news, renderer, capturer, Instant::now());
        self.arm_the_cast_deadline(due);
        if ended {
            self.follow_the_casts();
        }
    }

    /// Let a hidden window draw while a cast shows it, and hold it again once
    /// none does. See [`crate::held_frames`].
    fn follow_the_casts(&mut self) {
        let recast = self.held_frames.cast(self.casting.windows());
        for (app_id, held) in recast.released {
            debug!(%app_id, held = held.len(), "hidden but cast: frames released");
            self.suspend(&app_id, &self.hidden_toplevel(&app_id), false);
            self.send_frames(held);
        }
        for app_id in recast.held {
            debug!(%app_id, "hidden and no longer cast: frames held");
            self.suspend(&app_id, &self.hidden_toplevel(&app_id), true);
        }
        if self.held_frames.start_trickling() {
            self.start_trickling();
        }
    }

    /// The toplevel of `app_id`, which the page hides.
    pub fn hidden_toplevel(&self, app_id: &str) -> ToplevelSurface {
        self.toplevel_for(app_id)
            // Closing a window forgets it; see `forget`.
            .expect("a hidden window is open")
    }

    /// The pointer moved over `at`'s window box, or left every window.
    pub fn cast_pointer(&mut self, at: Option<(String, (f64, f64))>) {
        let renderer = self.gpu.as_mut().map(Gpu::renderer);
        let due = self.casting.pointer_in_window(at, renderer, Instant::now());
        self.arm_the_cast_deadline(due);
    }

    /// The engine says the pointer is at `at` on the desktop, or off it, and
    /// over the pages of `windows`.
    pub fn cast_desk_pointer(
        &mut self,
        at: Option<(f64, f64)>,
        windows: Vec<domicile_protocol::PointerOverWindow>,
    ) {
        let renderer = self.gpu.as_mut().map(Gpu::renderer);
        let due = self
            .casting
            .pointer_on_desk(at, windows, renderer, Instant::now());
        self.arm_the_cast_deadline(due);
    }

    /// The pointer the engine draws, or `None` while it is hidden, for casts
    /// to draw. An image that does not decode leaves the last one.
    pub fn cast_desk_cursor(&mut self, image: Option<domicile_protocol::CursorImage>) {
        let sprite = match image {
            None => casting::Sprite::hidden(),
            Some(image) => {
                let sprite = domicile_host::base64::decoded(&image.bgra)
                    .ok()
                    .and_then(|bgra| {
                        casting::Sprite::from_bgra(image.size, image.hotspot, image.scale, bgra)
                    });
                let Some(sprite) = sprite else {
                    warn!(size = ?image.size, "the engine's pointer did not decode");
                    return;
                };
                sprite
            }
        };
        let renderer = self.gpu.as_mut().map(Gpu::renderer);
        let due = self.casting.pointer_image(sprite, renderer, Instant::now());
        self.arm_the_cast_deadline(due);
    }

    /// Hands a window's committed frame to its casts. `sampled` is the
    /// engine's: a crop of `(0, 0, 0, 0)` is the whole buffer.
    pub fn cast_frame(
        &mut self,
        app_id: &str,
        buffer: &wl_buffer::WlBuffer,
        sampled: Sampled,
        scale: i32,
        damage: Option<Region>,
    ) {
        let crop = match (sampled.crop, committed_buffer(buffer)) {
            ((_, _, 0, 0), Some(committed)) => {
                let (width, height) = committed.size();
                (0, 0, width as i32, height as i32)
            }
            (crop, _) => crop,
        };
        let renderer = self.gpu.as_mut().map(Gpu::renderer);
        let due = self.casting.committed(
            casting::Committed {
                app_id,
                buffer,
                sampled: Sampled { crop, ..sampled },
                scale,
                damage: damage.map(|region| {
                    (
                        region.x as i32,
                        region.y as i32,
                        region.width as i32,
                        region.height as i32,
                    )
                }),
            },
            renderer,
            Instant::now(),
        );
        self.arm_the_cast_deadline(due);
    }

    /// The engine captured a frame of a display, for monitor and region
    /// streams.
    pub fn cast_captured(
        &mut self,
        capture: engine::CaptureId,
        frame: u64,
        captured: Result<engine::CapturedFrame, String>,
    ) {
        let renderer = self.gpu.as_mut().map(Gpu::renderer);
        let Some(session) = self.engine.as_mut() else {
            return;
        };
        let due =
            self.casting
                .captured(capture, frame, captured, renderer, session, Instant::now());
        self.arm_the_cast_deadline(due);
    }

    /// A test pattern frame for each running capture, when no engine
    /// captures the displays.
    pub fn cast_the_test_pattern(&mut self) {
        let frames = match (&self.engine, self.cast_test_pattern.as_mut()) {
            (None, Some(pattern)) => pattern.frames(),
            _ => return,
        };
        for (capture, frame, captured) in frames {
            let renderer = self.gpu.as_mut().map(Gpu::renderer);
            let pattern = self.cast_test_pattern.as_mut().expect("checked above");
            let due = self.casting.captured(
                capture,
                frame,
                Ok(captured),
                renderer,
                pattern,
                Instant::now(),
            );
            self.arm_the_cast_deadline(due);
        }
    }

    /// The monitors changed, so monitor and region streams follow.
    pub fn tell_the_casts_the_screens(&mut self) {
        let capturer = capturer(&mut self.engine, &mut self.cast_test_pattern);
        self.casting.screens(self.screens.cast_screens(), capturer);
        self.cast_the_monitor_if_asked();
    }

    /// Wakes the loop when a paced cast frame is due, unless a wake is armed.
    fn arm_the_cast_deadline(&mut self, due: Option<Instant>) {
        let Some(due) = due else {
            return;
        };
        if self.cast_deadline.is_some() {
            return;
        }
        let armed = self
            .loop_handle
            .insert_source(Timer::from_deadline(due), |_, _, data: &mut CalloopData| {
                let state = &mut data.state;
                state.cast_deadline = None;
                let due = state.casting.tick(Instant::now());
                state.arm_the_cast_deadline(due);
                TimeoutAction::Drop
            })
            // Timers register nothing with the kernel, so inserting cannot
            // fail.
            .expect("the compositor's own loop takes a timer");
        self.cast_deadline = Some(armed);
    }

    /// Starts the `DOMICILE_CAST_WINDOW` cast once a window takes its title.
    ///
    /// For checking the producer without the ScreenCast portal; see
    /// `docs/COMPOSITOR-DEBUGGING.md`. The stream's events are only logged.
    pub fn cast_if_asked(&mut self, app_id: &str, title: Option<&str>) {
        if self
            .cast_on_title
            .as_ref()
            .is_some_and(|(wanted, _)| Some(wanted.as_str()) == title)
        {
            let (_, casting) = self.cast_on_title.take().expect("checked above");
            info!(%app_id, "casting the window DOMICILE_CAST_WINDOW names");
            casting.start(
                casting::Source::Window(app_id.to_string()),
                casting::CursorMode::Embedded,
                |_| Box::new(|event| info!(?event, "DOMICILE_CAST_WINDOW cast")),
            );
        }
    }

    /// Starts the `DOMICILE_CAST_MONITOR` cast once that monitor is plugged
    /// in, or at once for a region.
    ///
    /// For checking monitor and region casts without the ScreenCast portal;
    /// see `docs/COMPOSITOR-DEBUGGING.md`. The stream's events are only
    /// logged.
    pub fn cast_the_monitor_if_asked(&mut self) {
        let ready = self.cast_on_monitor.as_ref().is_some_and(|(spec, _)| {
            match casting::Source::desk(spec) {
                casting::Source::Monitor(name) => {
                    self.screens.outputs().any(|output| output.name == name)
                }
                _ => true,
            }
        });
        if ready {
            let (spec, casting) = self.cast_on_monitor.take().expect("checked above");
            info!(%spec, "casting what DOMICILE_CAST_MONITOR names");
            casting.start(
                casting::Source::desk(&spec),
                casting::CursorMode::Embedded,
                |_| Box::new(|event| info!(?event, "DOMICILE_CAST_MONITOR cast")),
            );
        }
    }
}

/// What captures the displays for monitor and region casts: the engine,
/// else the test pattern when it is on.
pub fn capturer<'a>(
    engine: &'a mut Option<EngineSession>,
    pattern: &'a mut Option<casting::TestPattern>,
) -> Option<&'a mut (dyn casting::Capturer + 'static)> {
    match engine {
        Some(session) => Some(session),
        None => pattern
            .as_mut()
            .map(|pattern| pattern as &mut dyn casting::Capturer),
    }
}
