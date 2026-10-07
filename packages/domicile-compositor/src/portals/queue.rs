//! The dialogs waiting on the shell, as the backend interfaces see them.
//!
//! An interface's method calls [`ask`] and awaits the shell's answer. The
//! queue itself is `domicile_host::portals`; this adds the bus's `Request`
//! object and who hears each change.

use std::sync::{Arc, Mutex, OnceLock};

use domicile_host::portals::{Portals, Unknown};
use domicile_protocol::{PortalAnswer, PortalKind, PortalRequest};
use tracing::{debug, warn};
use zbus::object_server::ObjectServer;
use zbus::zvariant::OwnedObjectPath;

use super::reply::{reply, Replier};
use super::request::Request;

/// Who hears the queue change, whether anybody can answer, and which
/// `<app>` a `parent_window` names.
struct Listener {
    publish: Box<dyn Fn(Vec<PortalRequest>) + Send + Sync>,
    listening: Box<dyn Fn() -> bool + Send + Sync>,
    parent: Box<Resolve>,
}

/// Resolves a `parent_window` to an app id.
type Resolve = dyn Fn(&str) -> Option<String> + Send + Sync;

/// The pending requests and their listener.
#[derive(Default)]
pub struct Queue {
    held: Mutex<Portals<Replier<PortalAnswer>>>,
    listener: OnceLock<Listener>,
}

impl Queue {
    /// Publish every change through `publish`. `listening` says whether a
    /// chrome is connected; a request made while none is, or before this is
    /// called, is refused at once. `parent` resolves a `parent_window` to the
    /// app id the dialog is modal over.
    pub fn listen(
        &self,
        publish: impl Fn(Vec<PortalRequest>) + Send + Sync + 'static,
        listening: impl Fn() -> bool + Send + Sync + 'static,
        parent: impl Fn(&str) -> Option<String> + Send + Sync + 'static,
    ) {
        let listener = Listener {
            publish: Box::new(publish),
            listening: Box::new(listening),
            parent: Box::new(parent),
        };
        if self.listener.set(listener).is_err() {
            panic!("the portal queue has one listener");
        }
    }

    /// The shell's answer to `id`. An answer for a request already answered
    /// or closed is dropped, and so is one that does not fit the request.
    pub fn answer(&self, id: u32, answer: PortalAnswer) {
        match self.change(|held| held.answer(id, &answer)) {
            Ok(replier) => replier.send(answer),
            Err(why) => debug!(%id, %why, "a portal answer was dropped"),
        }
    }

    /// Change `id`'s body while it waits. `Unknown` once it is answered.
    pub fn revise(&self, id: u32, revise: impl FnOnce(&mut PortalKind)) -> Result<(), Unknown> {
        self.change(|held| held.revise(id, revise))
    }

    /// The application closed `id`'s `Request`: the dialog goes, and the call
    /// ends with response `2`.
    pub fn withdraw(&self, id: u32) {
        if let Some(replier) = self.change(|held| held.withdraw(id)) {
            replier.send(PortalAnswer::Refused);
        }
    }

    /// List an inhibitor until [`Self::withdraw`], whether or not a chrome
    /// listens. Returns its id.
    pub fn hold(&self, app_id: String, parent_window: &str, kind: PortalKind) -> u32 {
        // An inhibitor takes no answer, so nothing awaits this one.
        let (replier, _) = reply();
        let parent = self
            .listener
            .get()
            .and_then(|listener| (listener.parent)(parent_window));
        self.change(|held| held.hold(app_id, parent, kind, replier))
    }

    /// Queue a request unpublished, or hand the replier back when nobody
    /// listens. [`ask`] publishes it once its `Request` is exported.
    fn submit(
        &self,
        app_id: String,
        parent_window: &str,
        kind: PortalKind,
        replier: Replier<PortalAnswer>,
    ) -> Result<u32, Replier<PortalAnswer>> {
        match self.listener.get() {
            Some(listener) => {
                let mut held = self.held.lock().unwrap();
                held.set_listening((listener.listening)());
                held.submit(app_id, (listener.parent)(parent_window), kind, replier)
            }
            None => Err(replier),
        }
    }

    /// Publish the queue as it is.
    fn publish(&self) {
        self.change(|_| ());
    }

    /// Apply `change` and publish the result. Publishing under the lock keeps
    /// changes in order.
    fn change<T>(&self, change: impl FnOnce(&mut Portals<Replier<PortalAnswer>>) -> T) -> T {
        let mut held = self.held.lock().unwrap();
        let changed = change(&mut held);
        if let Some(listener) = self.listener.get() {
            (listener.publish)(held.items());
        }
        changed
    }
}

/// Put a dialog of `kind` to the shell and wait for its answer.
///
/// Exports the frontend's `handle` as a `Request` while the dialog is up, so
/// the application can close it. [`PortalAnswer::Refused`] when nobody
/// listens.
pub async fn ask(
    queue: &Arc<Queue>,
    server: &ObjectServer,
    handle: OwnedObjectPath,
    app_id: String,
    parent_window: &str,
    kind: PortalKind,
) -> PortalAnswer {
    let (replier, answered) = reply();
    match queue.submit(app_id, parent_window, kind, replier) {
        Ok(id) => {
            let request = Request {
                id,
                queue: Arc::clone(queue),
            };
            if let Err(why) = server.at(&handle, request).await {
                warn!(%why, %handle, "a portal request cannot be closed by its application");
            }
            // Not before: a dialog the shell shows must have a `Request` for
            // `Close` and `UpdateChoices` to find.
            queue.publish();
            let answer = answered.await.unwrap_or(PortalAnswer::Refused);
            // Gone already when a `Close` raced the answer.
            let _ = server.remove::<Request, _>(&handle).await;
            answer
        }
        Err(_) => {
            debug!(%handle, "no shell is listening for portal dialogs; refused");
            PortalAnswer::Refused
        }
    }
}
