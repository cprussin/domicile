//! The portal dialogs waiting on the shell.
//!
//! The compositor's `portals` module takes each backend call off D-Bus,
//! submits it here with whatever answers the application (`W`), and pushes
//! [`Portals::items`] to every chrome. The first answer takes the request off
//! the queue; later ones are refused. See `docs/architecture/PORTALS.md`.

use domicile_protocol::{PortalKind, PortalRequest};

/// An answer for a request that was answered or withdrawn already, or never
/// existed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("no portal request is waiting under this id")]
pub struct Unknown;

/// A request and what answers it.
#[derive(Debug)]
struct Pending<W> {
    request: PortalRequest,
    waiter: W,
}

/// The unanswered requests, oldest first.
#[derive(Debug)]
pub struct Portals<W> {
    next_id: u32,
    listening: bool,
    pending: Vec<Pending<W>>,
}

impl<W> Default for Portals<W> {
    fn default() -> Self {
        Portals {
            next_id: 0,
            listening: false,
            pending: Vec::new(),
        }
    }
}

impl<W> Portals<W> {
    pub fn new() -> Self {
        Portals::default()
    }

    /// Whether any chrome is connected to answer.
    ///
    /// Requests stay queued while nobody listens, so a reloading page picks
    /// them up again.
    pub fn set_listening(&mut self, listening: bool) {
        self.listening = listening;
    }

    /// Queue a request and return its id, or hand `waiter` back when no chrome
    /// listens. The caller then answers the application with response `2`.
    pub fn submit(
        &mut self,
        app_id: String,
        parent_app_id: Option<String>,
        kind: PortalKind,
        waiter: W,
    ) -> Result<u32, W> {
        if self.listening {
            self.next_id += 1;
            self.pending.push(Pending {
                request: PortalRequest {
                    id: self.next_id,
                    app_id,
                    parent_app_id,
                    kind,
                },
                waiter,
            });
            Ok(self.next_id)
        } else {
            Err(waiter)
        }
    }

    /// Take the request `id` off the queue to answer it, returning its waiter.
    pub fn answer(&mut self, id: u32) -> Result<W, Unknown> {
        self.withdraw(id).ok_or(Unknown)
    }

    /// Take the request `id` off the queue unanswered, as when the application
    /// closes it. `None` when it was already answered.
    pub fn withdraw(&mut self, id: u32) -> Option<W> {
        self.pending
            .iter()
            .position(|pending| pending.request.id == id)
            .map(|index| self.pending.remove(index).waiter)
    }

    /// Every unanswered request, oldest first, for the chromes.
    pub fn items(&self) -> Vec<PortalRequest> {
        self.pending
            .iter()
            .map(|pending| pending.request.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domicile_protocol::AccessDialog;

    fn access() -> PortalKind {
        PortalKind::Access(AccessDialog {
            title: "Use the camera?".into(),
            subtitle: String::new(),
            body: String::new(),
            grant_label: None,
            deny_label: None,
        })
    }

    fn listening() -> Portals<&'static str> {
        let mut portals = Portals::new();
        portals.set_listening(true);
        portals
    }

    #[test]
    fn a_request_nobody_listens_for_is_handed_back() {
        let mut portals = Portals::new();

        assert_eq!(
            portals.submit("org.example.App".into(), None, access(), "camera"),
            Err("camera")
        );
        assert_eq!(portals.items(), []);
    }

    #[test]
    fn requests_are_listed_oldest_first_under_their_own_ids() {
        let mut portals = listening();
        let first = portals.submit("one".into(), None, access(), "first");
        let second = portals.submit("two".into(), Some("app-3".into()), access(), "second");

        assert_eq!((first, second), (Ok(1), Ok(2)));
        assert_eq!(
            portals.items(),
            [
                PortalRequest {
                    id: 1,
                    app_id: "one".into(),
                    parent_app_id: None,
                    kind: access(),
                },
                PortalRequest {
                    id: 2,
                    app_id: "two".into(),
                    parent_app_id: Some("app-3".into()),
                    kind: access(),
                },
            ]
        );
    }

    #[test]
    fn the_first_answer_wins() {
        let mut portals = listening();
        let id = portals
            .submit("one".into(), None, access(), "camera")
            .expect("queued");

        assert_eq!(portals.answer(id), Ok("camera"));
        assert_eq!(portals.answer(id), Err(Unknown));
        assert_eq!(portals.items(), []);
    }

    #[test]
    fn an_answer_for_an_id_never_given_out_is_refused() {
        assert_eq!(listening().answer(7), Err(Unknown));
    }

    #[test]
    fn a_withdrawn_request_takes_no_answer() {
        let mut portals = listening();
        let id = portals
            .submit("one".into(), None, access(), "camera")
            .expect("queued");

        assert_eq!(portals.withdraw(id), Some("camera"));
        assert_eq!(portals.withdraw(id), None);
        assert_eq!(portals.answer(id), Err(Unknown));
    }

    #[test]
    fn requests_outlive_the_listener_that_saw_them() {
        let mut portals = listening();
        let id = portals
            .submit("one".into(), None, access(), "camera")
            .expect("queued");
        portals.set_listening(false);

        assert_eq!(portals.items().len(), 1);
        assert_eq!(portals.answer(id), Ok("camera"));
    }

    #[test]
    fn ids_are_never_reused() {
        let mut portals = listening();
        let first = portals
            .submit("one".into(), None, access(), "first")
            .expect("queued");
        portals.answer(first).expect("taken");

        assert_eq!(
            portals.submit("one".into(), None, access(), "second"),
            Ok(first + 1)
        );
    }
}
