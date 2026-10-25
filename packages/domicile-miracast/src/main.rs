//! `domicile-miracast`: the Miracast service, started by D-Bus on the shell's
//! first call. See `src/service.rs` for what it serves.

use std::sync::{Arc, Mutex};
use std::thread;

use domicile_miracast::cast::Buses;
use domicile_miracast::service::{self, Miracast, State};
use domicile_miracast::{mice, p2p::P2p};

fn main() -> Result<(), zbus::Error> {
    let state = Arc::new(Mutex::new(State::default()));
    let system = zbus::blocking::Connection::system()?;
    let session_bus = zbus::blocking::Connection::session()?;
    let buses = Arc::new(Buses {
        session: session_bus.clone(),
        system: system.clone(),
    });
    let served = zbus::blocking::connection::Builder::session()?
        .name(service::NAME)?
        .serve_at(
            service::PATH,
            Miracast {
                state: state.clone(),
                buses,
                name: hostname(),
            },
        )?
        .build()?;

    let finders = [
        {
            let (state, served, system) = (state.clone(), served.clone(), system.clone());
            thread::spawn(move || {
                let found = P2p::open(&system)
                    .and_then(|p2p| p2p.find(|peers| service::peers_found(&state, &served, peers)));
                if let Err(why) = found {
                    eprintln!("domicile-miracast: no TVs over Wi-Fi Direct: {why}");
                }
            })
        },
        {
            let (state, served) = (state.clone(), served.clone());
            thread::spawn(move || {
                let found = mice::find(&system, |displays| {
                    service::displays_found(&state, &served, displays)
                });
                if let Err(why) = found {
                    eprintln!("domicile-miracast: no TVs over the LAN: {why}");
                }
            })
        },
    ];
    for finder in finders {
        let _ = finder.join();
    }
    // Both finders gave up; casts already running carry on.
    loop {
        thread::park();
    }
}

/// This computer's name, as LAN TVs show it.
fn hostname() -> String {
    let mut name = [0u8; 256];
    // SAFETY: `gethostname` writes at most `name.len()` bytes into `name`.
    match unsafe { libc::gethostname(name.as_mut_ptr().cast(), name.len()) } {
        0 => String::from_utf8_lossy(name.split(|byte| *byte == 0).next().unwrap_or_default())
            .into_owned(),
        _ => "Domicile".to_string(),
    }
}
