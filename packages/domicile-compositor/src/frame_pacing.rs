//! When clients hear their frames were shown: frame callbacks, presentation
//! feedback, and the frames held for hidden windows. See `crate::frame_callbacks`
//! and `crate::held_frames`.

use std::time::Duration;

use domicile_protocol::HostMessage;
use smithay::reexports::{
    calloop::timer::{TimeoutAction, Timer},
    wayland_protocols::wp::presentation_time::server::wp_presentation_feedback::Kind as PresentedKind,
    wayland_protocols::xdg::shell::server::xdg_toplevel,
    wayland_server::protocol::wl_callback::WlCallback,
};
use smithay::wayland::presentation::{PresentationFeedbackCallback, Refresh};
use smithay::wayland::shell::xdg::ToplevelSurface;
use tracing::debug;

use crate::engine;
use crate::engine_session::EngineSession;
use crate::frame_callbacks::{Presented, Unreported};
use crate::held_frames::TRICKLE;
use crate::{CalloopData, DomicileCompositor};

/// What a commit's frame callbacks wait for. See [`crate::frame_callbacks`].
pub enum Paced {
    /// The engine reports the app's frame by this number.
    Submitted(String, u64),
    /// The session holds the app's frame back for an import or an embed.
    Held(String),
}

impl DomicileCompositor {
    /// Sends a commit's frame callbacks once the engine reports its frame, and
    /// its presentation feedback once the frame reaches the screen. A held
    /// frame waits until it goes up. Without a frame the engine reports, sends
    /// the callbacks now and discards the feedback. See
    /// [`crate::frame_callbacks`].
    pub fn answer_when_shown(
        &mut self,
        shown: Option<Paced>,
        callbacks: Vec<WlCallback>,
        feedback: Vec<PresentationFeedbackCallback>,
    ) {
        let reported = self
            .engine
            .as_ref()
            .is_some_and(EngineSession::reports_frames);
        let now = self.monotonic();
        match shown.filter(|_| reported) {
            Some(paced) => {
                let replaced = match paced {
                    Paced::Submitted(app_id, frame) => self
                        .frame_callbacks
                        .wait(&app_id, frame, callbacks, feedback, now),
                    Paced::Held(app_id) => {
                        self.frame_callbacks.hold(&app_id, callbacks, feedback, now)
                    }
                };
                self.answer_unreported(replaced);
                self.watch_the_frame_deadline();
            }
            None => self.answer_unreported(Unreported {
                callbacks,
                discarded: feedback,
            }),
        }
    }

    /// Answers frames the engine will not report.
    pub fn answer_unreported(
        &self,
        unreported: Unreported<WlCallback, PresentationFeedbackCallback>,
    ) {
        self.send_frames(unreported.callbacks);
        for feedback in unreported.discarded {
            feedback.discarded();
        }
    }

    /// `CLOCK_MONOTONIC`, as `wp_presentation` and the engine read it.
    pub fn monotonic(&self) -> Duration {
        self.clock.now().into()
    }

    /// Arms the timer that answers frames the engine has not reported by
    /// [`crate::frame_callbacks::DEADLINE`], unless it is armed or nothing
    /// waits.
    fn watch_the_frame_deadline(&mut self) {
        let Some(deadline) = self.frame_callbacks.next_deadline() else {
            return;
        };
        if self.frame_deadline_armed {
            return;
        }
        self.frame_deadline_armed = true;
        self.loop_handle
            .insert_source(
                Timer::from_duration(deadline.saturating_sub(self.monotonic())),
                |_, _, data: &mut CalloopData| data.state.answer_overdue_frames(),
            )
            // Timers register nothing with the kernel, so inserting cannot
            // fail.
            .expect("the compositor's own loop takes a timer");
    }

    /// Answers frames past the deadline, and rearms for the next.
    fn answer_overdue_frames(&mut self) -> TimeoutAction {
        let overdue = self.frame_callbacks.overdue(self.monotonic());
        if !overdue.callbacks.is_empty() || !overdue.discarded.is_empty() {
            debug!(
                callbacks = overdue.callbacks.len(),
                feedback = overdue.discarded.len(),
                "the engine did not report these frames in time; answering them anyway"
            );
        }
        self.answer_unreported(overdue);
        match self.frame_callbacks.next_deadline() {
            Some(deadline) => TimeoutAction::ToDuration(deadline.saturating_sub(self.monotonic())),
            None => {
                self.frame_deadline_armed = false;
                TimeoutAction::Drop
            }
        }
    }

    /// Sends a presented frame's feedback, synced to the output most of its
    /// window is on, or discards it if it was never shown.
    pub fn present(
        &self,
        app_id: &str,
        presented: Presented<PresentationFeedbackCallback>,
        shown: Option<engine::Shown>,
    ) {
        let output = self
            .outputs
            .iter()
            .zip(
                self.screens
                    .entered_by(self.app_bounds.get(app_id).copied()),
            )
            .find(|(_, entered)| *entered)
            .map(|(live, _)| &live.output)
            .or_else(|| self.outputs.first().map(|live| &live.output));
        match (shown, output) {
            (Some(shown), Some(output)) => {
                self.hub
                    .timings
                    .lock()
                    .unwrap()
                    .present
                    .record(shown.time.saturating_sub(presented.committed));
                let refresh = shown.refresh.map_or(Refresh::Unknown, Refresh::fixed);
                for feedback in presented.feedback {
                    // Viz reports no vblank count, so `seq` is zero.
                    feedback.presented(
                        output,
                        shown.time,
                        refresh,
                        0,
                        PresentedKind::from_bits_truncate(shown.kind),
                    );
                }
            }
            (None, _) | (_, None) => {
                for feedback in presented.feedback {
                    feedback.discarded();
                }
            }
        }
    }

    pub fn send_frames(&self, callbacks: Vec<WlCallback>) {
        let time = self.now_ms();
        for callback in callbacks {
            callback.done(time);
        }
    }

    /// Stop the window `app_id` drawing: the page hid it. See
    /// [`crate::held_frames`].
    pub fn hide(&mut self, app_id: &str, toplevel: &ToplevelSurface) {
        if self.held_frames.hide(app_id) {
            debug!(%app_id, "hidden: frames held");
            self.suspend(app_id, toplevel, true);
            if self.held_frames.start_trickling() {
                self.start_trickling();
            }
        }
    }

    /// Let the window `app_id` draw again, starting with the frames it was
    /// held at.
    pub fn show(&mut self, app_id: &str, toplevel: &ToplevelSurface) {
        if let Some(held) = self.held_frames.show(app_id) {
            debug!(%app_id, held = held.len(), "shown: frames released");
            self.suspend(app_id, toplevel, false);
            self.send_frames(held);
        }
    }

    /// Send hidden windows' held callbacks every [`TRICKLE`], so a client
    /// blocked on one wakes, until no window is hidden. See
    /// [`crate::held_frames`].
    pub fn start_trickling(&self) {
        self.loop_handle
            .insert_source(
                Timer::from_duration(TRICKLE),
                |_, _, data: &mut CalloopData| match data.state.held_frames.trickle() {
                    Some(held) => {
                        data.state.send_frames(held);
                        TimeoutAction::ToDuration(TRICKLE)
                    }
                    None => TimeoutAction::Drop,
                },
            )
            // Timers register nothing with the kernel, so inserting cannot
            // fail.
            .expect("the compositor's own loop takes a timer");
    }

    /// Send `app_id`'s held callbacks before closing it, so a client blocked
    /// on one reads the close.
    pub fn release_before_closing(&mut self, app_id: &str) {
        let held = self.held_frames.take(app_id);
        self.send_frames(held);
    }

    /// Show every hidden window: a new page has reported no boxes, and may
    /// never.
    pub fn show_every_window(&mut self) {
        for (app_id, held) in self.held_frames.show_all() {
            self.suspend(&app_id, &self.hidden_toplevel(&app_id), false);
            self.send_frames(held);
        }
    }

    /// Set or clear `app_id`'s `suspended` state, and tell the chromes when
    /// that changes it.
    pub fn suspend(&mut self, app_id: &str, toplevel: &ToplevelSurface, suspended: bool) {
        set_suspended(toplevel, suspended);
        let changed = if suspended {
            self.suspended.insert(app_id.to_string())
        } else {
            self.suspended.remove(app_id)
        };
        if changed {
            self.hub.broadcast(HostMessage::AppSuspended {
                app_id: app_id.to_string(),
                suspended,
            });
        }
    }
}

/// Set or clear `xdg_toplevel`'s `suspended` state. Smithay leaves it out for
/// clients older than version 6.
fn set_suspended(toplevel: &ToplevelSurface, suspended: bool) {
    toplevel.with_pending_state(|state| {
        if suspended {
            state.states.set(xdg_toplevel::State::Suspended);
        } else {
            state.states.unset(xdg_toplevel::State::Suspended);
        }
    });
    // Before the first configure, that configure carries it.
    if toplevel.is_initial_configure_sent() {
        toplevel.send_pending_configure();
    }
}
