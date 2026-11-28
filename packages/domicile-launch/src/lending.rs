//! A connection the control socket lends to something the compositor holds
//! while a command runs: an agent ([`crate::agent_lending`]) or a virtual
//! monitor ([`crate::monitor_lending`]). The client hears what it holds, or
//! why it was refused, and its requests go to it. Either side hanging up
//! ends it.

use std::fmt::Display;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::sync::Arc;

use crate::control::{to_line, Request, Response};

/// What the compositor holds for a lent connection.
pub trait Lending: Send + Sync + 'static {
    /// What the connection holds, as its client first hears of it.
    fn answer(&self) -> Response;

    /// Runs on its own thread until the compositor's side ends, telling
    /// `client` anything it should hear meanwhile. The client is hung up on
    /// once it returns.
    fn watch(&self, client: &mut UnixStream);

    /// Acts on one request the client sent: `Some(true)` to keep going,
    /// `Some(false)` to end, `None` for one this connection doesn't carry.
    fn heard(&self, request: Request) -> Option<bool>;

    /// Gives back what was held, once either side ends.
    fn give_back(&self);
}

/// Serves `client` what `held` holds, or tells it why it was refused, until
/// either side hangs up. A line that isn't a request this connection
/// carries is logged as `unexpected` says, and ends it rather than guess.
pub fn serve<H: Lending, E: Display>(
    held: Result<H, E>,
    mut client: UnixStream,
    lines: BufReader<UnixStream>,
    unexpected: impl Fn(&str) -> String,
) {
    let held = match held {
        Ok(held) => Arc::new(held),
        Err(why) => {
            // The client may be gone already; there is no one else to tell.
            let _ = client.write_all(
                to_line(&Response::Refused {
                    why: why.to_string(),
                })
                .as_bytes(),
            );
            return;
        }
    };
    let answered = client.write_all(to_line(&held.answer()).as_bytes());
    let watching = match (answered, client.try_clone()) {
        (Ok(()), Ok(mut telling)) => {
            let held = Arc::clone(&held);
            Some(std::thread::spawn(move || {
                held.watch(&mut telling);
                let _ = telling.shutdown(std::net::Shutdown::Both);
            }))
        }
        _ => None,
    };
    if watching.is_some() {
        for line in lines.lines() {
            let Ok(line) = line else { break };
            let going = serde_json::from_str::<Request>(line.trim())
                .ok()
                .and_then(|request| held.heard(request));
            match going {
                Some(true) => {}
                Some(false) => break,
                None => {
                    crate::launcher_log::error(&unexpected(&line));
                    break;
                }
            }
        }
    }
    held.give_back();
    if let Some(watching) = watching {
        let _ = watching.join();
    }
}
