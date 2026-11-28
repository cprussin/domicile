//! `domicile agent`: an agent, such as `domicile mcp`'s, let in to see and
//! use the desk while the command runs. See `docs/AGENTS.md`.
//!
//! The command sends [`Request::Agent`] to the control socket, which lends
//! the connection to [`admit`]. That asks the compositor, which asks the
//! user, and forwards each [`Request::AgentDid`] the command sends and each
//! change the user makes to what it reaches. Either
//! side hanging up ends it: the command's takes the agent off the shell's
//! list, the compositor's (the shell stopped it) hangs up on the command.

use std::io::{BufRead, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

use crate::compositor_socket::{agent, HeldAgent};
use crate::control::{to_line, Admission, Request, Response};
use crate::lending::{self, Lending};

/// How long the user has to answer: the compositor's minute, and some.
pub const DECIDING_WITHIN: Duration = Duration::from_secs(75);

/// Holds the agent `admission` asks for, from the compositor at `chrome`,
/// until either side hangs up. `patience` covers the user deciding.
pub fn admit(admission: Admission, chrome: &Path, patience: Duration) {
    let Admission {
        agent: name,
        lines,
        client,
    } = admission;
    lending::serve(
        agent(chrome, &name, Some(patience)),
        client,
        lines,
        |line| format!("an agent's client sent '{line}', so it was let go"),
    );
}

// Each change the user makes is told to the client as another
// `Response::Agent`. The shell stopping it hangs up on the client.
impl Lending for HeldAgent {
    fn answer(&self) -> Response {
        Response::Agent {
            reach: self.reach().clone(),
            session: self.session(),
        }
    }

    fn watch(&self, client: &mut UnixStream) {
        while let Some(reach) = self.changed() {
            let told = to_line(&Response::Agent {
                reach,
                session: self.session(),
            });
            if client.write_all(told.as_bytes()).is_err() {
                break;
            }
        }
    }

    fn heard(&self, request: Request) -> Option<bool> {
        match request {
            Request::AgentDid { said } => Some(self.did(said).is_ok()),
            _ => None,
        }
    }

    fn give_back(&self) {
        HeldAgent::give_back(self);
    }
}

/// Sends a [`Request::AgentDid`] to `to` for each line of `typed`, until it
/// ends. A blank line is skipped.
pub fn forward_actions(typed: impl BufRead, mut to: impl Write) -> std::io::Result<()> {
    for line in typed.lines() {
        let line = line?;
        let said = line.trim();
        if said.is_empty() {
            continue;
        }
        to.write_all(
            to_line(&Request::AgentDid {
                said: said.to_string(),
            })
            .as_bytes(),
        )?;
    }
    Ok(())
}
