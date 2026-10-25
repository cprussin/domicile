//! TVs over the LAN: Miracast over Infrastructure (MS-MICE). A display
//! advertises `_display._tcp` over mDNS, which Avahi browses; a source tells
//! it, over TCP, that it is ready, and the display opens the RTSP session to
//! the source as it would over Wi-Fi Direct.

use std::collections::HashMap;
use std::io::{self, Write};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::time::Duration;

use zbus::blocking::{Connection, MessageIterator, Proxy};
use zbus::zvariant::OwnedObjectPath;
use zbus::MatchRule;

use crate::wfd::RTSP_PORT;

const AVAHI: &str = "org.freedesktop.Avahi";
const BROWSER: &str = "org.freedesktop.Avahi.ServiceBrowser";
const SERVICE: &str = "_display._tcp";
/// Any interface, and IPv4: MICE displays take RTSP over IPv4.
const ANY_INTERFACE: i32 = -1;
const IPV4: i32 = 0;

const VERSION: u8 = 1;
const SOURCE_READY: u8 = 1;
const STOP_PROJECTION: u8 = 2;
const FRIENDLY_NAME: u8 = 0;
const RTSP_PORT_TLV: u8 = 2;
const SOURCE_ID: u8 = 3;

const CONNECT_WITHIN: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error)]
pub enum MiceError {
    #[error(transparent)]
    Bus(#[from] zbus::Error),
    #[error("mDNS isn't running on this computer (Avahi): {0}")]
    NoAvahi(zbus::Error),
    #[error("the TV is no longer on the network")]
    Gone,
    #[error("the TV didn't take the connection: {0}")]
    Unreachable(io::Error),
}

impl From<zbus::fdo::Error> for MiceError {
    fn from(error: zbus::fdo::Error) -> Self {
        MiceError::Bus(error.into())
    }
}

/// A display Avahi saw, by the service name it advertises.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Display {
    pub name: String,
    interface: i32,
    domain: String,
}

/// Browses `_display._tcp` until the process ends, calling `changed` with the
/// displays each time one comes or goes.
pub fn find(connection: &Connection, changed: impl Fn(Vec<Display>)) -> Result<(), MiceError> {
    // Matched before the browser exists: Avahi may announce what it has
    // cached before a match on the browser's own path could be added.
    let rule = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface(BROWSER)?
        .build();
    let signals = MessageIterator::for_match_rule(rule, connection, None)?;
    let server = Proxy::new(connection, AVAHI, "/", "org.freedesktop.Avahi.Server")
        .map_err(MiceError::NoAvahi)?;
    let browser: OwnedObjectPath = server
        .call(
            "ServiceBrowserNew",
            &(ANY_INTERFACE, IPV4, SERVICE, "", 0u32),
        )
        .map_err(MiceError::NoAvahi)?;
    let mut displays: HashMap<String, Display> = HashMap::new();
    changed(Vec::new());
    for message in signals {
        let message = message?;
        let header = message.header();
        if header.path().map(|path| path.as_str()) != Some(browser.as_str()) {
            continue;
        }
        let member = header.member().map(|member| member.to_string());
        let item = message
            .body()
            .deserialize::<(i32, i32, String, String, String, u32)>();
        let (interface, _, name, _, domain, _) = match item {
            Ok(item) => item,
            Err(_) => continue,
        };
        let before = displays.len();
        match member.as_deref() {
            Some("ItemNew") => {
                displays.insert(
                    name.clone(),
                    Display {
                        name,
                        interface,
                        domain,
                    },
                );
            }
            Some("ItemRemove") => {
                displays.remove(&name);
            }
            _ => continue,
        }
        if displays.len() != before {
            let mut listed: Vec<Display> = displays.values().cloned().collect();
            listed.sort_by(|a, b| a.name.cmp(&b.name));
            changed(listed);
        }
    }
    Ok(())
}

/// `ResolveService`'s reply: interface, protocol, name, type, domain, host,
/// address protocol, address, port, TXT records, flags.
type Resolved = (
    i32,
    i32,
    String,
    String,
    String,
    String,
    i32,
    String,
    u16,
    Vec<Vec<u8>>,
    u32,
);

/// Where `display` takes MICE connections.
fn resolve(connection: &Connection, display: &Display) -> Result<SocketAddr, MiceError> {
    let server = Proxy::new(connection, AVAHI, "/", "org.freedesktop.Avahi.Server")?;
    let resolved: Resolved = server
        .call(
            "ResolveService",
            &(
                display.interface,
                IPV4,
                &display.name,
                SERVICE,
                &display.domain,
                IPV4,
                0u32,
            ),
        )
        .map_err(|_| MiceError::Gone)?;
    let address: IpAddr = resolved.7.parse().map_err(|_| MiceError::Gone)?;
    Ok(SocketAddr::new(address, resolved.8))
}

/// A display that was told this source is ready.
pub struct Announced {
    stream: TcpStream,
    id: [u8; 16],
    name: String,
    /// This computer's address, as the display reaches it.
    pub local: IpAddr,
}

/// Tells `display` that this source, named `name`, is ready for it to open
/// RTSP to.
pub fn announce(
    connection: &Connection,
    display: &Display,
    name: &str,
) -> Result<Announced, MiceError> {
    let address = resolve(connection, display)?;
    let mut stream =
        TcpStream::connect_timeout(&address, CONNECT_WITHIN).map_err(MiceError::Unreachable)?;
    let local = stream.local_addr().map_err(MiceError::Unreachable)?.ip();
    let id = source_id();
    stream
        .write_all(&source_ready(name, &id))
        .map_err(MiceError::Unreachable)?;
    Ok(Announced {
        stream,
        id,
        name: name.to_string(),
        local,
    })
}

impl Drop for Announced {
    fn drop(&mut self) {
        let _ = self
            .stream
            .write_all(&stop_projection(&self.name, &self.id));
    }
}

/// A random id for this cast.
fn source_id() -> [u8; 16] {
    let mut id = [0u8; 16];
    // SAFETY: `getrandom` writes at most `id.len()` bytes into `id`.
    let written = unsafe { libc::getrandom(id.as_mut_ptr().cast(), id.len(), 0) };
    if written != id.len() as isize {
        // Any id will do: it only tells this source's casts apart.
        id[..8].copy_from_slice(&std::process::id().to_be_bytes().repeat(2));
    }
    id
}

fn tlv(kind: u8, value: &[u8]) -> Vec<u8> {
    let length = u16::try_from(value.len()).unwrap_or(u16::MAX);
    [&[kind][..], &length.to_be_bytes(), value].concat()
}

/// The friendly name, which MICE carries as UTF-16LE.
fn utf16(text: &str) -> Vec<u8> {
    text.encode_utf16().flat_map(u16::to_le_bytes).collect()
}

fn message(command: u8, tlvs: &[Vec<u8>]) -> Vec<u8> {
    let body = tlvs.concat();
    let size = u16::try_from(4 + body.len()).unwrap_or(u16::MAX);
    [&size.to_be_bytes()[..], &[VERSION, command], &body].concat()
}

fn source_ready(name: &str, id: &[u8; 16]) -> Vec<u8> {
    message(
        SOURCE_READY,
        &[
            tlv(FRIENDLY_NAME, &utf16(name)),
            tlv(RTSP_PORT_TLV, &RTSP_PORT.to_be_bytes()),
            tlv(SOURCE_ID, id),
        ],
    )
}

fn stop_projection(name: &str, id: &[u8; 16]) -> Vec<u8> {
    message(
        STOP_PROJECTION,
        &[tlv(FRIENDLY_NAME, &utf16(name)), tlv(SOURCE_ID, id)],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_the_source_is_ready_on_the_rtsp_port() {
        let id = [7; 16];

        let ready = source_ready("Ab", &id);

        assert_eq!(
            ready,
            [
                &[0x00, 0x23, VERSION, SOURCE_READY][..],
                &[FRIENDLY_NAME, 0x00, 0x04, b'A', 0, b'b', 0],
                &[RTSP_PORT_TLV, 0x00, 0x02, 0x1c, 0x44],
                &[SOURCE_ID, 0x00, 0x10],
                &id,
            ]
            .concat()
        );
    }

    #[test]
    fn stops_by_the_same_id() {
        let stop = stop_projection("A", &[1; 16]);

        assert_eq!(&stop[2..4], &[VERSION, STOP_PROJECTION]);
        assert_eq!(
            usize::from(u16::from_be_bytes([stop[0], stop[1]])),
            stop.len()
        );
        assert!(stop.ends_with(&[1; 16]));
    }
}
