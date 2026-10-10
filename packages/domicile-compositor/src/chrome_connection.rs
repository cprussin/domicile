//! One chrome's connection: reading its messages, answering what it can
//! without the Wayland thread, and forwarding the rest there.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread;

use domicile_host::ipc::{apply_chrome_message, parse_chrome, to_line};
use domicile_host::system::{locked_out, reach, Handled, System};
use domicile_launch::handshake::Handshake;
use domicile_protocol::{ChromeMessage, HostMessage, SystemRequest, Theme};
use tracing::{debug, warn};

use crate::chrome_hub::{Chrome, ChromeHub};
use crate::lock::Asked;
use crate::peer_process::peer_pid;
use crate::scale::output_scale;
use crate::{
    chrome_key, desktop_environment, grepped, home_directory, say_what_the_lock_refused,
    ClientRequest,
};

/// A chrome request answered on its own connection thread.
///
/// These answers must not wait for a frame on the Wayland thread. See
/// [`answer_on_the_connection`]. The lock refuses requests from both this and
/// [`ClientRequest`]; see [`crate::lock::Asked`].
pub enum ConnectionRequest {
    SearchFiles { query: String },
    SetTheme { theme: Theme },
}

/// Write a message's responses to the connection that asked, in order.
///
/// Returns false if the socket is gone, which ends the connection. Separate
/// from `read_chrome_messages` so tests can exercise [`freshened`] directly.
fn write_responses(
    hub: &ChromeHub,
    writer: &Arc<Mutex<UnixStream>>,
    responses: Vec<HostMessage>,
) -> bool {
    // Return before taking the writer lock. Most input messages have no
    // response, and taking the lock would block this reader behind
    // `serve_outbound` when a chrome is not reading. The compositor would then
    // drop everything that chrome sends. Tested by
    // `an_answer_with_nothing_in_it_does_not_wait_for_the_writer` and
    // `tests/stuck_keys.rs`.
    if responses.is_empty() {
        return true;
    }
    let mut writer = writer.lock().unwrap();
    for message in responses {
        let message = freshened(hub, message);
        if writer.write_all(to_line(&message).as_bytes()).is_err() {
            return false;
        }
        let _ = writer.flush();
    }
    true
}

/// Replace a `displays` response with the current desktop.
///
/// Responses are built under the `host` lock and written later. If `set_output`
/// broadcasts a new desktop in between, the stale handshake copy would arrive
/// last and nothing would correct it.
///
/// Broadcasts are ordered by the outbound queue:
/// [`crate::DomicileCompositor::set_output`] describes and broadcasts on the
/// Wayland thread, so a stale `displays` always has a newer one queued behind
/// it. This function covers the one gap, a response written by another thread.
/// Every describe must be followed by a broadcast; the startup describe in
/// `main` is the only exception, and it runs before any connection thread
/// exists.
///
/// Other messages pass through unchanged.
fn freshened(hub: &ChromeHub, message: HostMessage) -> HostMessage {
    if !matches!(message, HostMessage::Displays { .. }) {
        return message;
    }
    let fresh = hub.host.lock().unwrap().describe_desktop();
    // Logged because a chrome draws no windows until it knows the displays, and
    // only this side can tell that apart from a chrome ignoring the host. The
    // count lets readers, including `guard-shell.sh`, tell an empty desktop
    // from a described one.
    let HostMessage::Displays { displays } = fresh else {
        unreachable!("describe_desktop returns Displays and nothing else");
    };
    debug!("told the chrome about {} display(s)", displays.len());
    HostMessage::Displays { displays }
}

/// Maximum file search results sent. `matched` still reports the full count.
const FOUND: usize = 200;

/// Bind the chrome protocol socket.
///
/// Called on the main thread so a failed bind is fatal: the chrome protocol is
/// required. The error names the path because the common failure is a deep
/// `XDG_RUNTIME_DIR` exceeding the ~108-byte `sun_path` limit.
pub fn bind_chrome_socket(
    path: &std::path::Path,
) -> Result<UnixListener, Box<dyn std::error::Error>> {
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path).map_err(|err| {
        format!(
            "cannot bind the chrome protocol socket at {}: {err}",
            path.display()
        )
    })?;
    debug!(?path, "chrome protocol socket up");
    Ok(listener)
}

/// Accept chrome connections, one thread each, all sharing the hub's
/// [`Host`](domicile_host::Host).
pub fn serve_chrome(hub: Arc<ChromeHub>, listener: UnixListener, handshake: Arc<Handshake>) {
    for stream in listener.incoming().flatten() {
        let writer = Arc::new(Mutex::new(match stream.try_clone() {
            Ok(w) => w,
            Err(_) => continue,
        }));
        // Not a broadcast target until its `hello` agrees a protocol version.
        // `read_chrome_messages` adds it then.
        debug!("chrome client connected");
        handshake.connected();
        let hub = hub.clone();
        let handshake = handshake.clone();
        thread::spawn(move || chrome_connection(hub, stream, writer, handshake));
    }
}

/// Serve one chrome connection until EOF, then drop its writer.
///
/// Dead writers are otherwise pruned only by a failed broadcast, which an idle
/// desktop never sends. Each page reload opens a new connection, so they would
/// accumulate.
fn chrome_connection(
    hub: Arc<ChromeHub>,
    stream: UnixStream,
    writer: Arc<Mutex<UnixStream>>,
    handshake: Arc<Handshake>,
) {
    read_chrome_messages(&hub, stream, &writer, &handshake);
    hub.chromes
        .lock()
        .unwrap()
        .retain(|held| !Arc::ptr_eq(&held.writer, &writer));
    debug!("chrome client disconnected");
}

fn read_chrome_messages(
    hub: &Arc<ChromeHub>,
    stream: UnixStream,
    writer: &Arc<Mutex<UnixStream>>,
    handshake: &Arc<Handshake>,
) {
    // Read before the reader takes the stream. `SO_PEERCRED` is fixed at
    // `connect(2)`, so once per connection is enough. See
    // [`crate::which_engine`].
    let served_by = peer_pid(&stream);
    let reader = BufReader::new(stream);
    // Dropped when the connection ends, which kills the page's processes.
    let system = System::new(
        // A user with no home gets `/`, as `login` gives them.
        home_directory().unwrap_or_else(|| "/".into()),
        desktop_environment(
            &hub.wayland_display,
            std::env::var_os("LD_LIBRARY_PATH").as_deref(),
        ),
        {
            let writer = writer.clone();
            move |message| {
                // A failed write means the page is gone; this connection's
                // reader then ends and drops `system`.
                let mut writer = writer.lock().unwrap();
                let _ = writer.write_all(to_line(&message).as_bytes());
                let _ = writer.flush();
            }
        },
    )
    .screenshotting_with({
        let portals = hub.portals.clone();
        move |file| portals.screenshot(file)
    })
    .sharing_shell_commands(hub.shell_commands.clone());
    let mut ready = false;
    // Whether this connection is in the broadcast list. Separate from `ready`
    // because a socket can send `hello` twice, and the writer must not be added
    // twice.
    let mut joined = false;
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let said = parse_chrome(line.trim());
        // Log every frame verbatim, except `unlock`, which carries the
        // passphrase. That one is logged parsed, and its `Debug` redacts the
        // passphrase (`domicile_protocol::Passphrase`).
        //
        // A frame that fails to parse is still logged verbatim. A passphrase
        // only reaches that path if `unlock` itself is misspelled or malformed.
        if matches!(said, Ok(ChromeMessage::Unlock { .. })) {
            tracing::trace!("chrome -> host chrome_msg=an unlock, whose passphrase is not printed");
        } else {
            tracing::trace!(chrome_msg = %line.trim(), "chrome -> host");
        }
        let responses = match said {
            // `hello` means a page started (including after a reload or crash),
            // so it resets what the compositor records the chrome as holding. A
            // stale record would leave a hole in the page where an idle
            // client's window should be.
            Ok(ChromeMessage::Hello { protocol_version }) => {
                // Scoped so the `host` guard drops before `chromes` is locked
                // below. Otherwise this can deadlock: `serve_outbound` locks
                // `chromes` then a `writer`, and `write_responses` locks a
                // `writer` then `host` (via `freshened`). Needs two chromes to
                // trigger, so no test catches it. The same applies to the
                // `chromes` lock in the `else` arm.
                let responses = {
                    let mut host = hub.host.lock().unwrap();
                    apply_chrome_message(
                        &mut host,
                        &mut ready,
                        ChromeMessage::Hello { protocol_version },
                    )
                };
                if ready {
                    // Counted so the handshake watchdog can tell "no page came"
                    // from "a page came and its version was refused".
                    handshake.agreed();
                    // Join only after the version is agreed: broadcasts use
                    // this build's protocol. A refused chrome gets only its
                    // `welcome`.
                    if !joined {
                        hub.chromes.lock().unwrap().push(Chrome {
                            writer: writer.clone(),
                        });
                        joined = true;
                        debug!("chrome agreed the protocol; it now gets the desktop");
                    }
                    // Announce after joining. The Wayland thread announces open
                    // windows by broadcast, so a chrome not yet in the list
                    // would miss them. Tested by
                    // `a_chrome_that_connects_late_is_told_about_a_window_already_open`
                    // in `tests/apps.rs`, though the race is narrow and the
                    // test needs an added delay to catch a swap.
                    hub.send_request(ClientRequest::ChromeHello { served_by });
                } else if joined {
                    // This connection agreed a version earlier and has now
                    // named one this build cannot speak. Stop broadcasting to
                    // it. A later good `hello` rejoins it.
                    hub.chromes
                        .lock()
                        .unwrap()
                        .retain(|held| !Arc::ptr_eq(&held.writer, writer));
                    joined = false;
                    debug!(
                        "chrome took its protocol agreement back; it no longer gets the desktop"
                    );
                }
                responses
            }
            // Sent to the Wayland thread so a locked desktop can refuse it.
            Ok(ChromeMessage::Spawn { command }) => {
                hub.send_request(ClientRequest::Spawn { command });
                Vec::new()
            }
            Ok(ChromeMessage::SetTheme { theme }) => {
                answer_on_the_connection(hub, ConnectionRequest::SetTheme { theme })
            }
            // The Wayland thread runs the theme turnover and its deadline
            // timer.
            Ok(ChromeMessage::ThemeCaptured { theme }) => {
                hub.send_request(ClientRequest::ThemeCaptured {
                    chrome: chrome_key(writer),
                    theme,
                });
                Vec::new()
            }
            // Handled by the compositor, which owns the seat's clipboard and
            // the history. No response; the shell sees the next `clipboard`
            // broadcast.
            Ok(ChromeMessage::CopyClipboardEntry { entry }) => {
                hub.send_request(ClientRequest::CopyClipboardEntry { entry });
                Vec::new()
            }
            // Sent to the Wayland thread so a locked desktop can refuse it.
            Ok(ChromeMessage::ActivateTrayItem { id, action }) => {
                hub.send_request(ClientRequest::ActivateTrayItem { id, action });
                Vec::new()
            }
            // Sent to the Wayland thread so a locked desktop can refuse it,
            // since an action can raise a window. The shell sees the result in
            // the next `notifications`.
            Ok(ChromeMessage::DismissNotifications { ids }) => {
                hub.send_request(ClientRequest::DismissNotifications { ids });
                Vec::new()
            }
            Ok(ChromeMessage::InvokeNotificationAction { id, action }) => {
                hub.send_request(ClientRequest::InvokeNotificationAction { id, action });
                Vec::new()
            }
            // Sent to the Wayland thread so a locked desktop can refuse it:
            // an answer grants an application what it asked for.
            Ok(ChromeMessage::AnswerPortalRequest { id, answer }) => {
                hub.send_request(ClientRequest::AnswerPortalRequest { id, answer });
                Vec::new()
            }
            Ok(ChromeMessage::SearchFiles { query }) => {
                answer_on_the_connection(hub, ConnectionRequest::SearchFiles { query })
            }
            Ok(ChromeMessage::SystemRequest { id, request }) => {
                call_the_system(hub, &system, id, request)
            }
            Ok(ChromeMessage::PointerMotion { app_id, x, y }) => {
                hub.send_request(ClientRequest::PointerMotion { app_id, x, y });
                Vec::new()
            }
            Ok(ChromeMessage::PointerLeave { .. }) => {
                hub.send_request(ClientRequest::PointerLeave);
                Vec::new()
            }
            Ok(ChromeMessage::PointerButton {
                button, pressed, ..
            }) => {
                hub.send_request(ClientRequest::PointerButton { button, pressed });
                Vec::new()
            }
            Ok(ChromeMessage::PointerAxis {
                dx,
                dy,
                v120_x,
                v120_y,
                ..
            }) => {
                hub.send_request(ClientRequest::PointerAxis {
                    dx,
                    dy,
                    v120_x,
                    v120_y,
                });
                Vec::new()
            }
            Ok(ChromeMessage::Key {
                keycode, pressed, ..
            }) => {
                hub.send_request(ClientRequest::Key { keycode, pressed });
                Vec::new()
            }
            // No response here. A correct passphrase broadcasts `locked: false`
            // to every chrome from the Wayland thread, so all monitors unlock
            // together. A refusal is logged without the passphrase; see
            // `crate::lock`.
            Ok(ChromeMessage::Unlock { passphrase }) => {
                hub.send_request(ClientRequest::Unlock { passphrase });
                Vec::new()
            }
            // Handled on the Wayland thread, which holds the lock. The response
            // is the `locked` broadcast.
            Ok(ChromeMessage::Lock) => {
                hub.send_request(ClientRequest::Lock);
                Vec::new()
            }
            // The chrome's density sets the output scale, which is Wayland
            // state, not something `Host` models.
            Ok(ChromeMessage::SetDevicePixelRatio { ratio }) => {
                hub.send_request(ClientRequest::SetOutputScale {
                    ratio,
                    scale: output_scale(ratio, hub.max_scale.load(Ordering::Relaxed)),
                });
                Vec::new()
            }
            // The desktop is the chrome's browser window, which the compositor
            // cannot see. This message is its only source for the desktop size.
            Ok(ChromeMessage::SetDesktopSize { size }) => {
                hub.send_request(ClientRequest::SetOutputSize {
                    logical: (size[0].round() as i32, size[1].round() as i32),
                });
                Vec::new()
            }
            // Which displays a window is on is Wayland state, not something
            // `Host` models.
            Ok(ChromeMessage::SetAppBounds {
                app_id,
                position: [x, y],
                size: [width, height],
            }) => {
                hub.send_request(ClientRequest::SetAppBounds {
                    app_id,
                    bounds: domicile_scene::Bounds {
                        min: domicile_scene::Point::new(x, y),
                        max: domicile_scene::Point::new(x + width, y + height),
                    },
                });
                Vec::new()
            }
            // `Host` decides focus and the seat follows its answer, so the
            // keyboard and the page always agree on the focused window.
            Ok(ChromeMessage::FocusApp { app_id }) => {
                let (out, holder) = {
                    let mut host = hub.host.lock().unwrap();
                    let out = apply_chrome_message(
                        &mut host,
                        &mut ready,
                        ChromeMessage::FocusApp {
                            app_id: app_id.clone(),
                        },
                    );
                    (out, host.focus_holder())
                };
                if holder.as_deref() != Some(app_id.as_str()) {
                    debug!(app_id = %app_id, "keyboard focus -> a window this compositor does not know; the keyboard stays where it was");
                }
                hub.send_request(ClientRequest::KeyboardFocus { app_id: holder });
                out
            }
            // Only the client's toplevel can close it. `app_closed` removes the
            // window once it goes away.
            Ok(ChromeMessage::CloseApp { app_id }) => {
                hub.send_request(ClientRequest::CloseApp { app_id });
                Vec::new()
            }
            Ok(ChromeMessage::FocusChrome) => {
                hub.send_request(ClientRequest::KeyboardFocus { app_id: None });
                let mut host = hub.host.lock().unwrap();
                apply_chrome_message(&mut host, &mut ready, ChromeMessage::FocusChrome)
            }
            // No catch-all, so a new message type is a compile error here.
            //
            // An unparseable message is dropped, so a chrome one version out of
            // step cannot crash the compositor, but it is logged.
            Err(err) => {
                // Log the error, which names the field, but not the frame. The
                // frame may hold keycodes or argv, and drifting
                // `pointer_motion` would log 60 lines a second. The frame is
                // already logged at trace above.
                warn!(%err, "{}", grepped::UNPARSEABLE);
                Vec::new()
            }
        };
        // Any message may have moved focus, so check once here instead of
        // keeping a per-message list in sync with the protocol.
        //
        // Broadcast, because focus belongs to the whole desktop and
        // [`Host::focus_change`] reports each change once. Drop the guard
        // before broadcasting; the Wayland thread needs the lock.
        let moved = hub.host.lock().unwrap().focus_change();
        if let Some(message) = moved {
            hub.broadcast(message);
        }
        if !write_responses(hub, writer, responses) {
            return;
        }
    }
}

/// Answer a connection request, unless the desktop is locked.
///
/// These are answered off the Wayland thread so a per-keystroke search never
/// waits on a frame. The lock lives on the Wayland thread, so this checks it
/// through [`Seen`](crate::lock::Seen) with the same [`crate::lock::refused`] that
/// `handle_client_request` uses.
///
/// A refusal gets no response, which reveals nothing about the query or path
/// and matches a desktop with no index.
fn answer_on_the_connection(hub: &ChromeHub, request: ConnectionRequest) -> Vec<HostMessage> {
    let refusal = if hub.the_desk_is_locked() {
        crate::lock::refused(Asked::OnTheConnection(&request))
    } else {
        None
    };
    match refusal {
        Some(refusal) => {
            say_what_the_lock_refused(refusal);
            Vec::new()
        }
        None => answered_on_the_connection(hub, request),
    }
}

/// Run a system call for the page, unless the desktop is locked.
///
/// Answers go straight to the page from `system`'s threads. The only response
/// returned here is a refusal. See `docs/SHELL-SYSTEM-ACCESS.md`.
fn call_the_system(
    hub: &ChromeHub,
    system: &System,
    id: u32,
    request: SystemRequest,
) -> Vec<HostMessage> {
    let refusal = if hub.the_desk_is_locked() {
        crate::lock::refused(Asked::System(reach(&request)))
    } else {
        None
    };
    if let Some(refusal) = refusal {
        say_what_the_lock_refused(refusal);
        return locked_out(id, &request).into_iter().collect();
    }
    match system.handle(id, request) {
        Handled::Done => {}
        Handled::NothingRunning => debug!(id, "a system call drove an id that has ended"),
        Handled::Malformed => warn!(
            id,
            "a system call drove an id with a request that does not fit it"
        ),
    }
    Vec::new()
}

/// Answer a connection request.
fn answered_on_the_connection(hub: &ChromeHub, request: ConnectionRequest) -> Vec<HostMessage> {
    match request {
        // Handled here because Wayland clients learn the theme through the
        // settings portal, which this process serves.
        //
        // No direct response. Every chrome, this one included, gets the `theme`
        // broadcast from `take_up_the_theme`, so all monitors switch together.
        ConnectionRequest::SetTheme { theme } => {
            hub.take_up_the_theme(theme);
            Vec::new()
        }
        // A page has no filesystem, so the compositor searches for it. Safe
        // because `search_files` names no path; this side decides what is read.
        //
        // Only matches are sent. Sending a large home's whole index to every
        // page would cost tens of megabytes per change through the engine's
        // control channel.
        ConnectionRequest::SearchFiles { query } => {
            // Release the lock before searching, so publishing the next index
            // does not wait on this search.
            let offered = hub.offered.lock().unwrap().clone();
            offered
                .map(|offered| {
                    let found = offered.search.find(&query, FOUND);
                    HostMessage::FoundFiles {
                        query,
                        files: found.files,
                        matched: u32::try_from(found.matched)
                            .expect("a home of fewer than four billion paths"),
                        indexing: offered.indexing,
                    }
                })
                // No index (no `HOME`, or it would not open) gets no response
                // rather than an empty list. An empty list would show a broken
                // desktop as an empty home. The launcher still works for paths,
                // URLs and queries.
                .into_iter()
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::io::{BufRead, BufReader};
    use std::os::unix::net::UnixStream;
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    use domicile_host::ipc::to_line;
    use domicile_launch::handshake::Handshake;
    use domicile_protocol::{HostMessage, Passphrase};
    use smithay::reexports::calloop::channel::channel;

    use super::{
        answer_on_the_connection, chrome_connection, freshened, write_responses, ConnectionRequest,
    };
    use crate::chrome_hub::fixture::{hub_with_an_app, queued};
    use crate::chrome_hub::{Chrome, ChromeHub};
    use crate::file_indexing::Offered;
    use crate::lock::{Lock, Offer, Unlocking};
    use crate::portals::Portals;
    use crate::ClientRequest;

    #[test]
    fn a_chrome_that_goes_away_is_forgotten() {
        // Otherwise only a failed broadcast prunes `chromes`, which an idle
        // desktop never sends, so each reload would leak a writer.
        //
        // Uses a real socket pair, since only EOF ends the connection loop.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(
            request_tx,
            1,
            OsString::from("wayland-1"),
            Portals::to_nobody(),
        );
        let (page, compositor) = UnixStream::pair().expect("a socket pair");
        let writer = Arc::new(Mutex::new(
            compositor.try_clone().expect("the stream clones"),
        ));
        hub.chromes.lock().unwrap().push(Chrome {
            writer: writer.clone(),
        });

        let serving = {
            let hub = hub.clone();
            thread::spawn(move || {
                chrome_connection(hub, compositor, writer, Arc::new(Handshake::new()))
            })
        };
        drop(page);
        serving.join().expect("the connection thread ends at EOF");

        assert!(
            hub.chromes.lock().unwrap().is_empty(),
            "the writer for a chrome that disconnected is not kept"
        );
    }

    #[test]
    fn a_socket_that_has_gone_away_ends_the_connection() {
        // `false` stops `read_chrome_messages` from reading a peer that is
        // gone. The caller's early return is not tested; a full close gives EOF
        // on the next read anyway.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(
            request_tx,
            1,
            OsString::from("wayland-1"),
            Portals::to_nobody(),
        );
        let (page, compositor) = UnixStream::pair().expect("a socket pair");
        let writer = Arc::new(Mutex::new(
            compositor.try_clone().expect("the stream clones"),
        ));
        drop(page);

        assert!(
            !write_responses(
                &hub,
                &writer,
                vec![HostMessage::Welcome {
                    protocol_version: domicile_protocol::PROTOCOL_VERSION,
                }],
            ),
            "a write to a peer that is gone ends the connection rather than looping"
        );
    }

    #[test]
    fn a_search_asked_while_a_passphrase_is_being_checked_is_answered_with_nothing() {
        // PAM deliberately delays on a wrong password, so the desktop can be
        // locked with a check pending for seconds. Searches must be refused
        // throughout.
        //
        // No sleep needed: the desktop stays `Checking` until the test hands
        // back the verdict.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(
            request_tx,
            1,
            OsString::from("wayland-1"),
            Portals::to_nobody(),
        );
        *hub.offered.lock().unwrap() = Some(Arc::new(Offered {
            search: domicile_host::file_search::FileSearch::new(vec!["plan.org".into()]),
            indexing: false,
        }));
        let verifier = crate::lock::chosen(
            Some(domicile_config::LockVerifier::Passphrase("friend")),
            std::path::Path::new("/nonexistent"),
        )
        .expect("a passphrase needs nothing from the machine")
        .expect("a passphrase was stated");
        let (told, heard) = std::sync::mpsc::channel();
        let mut lock = Lock::held_by(verifier, move |verdict| {
            told.send(verdict).expect("the test is listening")
        });
        hub.lock.set(lock.seen()).expect("the hub has no lock yet");
        let search = || {
            answer_on_the_connection(
                &hub,
                ConnectionRequest::SearchFiles {
                    query: "plan".into(),
                },
            )
        };

        lock.shut();
        assert_eq!(lock.offered(&Passphrase::from("friend")), Offer::Checking);
        assert!(
            search().is_empty(),
            "a desk with a passphrase being checked answered a search out of the home"
        );

        let verdict = heard
            .recv_timeout(Duration::from_secs(10))
            .expect("the verifier answers");
        assert_eq!(lock.answered(verdict), Unlocking::Opened);
        assert_eq!(search().len(), 1, "and the verdict opens it to the search");
    }

    #[test]
    fn an_answer_with_nothing_in_it_does_not_wait_for_the_writer() {
        // Most messages have no response. Waiting here for a writer
        // `serve_outbound` holds would stop reading that chrome and drop its
        // messages.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(
            request_tx,
            1,
            OsString::from("wayland-1"),
            Portals::to_nobody(),
        );
        let (_page, compositor) = UnixStream::pair().expect("a socket pair");
        let writer = Arc::new(Mutex::new(
            compositor.try_clone().expect("the stream clones"),
        ));

        // Simulates `serve_outbound` blocked writing to a chrome that is not
        // reading.
        //
        // Wait for the holder to confirm it has the lock. A sleep could let the
        // main thread win, and a broken build would pass.
        let (took_it, holds) = channel();
        let held = writer.clone();
        let holder = thread::spawn(move || {
            let _guard = held.lock().unwrap();
            took_it.send(()).expect("the test is still listening");
            sleep(Duration::from_secs(1));
        });
        holds.recv().expect("the holder takes the lock and says so");

        let started = Instant::now();
        let answered = write_responses(&hub, &writer, Vec::new());
        let took = started.elapsed();
        holder.join().expect("the holder ends");

        assert!(
            answered,
            "an answer with nothing in it is not a failed write"
        );
        assert!(
            took < Duration::from_millis(500),
            "an empty answer waited {took:?} for a writer another thread was holding"
        );
    }

    #[test]
    fn the_answer_on_the_wire_carries_the_desktop_as_of_when_it_was_written() {
        // Tests `freshened` through its caller. Building the answers before
        // changing the desktop reproduces the race without timing.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(
            request_tx,
            1,
            OsString::from("wayland-1"),
            Portals::to_nobody(),
        );
        let (page, compositor) = UnixStream::pair().expect("a socket pair");
        let writer = Arc::new(Mutex::new(
            compositor.try_clone().expect("the stream clones"),
        ));

        let booted = vec![window_following("domicile-0", [1280, 800], 1)];
        hub.host.lock().unwrap().describe_displays(booted);
        let answers = vec![
            HostMessage::Welcome {
                protocol_version: domicile_protocol::PROTOCOL_VERSION,
            },
            hub.host.lock().unwrap().describe_desktop(),
        ];

        // The desktop changes between building and writing, as when
        // `set_output` lands in the gap.
        let now = vec![window_following("domicile-0", [1280, 800], 2)];
        hub.host.lock().unwrap().describe_displays(now.clone());

        assert!(
            write_responses(&hub, &writer, answers),
            "the socket is open"
        );
        drop(writer);
        drop(compositor);

        // Compare the bytes a chrome reads, using the caller's encoder.
        let written: Vec<String> = BufReader::new(page)
            .lines()
            .map(|line| line.expect("a line"))
            .collect();
        let expected: Vec<String> = [
            HostMessage::Welcome {
                protocol_version: domicile_protocol::PROTOCOL_VERSION,
            },
            HostMessage::Displays { displays: now },
        ]
        .iter()
        .map(|message| to_line(message).trim_end().to_string())
        .collect();
        assert_eq!(
            written, expected,
            "the welcome is the answer it was built as, and the desktop is the current one"
        );
    }

    #[test]
    fn a_stale_desktop_in_a_handshake_answer_is_replaced_before_it_is_written() {
        // `set_output` can broadcast a new desktop between building and writing
        // the answer. Unfixed, the stale copy arrives last and the chrome keeps
        // it.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(
            request_tx,
            1,
            OsString::from("wayland-1"),
            Portals::to_nobody(),
        );
        let described = vec![window_following("domicile-0", [1280, 800], 2)];
        hub.host
            .lock()
            .unwrap()
            .describe_displays(described.clone());

        let built_earlier = HostMessage::Displays {
            displays: vec![window_following("domicile-0", [1280, 800], 1)],
        };

        assert_eq!(
            freshened(&hub, built_earlier),
            HostMessage::Displays {
                displays: described
            },
            "the desktop written is the one described now, not the one the answer was built from"
        );
    }

    #[test]
    fn the_rest_of_a_handshake_answer_is_written_as_it_was_built() {
        // Only `displays` is refreshed. `welcome` answers this chrome's request
        // and must not be re-derived.
        let (request_tx, _requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(
            request_tx,
            1,
            OsString::from("wayland-1"),
            Portals::to_nobody(),
        );
        let welcome = HostMessage::Welcome {
            protocol_version: domicile_protocol::PROTOCOL_VERSION,
        };

        assert_eq!(
            freshened(&hub, welcome.clone()),
            welcome,
            "a message that is not the desktop passes through untouched"
        );
    }

    /// The single display of a window-following desktop: mode equals logical
    /// size, no transform.
    fn window_following(name: &str, size: [u32; 2], scale: u32) -> domicile_protocol::DisplayInfo {
        domicile_protocol::DisplayInfo {
            name: name.to_string(),
            position: [0, 0],
            size,
            scale,
            mode: size,
            transform: domicile_protocol::DisplayTransform::Normal,
        }
    }

    #[test]
    fn a_chrome_asking_for_focus_is_answered_to_every_chrome() {
        // `chrome_connection` asks `Host` what changed after each message and
        // broadcasts it, so focus reaches every chrome, not only the sender.
        // Only a real connection reaches that code.
        //
        // One chrome suffices: a focus written back only to the sender would
        // never reach the queue. Fan-out to every chrome is tested in
        // `tests/desktop.rs`
        // (`a_density_one_chrome_reports_is_described_to_the_others`).
        //
        // Gap: no test drives `focus_changed` to two connected chromes at once.
        // A fan-out that sent `FocusChanged` only to the first chrome would
        // pass.
        let (hub, outbound, app_id) = hub_with_an_app();
        let (page, compositor) = UnixStream::pair().expect("a socket pair");
        let writer = Arc::new(Mutex::new(
            compositor.try_clone().expect("the stream clones"),
        ));
        hub.chromes.lock().unwrap().push(Chrome {
            writer: writer.clone(),
        });
        let serving = {
            let hub = hub.clone();
            thread::spawn(move || {
                chrome_connection(hub, compositor, writer, Arc::new(Handshake::new()))
            })
        };

        {
            use std::io::Write as _;
            let version = domicile_protocol::PROTOCOL_VERSION;
            let mut writing = &page;
            for message in [
                format!("{{\"type\":\"hello\",\"protocol_version\":{version}}}"),
                format!("{{\"type\":\"focus_app\",\"app_id\":\"{app_id}\"}}"),
            ] {
                writeln!(writing, "{message}").expect("the page can write");
            }
        }
        // Drain before closing the page: the handshake's `Welcome` is written
        // to this socket, and a closed reader would end the connection before
        // it reads the second line.
        let seen = queued(&outbound);
        drop(page);
        serving.join().expect("the connection thread ends at EOF");

        assert!(
            seen.contains(&HostMessage::FocusChanged {
                app_id: Some(app_id.clone()),
            }),
            "every chrome is told the window took the keyboard: {seen:?}"
        );
    }

    #[test]
    fn a_chrome_closing_a_window_asks_the_client_rather_than_the_brain() {
        // Closing a window must go to the Wayland thread, where its toplevel
        // is; only the client can end itself.
        let (request_tx, requests) = channel::<ClientRequest>();
        let (hub, _outbound) = ChromeHub::new(
            request_tx,
            1,
            OsString::from("wayland-1"),
            Portals::to_nobody(),
        );
        let (page, compositor) = UnixStream::pair().expect("a socket pair");
        let writer = Arc::new(Mutex::new(
            compositor.try_clone().expect("the stream clones"),
        ));
        let serving = {
            let hub = hub.clone();
            thread::spawn(move || {
                chrome_connection(hub, compositor, writer, Arc::new(Handshake::new()))
            })
        };

        {
            use std::io::Write as _;
            let version = domicile_protocol::PROTOCOL_VERSION;
            let mut writing = &page;
            // Handshake first, as a real page does.
            for message in [
                format!("{{\"type\":\"hello\",\"protocol_version\":{version}}}"),
                "{\"type\":\"close_app\",\"app_id\":\"term\"}".to_string(),
            ] {
                writeln!(writing, "{message}").expect("the page can write");
            }
        }
        // Collect before closing the page (see above). Poll, since another
        // thread sends these.
        let mut asked = Vec::new();
        for _ in 0..200 {
            while let Ok(request) = requests.try_recv() {
                asked.push(request);
            }
            if asked.len() >= 2 {
                break;
            }
            sleep(Duration::from_millis(10));
        }
        drop(page);
        serving.join().expect("the connection thread ends at EOF");

        assert!(
            matches!(
                asked.as_slice(),
                [
                    ClientRequest::ChromeHello { .. },
                    ClientRequest::CloseApp { app_id }
                ] if app_id == "term"
            ),
            "the handshake, and then the one client asked to close"
        );
    }
}
