//! One cast, start to end: the picture from the portal, the link to the TV,
//! the RTSP session the TV opens, and the pipeline that sends.

use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use zbus::blocking::Connection;

use crate::mice::{self, Display, MiceError};
use crate::p2p::{P2p, P2pError};
use crate::portal::{self, PortalError};
use crate::session::{self, Ended, SessionError};
use crate::stream::{self, Encoder};
use crate::wfd::RTSP_PORT;

/// How long the TV may take to open RTSP once linked.
const CONNECT_BACK_WITHIN: Duration = Duration::from_secs(30);

/// How often a wait looks at its stop flag.
const TICK: Duration = Duration::from_millis(250);

/// A TV to cast to.
#[derive(Debug, Clone)]
pub enum Tv {
    /// A Wi-Fi Direct peer, by its NetworkManager path.
    P2p(String),
    Lan(Display),
}

#[derive(Debug, thiserror::Error)]
pub enum CastError {
    #[error(transparent)]
    Portal(#[from] PortalError),
    #[error(transparent)]
    P2p(#[from] P2pError),
    #[error(transparent)]
    Mice(#[from] MiceError),
    #[error(transparent)]
    Session(#[from] SessionError),
    #[error("another cast is already running")]
    Busy,
    #[error(
        "the TV didn't connect back to this computer: a firewall may be blocking TCP port 7236"
    )]
    NoConnectBack,
    #[error("the picture couldn't be sent: {0}")]
    Pipeline(std::io::Error),
    #[error("the picture stopped: its encoder ended")]
    PipelineEnded,
    #[error("the cast was stopped before it started")]
    Stopped,
}

/// The buses a cast talks on.
pub struct Buses {
    pub session: Connection,
    pub system: Connection,
}

/// Casts to `tv` until it ends or `stop` is set, calling `started` once the
/// TV plays. `name` is what a LAN TV is told this computer is called.
pub fn run(
    buses: &Buses,
    tv: &Tv,
    name: &str,
    stop: &Arc<AtomicBool>,
    started: impl FnOnce(),
) -> Result<Ended, CastError> {
    // The picture first, so a cancel in the share picker touches no Wi-Fi.
    let shared = portal::share(&buses.session)?;
    let listener =
        TcpListener::bind(("0.0.0.0", RTSP_PORT)).map_err(|error| match error.kind() {
            std::io::ErrorKind::AddrInUse => CastError::Busy,
            _ => CastError::Pipeline(error),
        })?;
    // Held for the cast: dropping either ends the TV's link.
    let (_p2p_link, _announced, local) = match tv {
        Tv::P2p(peer) => {
            let (link, local) = P2p::open(&buses.system)?.connect(peer)?;
            (Some(link), None, IpAddr::V4(local))
        }
        Tv::Lan(display) => {
            let announced = mice::announce(&buses.system, display, name)?;
            let local = announced.local;
            (None, Some(announced), local)
        }
    };
    let (rtsp, peer) = accept(&listener, stop)?;
    let playing = session::start(rtsp, &local.to_string())?;
    let target = stream::Target {
        address: peer.ip(),
        negotiated: playing.negotiated.clone(),
        node: shared.node,
    };
    let child = stream::spawn(
        &target,
        shared.remote.try_clone().map_err(CastError::Pipeline)?,
        Encoder::found(),
    )
    .map_err(CastError::Pipeline)?;
    started();
    let pipeline = watch(child, stop.clone());
    let ended = playing.serve(stop);
    let died = pipeline.end();
    drop(shared);
    match (ended?, died) {
        (_, true) => Err(CastError::PipelineEnded),
        (ended, false) => Ok(ended),
    }
}

/// The TV's RTSP connection, once it opens one.
fn accept(listener: &TcpListener, stop: &AtomicBool) -> Result<(TcpStream, SocketAddr), CastError> {
    listener
        .set_nonblocking(true)
        .map_err(CastError::Pipeline)?;
    let deadline = Instant::now() + CONNECT_BACK_WITHIN;
    while Instant::now() < deadline {
        if stop.load(Ordering::Relaxed) {
            return Err(CastError::Stopped);
        }
        match listener.accept() {
            Ok((stream, peer)) => {
                stream.set_nonblocking(false).map_err(CastError::Pipeline)?;
                return Ok((stream, peer));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(TICK),
            Err(error) => return Err(CastError::Pipeline(error)),
        }
    }
    Err(CastError::NoConnectBack)
}

/// The pipeline, watched on its own thread: its exit sets the cast's stop
/// flag.
struct Watched {
    kill: mpsc::Sender<()>,
    done: thread::JoinHandle<bool>,
}

fn watch(mut child: std::process::Child, stop: Arc<AtomicBool>) -> Watched {
    let (kill, killed) = mpsc::channel();
    let done = thread::spawn(move || loop {
        if let Ok(Some(_)) = child.try_wait() {
            stop.store(true, Ordering::Relaxed);
            return true;
        }
        if killed.recv_timeout(TICK).is_ok() {
            let _ = child.kill();
            let _ = child.wait();
            return false;
        }
    });
    Watched { kill, done }
}

impl Watched {
    /// Ends the pipeline: whether it had ended on its own.
    fn end(self) -> bool {
        let _ = self.kill.send(());
        self.done.join().unwrap_or(true)
    }
}
