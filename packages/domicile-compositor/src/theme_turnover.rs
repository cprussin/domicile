//! Turning the windows to a new theme once the chromes have captured their old
//! frames. The steps are `domicile_host::theme_turnover`'s.

use std::os::unix::net::UnixStream;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use smithay::reexports::calloop::timer::{TimeoutAction, Timer};

use domicile_host::theme_turnover::{Step, Turnover, REPAINT_WITHIN};

use crate::{CalloopData, DomicileCompositor};

/// Identifies a chrome in a theme turnover: the address of its writer, as
/// `ChromeHub::chromes` uses. Only compared, never dereferenced.
pub fn chrome_key(writer: &Arc<Mutex<UnixStream>>) -> usize {
    Arc::as_ptr(writer) as usize
}

impl DomicileCompositor {
    /// Do what the theme turnover says next.
    pub fn follow_the_turnover(&mut self, step: Step) {
        match (step, &mut self.turnover) {
            (Step::Wait, _) | (_, None) => {}
            (Step::Announce, Some(turnover)) => {
                self.hub.portals.announce(turnover.theme());
                // A hidden window cannot repaint until it is shown, and is not
                // on screen to turn.
                let windows = self
                    .toplevels
                    .iter()
                    .filter(|(app_id, _)| !self.held_frames.is_hidden(app_id))
                    .map(|(app_id, _)| app_id.clone());
                let step = turnover.announced(windows.collect::<Vec<_>>());
                self.arm_the_turnover_deadline(REPAINT_WITHIN, Turnover::repaint_deadline);
                self.follow_the_turnover(step);
            }
            (Step::Turned, Some(turnover)) => {
                let theme = turnover.theme();
                self.turnover = None;
                if let Some(armed) = self.turnover_deadline.take() {
                    self.loop_handle.remove(armed);
                }
                let told = self.hub.host.lock().unwrap().set_windows_theme(theme);
                if let Some(message) = told {
                    self.hub.broadcast(message);
                }
            }
        }
    }

    /// Arm the deadline for the turnover's current phase, replacing the last
    /// phase's. `ends` is the phase's own deadline, which does nothing if the
    /// turnover has moved on.
    pub fn arm_the_turnover_deadline(
        &mut self,
        after: Duration,
        ends: fn(&mut Turnover<usize>) -> Step,
    ) {
        if let Some(armed) = self.turnover_deadline.take() {
            self.loop_handle.remove(armed);
        }
        let armed = self
            .loop_handle
            .insert_source(
                Timer::from_duration(after),
                move |_, _, data: &mut CalloopData| {
                    let state = &mut data.state;
                    state.turnover_deadline = None;
                    if let Some(turnover) = &mut state.turnover {
                        let step = ends(turnover);
                        state.follow_the_turnover(step);
                    }
                    TimeoutAction::Drop
                },
            )
            // Timers register nothing with the kernel, so inserting cannot
            // fail.
            .expect("the compositor's own loop takes a timer");
        self.turnover_deadline = Some(armed);
    }
}
