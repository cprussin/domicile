//! Monitors with no connector, which the shell adds to extend the desk onto a
//! TV it casts to. See `docs/CASTING-TO-TVS.md`.
//!
//! A page's connection numbers each one ([`VirtualMonitors::add`]) and queues
//! a [`ClientRequest::AddVirtualMonitor`]. Its lease queues
//! [`ClientRequest::RemoveVirtualMonitor`] when the page stops or goes away.
//! The Wayland thread keeps the list and tells the engine; the engine's next
//! display report puts each on the desk (`Screens::extended_onto`).

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use domicile_host::system::{AddedMonitor, VirtualMonitor};
use domicile_protocol::{SystemError, SystemErrorKind};

use crate::client_requests::ClientRequest;
use crate::engine::VirtualDisplay;
use crate::DomicileCompositor;

/// The numbers handed out, and whether the desk can be extended.
pub struct VirtualMonitors {
    next: AtomicU32,
    extendable: AtomicBool,
}

impl Default for VirtualMonitors {
    fn default() -> Self {
        VirtualMonitors {
            // `virtual-0` would read as a placeholder.
            next: AtomicU32::new(1),
            extendable: AtomicBool::new(false),
        }
    }
}

impl VirtualMonitors {
    /// Sets whether the engine's displays define the desktop. Only then can a
    /// virtual monitor join it: nested, Domicile's window is the desktop, and
    /// `output.displays` describes one outright.
    pub fn set_extendable(&self, extendable: bool) {
        self.extendable.store(extendable, Ordering::Relaxed);
    }

    /// Adds `wanted`, queueing its requests through `send`.
    pub fn add(
        &self,
        wanted: VirtualMonitor,
        send: impl Fn(ClientRequest) + Send + 'static,
    ) -> Result<AddedMonitor, SystemError> {
        if !self.extendable.load(Ordering::Relaxed) {
            return Err(SystemError {
                kind: SystemErrorKind::Other,
                message: "only a desktop whose monitors the engine reports can extend: a tty \
                          session with no output.displays"
                    .into(),
            });
        }
        // Never reused, so a late removal cannot take a newer monitor.
        let number = self.next.fetch_add(1, Ordering::Relaxed);
        let id = VirtualDisplay::id_of(number);
        send(ClientRequest::AddVirtualMonitor {
            display: VirtualDisplay {
                id,
                mode: wanted.size,
                refresh_mhz: wanted.refresh_mhz,
                name: wanted.name,
            },
        });
        Ok(AddedMonitor {
            // The connector the engine reports it on, which `Screens` names
            // it after.
            output: format!("virtual-{number}"),
            lease: Box::new(Lease {
                id,
                send: Box::new(send),
            }),
        })
    }
}

impl DomicileCompositor {
    /// Tell the engine the virtual monitors, replacing the ones it had.
    pub fn state_the_virtual_monitors(&self) {
        if let Some(session) = self.engine.as_ref() {
            session.configure_virtual_displays(&self.virtual_displays);
        }
    }
}

/// Removes its monitor when dropped.
struct Lease {
    id: i64,
    send: Box<dyn Fn(ClientRequest) + Send>,
}

impl Drop for Lease {
    fn drop(&mut self) {
        (self.send)(ClientRequest::RemoveVirtualMonitor { id: self.id });
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::{channel, Receiver};

    use super::*;

    fn a_tv() -> VirtualMonitor {
        VirtualMonitor {
            name: "Living Room TV".into(),
            size: (1920, 1080),
            refresh_mhz: 60_000,
        }
    }

    fn extendable() -> VirtualMonitors {
        let monitors = VirtualMonitors::default();
        monitors.set_extendable(true);
        monitors
    }

    fn queue() -> (
        impl Fn(ClientRequest) + Send + 'static,
        Receiver<ClientRequest>,
    ) {
        let (sent, queued) = channel();
        (move |request| sent.send(request).unwrap(), queued)
    }

    #[test]
    fn a_monitor_is_added_until_its_lease_ends() {
        let monitors = extendable();
        let (send, queued) = queue();

        let added = monitors.add(a_tv(), send).expect("the desk extends");

        assert_eq!(added.output, "virtual-1");
        assert_eq!(
            queued.try_recv().unwrap(),
            ClientRequest::AddVirtualMonitor {
                display: VirtualDisplay {
                    id: VirtualDisplay::id_of(1),
                    mode: (1920, 1080),
                    refresh_mhz: 60_000,
                    name: "Living Room TV".into(),
                },
            }
        );
        drop(added);
        assert_eq!(
            queued.try_recv().unwrap(),
            ClientRequest::RemoveVirtualMonitor {
                id: VirtualDisplay::id_of(1),
            }
        );
    }

    #[test]
    fn each_monitor_gets_a_number_of_its_own() {
        let monitors = extendable();

        let (send, _queued) = queue();
        let first = monitors.add(a_tv(), send).expect("the desk extends");
        drop(first);
        let (send, _queued) = queue();
        let second = monitors.add(a_tv(), send).expect("the desk extends");

        assert_eq!(second.output, "virtual-2");
    }

    #[test]
    fn a_desk_the_engine_does_not_lay_out_cannot_extend() {
        let monitors = VirtualMonitors::default();
        let (send, queued) = queue();

        let refused = monitors.add(a_tv(), send).err().expect("refused");

        assert_eq!(refused.kind, SystemErrorKind::Other);
        assert!(queued.try_recv().is_err());
    }
}
