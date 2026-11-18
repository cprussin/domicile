//! Agents, such as one connected through `domicile mcp`, asking to see and
//! use the desk, as `SystemRequest::Agent` describes.
//!
//! The shell asks the user with a [`PortalKind::Agent`] dialog: the whole
//! desk, or only some windows. An agent let in is listed as a
//! [`CapturingKind::Agent`], with what it did last, until its caller lets
//! go or the shell stops it.
//!
//! Domicile's own, not a portal's: no application asks over D-Bus. See
//! `docs/AGENTS.md`.

use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use domicile_host::system::{AgentLease, AgentStopped, LetIn};
use domicile_protocol::{
    AgentAction, AgentDialog, AgentReach, AgentSession, AgentWindow, CapturingKind, ListedWindow,
    PortalAnswer, PortalKind, SystemError, SystemErrorKind, AGENT_ACTIONS,
};
use tracing::debug;

use super::queue::{ask_noting, Queue};

/// How long the user has to answer before the ask counts as canceled.
pub const PATIENCE: Duration = Duration::from_secs(60);

/// The app id an agent's dialog and session go under: none, since the agent
/// is not an application the desk knows. The shell names it by its body.
const NO_APP: &str = "";

/// Asks the user whether `agent` may see and use the desk, offering `open`
/// but private browser windows, and lists it while it may. Blocks until the
/// user answers, or `patience` passes. `clock` is the time in milliseconds
/// since the Unix epoch, for its actions. `stop` runs if the shell stops it.
pub fn let_in(
    queue: &Arc<Queue>,
    agent: String,
    open: Vec<ListedWindow>,
    clock: Arc<dyn Fn() -> u64 + Send + Sync>,
    patience: Duration,
    stop: AgentStopped,
) -> Result<LetIn, SystemError> {
    let offered: Vec<AgentWindow> = open
        .into_iter()
        .filter(|window| !window.private)
        .map(|window| AgentWindow {
            id: window.id,
            kind: window.kind,
            title: window.title,
            app: window.app,
        })
        .collect();
    let kind = PortalKind::Agent(AgentDialog {
        agent: agent.clone(),
        windows: offered.clone(),
    });
    let reach = match asked(queue, kind, patience) {
        PortalAnswer::Agent { reach } => offered_only(reach, &offered)?,
        PortalAnswer::Canceled => return Err(canceled("the user did not let it in")),
        PortalAnswer::Refused => {
            return Err(canceled(
                "nobody answered: no shell showed the dialog, or the user left it for a minute",
            ))
        }
        answer => unreachable!("the queue gives an agent's dialog no {answer:?}"),
    };
    debug!(%agent, ?reach, "an agent was let in");
    let session = Arc::new(Mutex::new(AgentSession {
        agent,
        reach: reach.clone(),
        actions: Vec::new(),
    }));
    let id = queue.begin(
        NO_APP.into(),
        CapturingKind::Agent(session.lock().unwrap().clone()),
        stop,
    );
    Ok(LetIn {
        reach,
        lease: Box::new(Lease {
            id,
            queue: Arc::clone(queue),
            session,
            clock,
        }),
    })
}

/// Puts `kind` to the shell and waits for its answer, withdrawing it after
/// `patience`, which answers [`PortalAnswer::Refused`].
fn asked(queue: &Arc<Queue>, kind: PortalKind, patience: Duration) -> PortalAnswer {
    let (answered, answer) = channel();
    let asking = Arc::clone(queue);
    let (submitted, id) = channel();
    thread::spawn(move || {
        let answer = zbus::block_on(ask_noting(&asking, NO_APP.into(), "", kind, |asked| {
            let _ = submitted.send(asked);
        }));
        let _ = answered.send(answer);
    });
    match answer.recv_timeout(patience) {
        Ok(answer) => answer,
        Err(_) => {
            // Answered meanwhile, the withdrawal is dropped and the answer
            // stands.
            if let Ok(id) = id.try_recv() {
                queue.withdraw(id);
            }
            answer.recv().unwrap_or(PortalAnswer::Refused)
        }
    }
}

/// `reach` with each window the dialog offered as offered, or why it is not
/// one the dialog offered.
fn offered_only(reach: AgentReach, offered: &[AgentWindow]) -> Result<AgentReach, SystemError> {
    match reach {
        AgentReach::Desk => Ok(AgentReach::Desk),
        AgentReach::Windows { windows } => windows
            .into_iter()
            .map(|picked| {
                offered
                    .iter()
                    .find(|window| window.id == picked.id)
                    .cloned()
                    .ok_or_else(|| SystemError {
                        kind: SystemErrorKind::InvalidInput,
                        message: format!("the shell picked {}, which was not offered", picked.id),
                    })
            })
            .collect::<Result<_, _>>()
            .map(|windows| AgentReach::Windows { windows }),
    }
}

fn canceled(why: &str) -> SystemError {
    SystemError {
        kind: SystemErrorKind::Canceled,
        message: why.into(),
    }
}

/// An agent's listing, which ends when dropped.
struct Lease {
    id: u32,
    queue: Arc<Queue>,
    session: Arc<Mutex<AgentSession>>,
    clock: Arc<dyn Fn() -> u64 + Send + Sync>,
}

impl AgentLease for Lease {
    fn did(&self, said: String) {
        let mut session = self.session.lock().unwrap();
        session.actions.insert(
            0,
            AgentAction {
                said,
                at_ms: (self.clock)(),
            },
        );
        session.actions.truncate(AGENT_ACTIONS);
        let listed = session.clone();
        // Gone already when the shell stopped it meanwhile.
        let _ = self.queue.revise_session(self.id, move |kind| {
            *kind = CapturingKind::Agent(listed);
        });
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        self.queue.end(self.id);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::{channel, Receiver};

    use domicile_protocol::{Capturing, PortalRequest, WindowKind};

    use super::*;

    fn window(id: &str, private: bool) -> ListedWindow {
        ListedWindow {
            id: id.into(),
            kind: if private {
                WindowKind::Browser
            } else {
                WindowKind::Native
            },
            title: format!("{id}'s title"),
            app: None,
            pid: None,
            size: None,
            focused: false,
            urgent: false,
            url: None,
            private,
            engine_id: None,
        }
    }

    fn offered(id: &str) -> AgentWindow {
        AgentWindow {
            id: id.into(),
            kind: WindowKind::Native,
            title: format!("{id}'s title"),
            app: None,
        }
    }

    /// What a queue publishes: its dialogs and its sessions.
    type Published = Receiver<(Vec<PortalRequest>, Vec<Capturing>)>;

    /// What [`let_in_answering`] ends with: the agent let in or why not, the
    /// queue, what it published, and the shell's stops.
    type Answered = (
        Result<LetIn, SystemError>,
        Arc<Queue>,
        Published,
        Receiver<()>,
    );

    /// A queue a shell listens to, and what it publishes.
    fn listened() -> (Arc<Queue>, Published) {
        let queue = Arc::new(Queue::default());
        let (publish, published) = channel();
        queue.listen(
            move |items, capturing| {
                let _ = publish.send((items, capturing));
            },
            || true,
            |_| None,
        );
        (queue, published)
    }

    /// Lets `agent` in on a thread with `open` windows, and answers its dialog
    /// with `answer` once it is up.
    fn let_in_answering(
        open: Vec<ListedWindow>,
        answer: impl FnOnce(&PortalRequest) -> PortalAnswer + Send + 'static,
    ) -> Answered {
        let (queue, published) = listened();
        let (stop, stopped) = channel();
        let asking = Arc::clone(&queue);
        let letting = thread::spawn(move || {
            let_in(
                &asking,
                "Claude Code".into(),
                open,
                Arc::new(|| 7),
                PATIENCE,
                Box::new(move || stop.send(()).expect("the test listens")),
            )
        });
        let request = loop {
            let (items, _) = published.recv().expect("the dialog is published");
            if let Some(request) = items.into_iter().next() {
                break request;
            }
        };
        queue.answer(request.id, answer(&request));
        (
            letting.join().expect("letting in does not panic"),
            queue,
            published,
            stopped,
        )
    }

    #[test]
    fn the_dialog_offers_every_window_but_private_ones() {
        let (let_in, ..) = let_in_answering(
            vec![window("a", false), window("b", true), window("c", false)],
            |request| {
                assert_eq!(
                    request.kind,
                    PortalKind::Agent(AgentDialog {
                        agent: "Claude Code".into(),
                        windows: vec![offered("a"), offered("c")],
                    })
                );
                PortalAnswer::Canceled
            },
        );
        assert_eq!(
            let_in.err().map(|error| error.kind),
            Some(SystemErrorKind::Canceled)
        );
    }

    #[test]
    fn an_agent_let_in_is_listed_with_what_it_did_until_its_lease_drops() {
        let (let_in, queue, published, _stopped) =
            let_in_answering(vec![window("a", false)], |_| PortalAnswer::Agent {
                reach: AgentReach::Windows {
                    windows: vec![offered("a")],
                },
            });
        let let_in = let_in.expect("the user let it in");
        assert_eq!(
            let_in.reach,
            AgentReach::Windows {
                windows: vec![offered("a")]
            }
        );
        let_in.lease.did("Clicked \"Save\" in Notes".into());
        let (_, capturing) = published.try_iter().last().expect("the session is listed");
        assert_eq!(
            capturing[0].kind,
            CapturingKind::Agent(AgentSession {
                agent: "Claude Code".into(),
                reach: let_in.reach.clone(),
                actions: vec![AgentAction {
                    said: "Clicked \"Save\" in Notes".into(),
                    at_ms: 7,
                }],
            })
        );
        drop(let_in.lease);
        let (_, capturing) = published.try_iter().last().expect("the end is published");
        assert!(capturing.is_empty());
        drop(queue);
    }

    #[test]
    fn an_agent_lists_only_its_last_few_actions() {
        let (let_in, _queue, published, _stopped) =
            let_in_answering(vec![], |_| PortalAnswer::Agent {
                reach: AgentReach::Desk,
            });
        let let_in = let_in.expect("the user let it in");
        for done in 0..AGENT_ACTIONS + 2 {
            let_in.lease.did(format!("did {done}"));
        }
        let (_, capturing) = published.try_iter().last().expect("the session is listed");
        let CapturingKind::Agent(session) = &capturing[0].kind else {
            panic!("an agent's session is listed, not {capturing:?}");
        };
        assert_eq!(session.actions.len(), AGENT_ACTIONS);
        assert_eq!(
            session.actions[0].said,
            format!("did {}", AGENT_ACTIONS + 1)
        );
    }

    #[test]
    fn the_shell_stopping_an_agent_tells_its_caller() {
        let (let_in, queue, published, stopped) =
            let_in_answering(vec![], |_| PortalAnswer::Agent {
                reach: AgentReach::Desk,
            });
        let _let_in = let_in.expect("the user let it in");
        let (_, capturing) = published.try_iter().last().expect("the session is listed");
        queue.answer(capturing[0].id, PortalAnswer::Stop);
        assert_eq!(stopped.try_recv(), Ok(()));
    }

    #[test]
    fn a_window_the_dialog_did_not_offer_is_refused() {
        let (let_in, ..) = let_in_answering(vec![window("a", false)], |_| PortalAnswer::Agent {
            reach: AgentReach::Windows {
                windows: vec![offered("z")],
            },
        });
        assert_eq!(
            let_in.err().map(|error| error.kind),
            Some(SystemErrorKind::InvalidInput)
        );
    }

    #[test]
    fn a_dialog_nobody_answers_is_withdrawn_and_canceled() {
        let (queue, published) = listened();
        let refused = let_in(
            &queue,
            "Claude Code".into(),
            vec![],
            Arc::new(|| 0),
            Duration::from_millis(50),
            Box::new(|| {}),
        );
        assert_eq!(
            refused.err().map(|error| error.kind),
            Some(SystemErrorKind::Canceled)
        );
        let (items, _) = published
            .try_iter()
            .last()
            .expect("the queue was published");
        assert!(items.is_empty(), "{items:?}");
    }
}
