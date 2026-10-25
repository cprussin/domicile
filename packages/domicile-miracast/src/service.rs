//! `net.domicile.Miracast1` at `/net/domicile/Miracast`: the TVs found, and
//! casts to them. The shell reaches it through `domicile.dbus`; see
//! `miracastCast` in `@domicile-desktop/sdk/cast`.
//!
//! - `Sinks() -> a(ss)`: each TV's id and name. `SinksChanged` says to ask
//!   again.
//! - `Cast(id) -> s`: starts a cast, returning its id at once. `Started(cast)`
//!   follows once the TV plays, or `Ended(cast, reason)` if it never does.
//! - `Stop(cast)`: ends it; `Ended(cast, "")` follows.
//! - `Ended(cast, reason)`: a cast ended, `reason` empty unless it failed.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use zbus::blocking::Connection;

use crate::cast::{self, Buses, Tv};
use crate::mice::Display;
use crate::p2p::Peer;

pub const NAME: &str = "net.domicile.Miracast";
pub const PATH: &str = "/net/domicile/Miracast";
pub const INTERFACE: &str = "net.domicile.Miracast1";

/// What the finders saw, and the casts running.
#[derive(Default)]
pub struct State {
    peers: Vec<Peer>,
    displays: Vec<Display>,
    casts: HashMap<String, Arc<AtomicBool>>,
}

/// The served object.
pub struct Miracast {
    pub state: Arc<Mutex<State>>,
    pub buses: Arc<Buses>,
    /// What LAN TVs are told this computer is called.
    pub name: String,
}

const P2P_PREFIX: &str = "p2p:";
const LAN_PREFIX: &str = "lan:";

impl State {
    fn sinks(&self) -> Vec<(String, String)> {
        let peers = self
            .peers
            .iter()
            .map(|peer| (format!("{P2P_PREFIX}{}", peer.path), peer.name.clone()));
        let displays = self.displays.iter().map(|display| {
            (
                format!("{LAN_PREFIX}{}", display.name),
                display.name.clone(),
            )
        });
        peers.chain(displays).collect()
    }

    fn tv(&self, id: &str) -> Option<Tv> {
        if let Some(path) = id.strip_prefix(P2P_PREFIX) {
            return self
                .peers
                .iter()
                .any(|peer| peer.path == path)
                .then(|| Tv::P2p(path.to_string()));
        }
        let name = id.strip_prefix(LAN_PREFIX)?;
        self.displays
            .iter()
            .find(|display| display.name == name)
            .cloned()
            .map(Tv::Lan)
    }
}

/// Says the TVs changed.
fn sinks_changed(connection: &Connection) {
    let _ = connection.emit_signal(None::<()>, PATH, INTERFACE, "SinksChanged", &());
}

/// Records what the Wi-Fi Direct finder saw.
pub fn peers_found(state: &Mutex<State>, connection: &Connection, peers: Vec<Peer>) {
    if let Ok(mut state) = state.lock() {
        state.peers = peers;
    }
    sinks_changed(connection);
}

/// Records what the LAN finder saw.
pub fn displays_found(state: &Mutex<State>, connection: &Connection, displays: Vec<Display>) {
    if let Ok(mut state) = state.lock() {
        state.displays = displays;
    }
    sinks_changed(connection);
}

#[zbus::interface(name = "net.domicile.Miracast1")]
impl Miracast {
    fn sinks(&self) -> Vec<(String, String)> {
        self.state
            .lock()
            .map(|state| state.sinks())
            .unwrap_or_default()
    }

    fn cast(
        &self,
        #[zbus(connection)] connection: &zbus::Connection,
        id: String,
    ) -> zbus::fdo::Result<String> {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let cast = format!("cast-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        let stop = Arc::new(AtomicBool::new(false));
        let tv = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| zbus::fdo::Error::Failed("the service broke".into()))?;
            let tv = state
                .tv(&id)
                .ok_or_else(|| zbus::fdo::Error::InvalidArgs("the TV is gone".into()))?;
            state.casts.insert(cast.clone(), stop.clone());
            tv
        };
        let connection = Connection::from(connection.clone());
        let (state, buses, name, id) = (
            self.state.clone(),
            self.buses.clone(),
            self.name.clone(),
            cast.clone(),
        );
        thread::spawn(move || {
            let started = || {
                let _ =
                    connection.emit_signal(None::<()>, PATH, INTERFACE, "Started", &(id.as_str(),));
            };
            let ended = cast::run(&buses, &tv, &name, &stop, started);
            let reason = ended
                .err()
                .map(|error| error.to_string())
                .unwrap_or_default();
            if let Ok(mut state) = state.lock() {
                state.casts.remove(&id);
            }
            let _ = connection.emit_signal(
                None::<()>,
                PATH,
                INTERFACE,
                "Ended",
                &(id.as_str(), reason.as_str()),
            );
        });
        Ok(cast)
    }

    fn stop(&self, cast: String) {
        if let Some(stop) = self
            .state
            .lock()
            .ok()
            .and_then(|state| state.casts.get(&cast).cloned())
        {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_tvs_by_how_they_are_reached() {
        let state = State {
            peers: vec![Peer {
                path: "/p/1".into(),
                name: "Fire TV".into(),
            }],
            ..State::default()
        };

        assert_eq!(
            state.sinks(),
            vec![("p2p:/p/1".to_string(), "Fire TV".to_string())]
        );
        assert!(matches!(state.tv("p2p:/p/1"), Some(Tv::P2p(path)) if path == "/p/1"));
        assert!(state.tv("p2p:/p/2").is_none());
        assert!(state.tv("lan:Fire TV").is_none());
    }
}
