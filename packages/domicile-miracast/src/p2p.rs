//! TVs over Wi-Fi Direct, through NetworkManager's `WifiP2P` devices: finding
//! the peers that are displays, and connecting to one.
//!
//! NetworkManager does Wi-Fi Direct only through `wpa_supplicant`; under
//! `iwd` it has no P2P device, and [`P2p::find`] says so.

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::time::{Duration, Instant};

use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

use crate::wfd;

const NM: &str = "org.freedesktop.NetworkManager";
const NM_PATH: &str = "/org/freedesktop/NetworkManager";
const DEVICE: &str = "org.freedesktop.NetworkManager.Device";
const WIFI_P2P: &str = "org.freedesktop.NetworkManager.Device.WifiP2P";
const PEER: &str = "org.freedesktop.NetworkManager.WifiP2PPeer";

/// `NM_DEVICE_TYPE_WIFI_P2P`.
const WIFI_P2P_TYPE: u32 = 30;
/// `NM_ACTIVE_CONNECTION_STATE_ACTIVATED` and `…_DEACTIVATED`.
const ACTIVATED: u32 = 2;
const DEACTIVATED: u32 = 4;

/// How long a search lasts; [`P2p::find`] starts the next as it ends.
const FIND_FOR: i32 = 120;

/// How long the TV may take to accept: its owner may need to press OK.
const ACCEPT_WITHIN: Duration = Duration::from_secs(60);

#[derive(Debug, thiserror::Error)]
pub enum P2pError {
    #[error(transparent)]
    Bus(#[from] zbus::Error),
    #[error(
        "this computer's Wi-Fi can't cast to TVs directly: it needs Wi-Fi Direct, which NetworkManager runs only with wpa_supplicant"
    )]
    NoDevice,
    #[error("the TV didn't accept the connection")]
    NotAccepted,
    #[error("the connection to the TV got no address")]
    NoAddress,
}

impl From<zbus::fdo::Error> for P2pError {
    fn from(error: zbus::fdo::Error) -> Self {
        P2pError::Bus(error.into())
    }
}

/// A display NetworkManager saw.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Peer {
    pub path: String,
    pub name: String,
}

/// The computer's Wi-Fi Direct device.
pub struct P2p {
    connection: Connection,
    device: OwnedObjectPath,
}

impl P2p {
    /// The first Wi-Fi Direct device.
    pub fn open(connection: &Connection) -> Result<Self, P2pError> {
        let manager = Proxy::new(connection, NM, NM_PATH, NM)?;
        let devices: Vec<OwnedObjectPath> = manager.call("GetDevices", &())?;
        let device = devices
            .into_iter()
            .find(|device| {
                Proxy::new(connection, NM, device.as_str(), DEVICE)
                    .and_then(|proxy| proxy.get_property::<u32>("DeviceType"))
                    .is_ok_and(|kind| kind == WIFI_P2P_TYPE)
            })
            .ok_or(P2pError::NoDevice)?;
        Ok(Self {
            connection: connection.clone(),
            device,
        })
    }

    fn proxy(&self) -> Result<Proxy<'_>, P2pError> {
        Ok(Proxy::new(
            &self.connection,
            NM,
            self.device.as_str(),
            WIFI_P2P,
        )?)
    }

    /// The displays seen now.
    pub fn peers(&self) -> Result<Vec<Peer>, P2pError> {
        let paths: Vec<OwnedObjectPath> = self.proxy()?.get_property("Peers")?;
        Ok(paths
            .into_iter()
            .filter_map(|path| {
                let peer = Proxy::new(&self.connection, NM, path.as_str(), PEER).ok()?;
                let ies: Vec<u8> = peer.get_property("WfdIEs").ok()?;
                let name: String = peer.get_property("Name").ok()?;
                wfd::is_sink(&ies).then(|| Peer {
                    path: path.to_string(),
                    name,
                })
            })
            .collect())
    }

    /// Searches until the process ends, calling `changed` with the displays
    /// each time a peer comes or goes.
    pub fn find(&self, changed: impl Fn(Vec<Peer>)) -> Result<(), P2pError> {
        let proxy = self.proxy()?;
        let added = proxy.receive_signal("PeerAdded")?;
        let removed = proxy.receive_signal("PeerRemoved")?;
        let search = || {
            let options = HashMap::from([("timeout", Value::from(FIND_FOR))]);
            proxy.call_method("StartFind", &(options,)).map(drop)
        };
        search()?;
        changed(self.peers()?);
        let mut last_search = Instant::now();
        // Added and removed peers arrive on their own streams; either wakes
        // a look at the whole list.
        let (wake, woken) = std::sync::mpsc::channel();
        for mut stream in [added, removed] {
            let wake = wake.clone();
            std::thread::spawn(move || {
                while stream.next().is_some() {
                    if wake.send(()).is_err() {
                        break;
                    }
                }
            });
        }
        loop {
            let wait = Duration::from_secs(FIND_FOR as u64).saturating_sub(last_search.elapsed());
            if woken.recv_timeout(wait).is_ok() {
                changed(self.peers()?);
            }
            if last_search.elapsed() >= Duration::from_secs(FIND_FOR as u64) {
                search()?;
                last_search = Instant::now();
            }
        }
    }

    /// Connects to the display at `peer`, as a source: the link, and this
    /// computer's address on it, where the TV will reach it. The link goes
    /// when the [`Link`] drops, or this process ends.
    pub fn connect(&self, peer: &str) -> Result<(Link, Ipv4Addr), P2pError> {
        let hardware: String =
            Proxy::new(&self.connection, NM, peer, PEER)?.get_property("HwAddress")?;
        let settings = HashMap::from([
            (
                "connection",
                HashMap::from([
                    ("type", Value::from("wifi-p2p")),
                    ("id", Value::from("Domicile cast")),
                    ("autoconnect", Value::from(false)),
                ]),
            ),
            (
                "wifi-p2p",
                HashMap::from([
                    ("peer", Value::from(hardware)),
                    ("wfd-ies", Value::from(wfd::source_ies())),
                ]),
            ),
        ]);
        let options = HashMap::from([
            ("persist", Value::from("volatile")),
            ("bind-activation", Value::from("dbus-client")),
        ]);
        let manager = Proxy::new(&self.connection, NM, NM_PATH, NM)?;
        let peer_path = OwnedObjectPath::try_from(peer.to_string()).map_err(zbus::Error::from)?;
        let (_, active, _): (
            OwnedObjectPath,
            OwnedObjectPath,
            HashMap<String, OwnedValue>,
        ) = manager.call(
            "AddAndActivateConnection2",
            &(settings, &self.device, &peer_path, options),
        )?;
        let link = Link {
            connection: self.connection.clone(),
            active,
        };
        link.activated()?;
        let address = link.address()?;
        Ok((link, address))
    }
}

/// A connection to a TV, deactivated when dropped.
pub struct Link {
    connection: Connection,
    active: OwnedObjectPath,
}

impl Link {
    fn active(&self) -> Result<Proxy<'_>, P2pError> {
        Ok(Proxy::new(
            &self.connection,
            NM,
            self.active.as_str(),
            "org.freedesktop.NetworkManager.Connection.Active",
        )?)
    }

    /// Waits for the TV to accept.
    fn activated(&self) -> Result<(), P2pError> {
        let deadline = Instant::now() + ACCEPT_WITHIN;
        let active = self.active()?;
        while Instant::now() < deadline {
            match active.get_property::<u32>("State")? {
                ACTIVATED => return Ok(()),
                DEACTIVATED => return Err(P2pError::NotAccepted),
                _ => std::thread::sleep(Duration::from_millis(250)),
            }
        }
        Err(P2pError::NotAccepted)
    }

    /// This computer's IPv4 address on the link.
    fn address(&self) -> Result<Ipv4Addr, P2pError> {
        let config: OwnedObjectPath = self.active()?.get_property("Ip4Config")?;
        let ip4 = Proxy::new(
            &self.connection,
            NM,
            config.as_str(),
            "org.freedesktop.NetworkManager.IP4Config",
        )?;
        let data: Vec<HashMap<String, OwnedValue>> = ip4.get_property("AddressData")?;
        data.iter()
            .filter_map(|entry| entry.get("address"))
            .filter_map(|address| String::try_from(address.clone()).ok())
            .find_map(|address| address.parse().ok())
            .ok_or(P2pError::NoAddress)
    }
}

impl Drop for Link {
    fn drop(&mut self) {
        let _ = Proxy::new(&self.connection, NM, NM_PATH, NM).and_then(|manager| {
            manager
                .call_method("DeactivateConnection", &(&self.active,))
                .map(drop)
        });
    }
}
