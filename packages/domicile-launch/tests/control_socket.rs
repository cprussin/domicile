//! Control socket naming, ownership and client errors.

use std::io::Write as _;
use std::os::unix::fs::PermissionsExt as _;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use domicile_launch::control::{Request, Response};
use domicile_launch::control_socket::{
    address, advertised, answer_one, ask, take, AskError, NotInADesktop, TakeError,
};

/// Read timeout: long enough not to flake under load, short enough to keep the
/// suite fast.
const BRIEFLY: Duration = Duration::from_millis(200);

#[test]
fn the_socket_is_named_after_the_desktop_that_answers_on_it() {
    // One socket per desktop, keyed by pid like sway's
    // `sway-ipc.<uid>.<pid>.sock`.
    assert_eq!(
        address(Some("/run/user/1000"), 4242),
        PathBuf::from("/run/user/1000/domicile-ipc.4242.sock")
    );
}

#[test]
fn with_no_runtime_directory_it_goes_where_the_runs_own_files_do() {
    // Same fallback as the run directory, so a desktop's sockets and its
    // control socket stay together.
    assert_eq!(
        address(None, 4242),
        std::env::temp_dir().join("domicile-ipc.4242.sock")
    );
}

#[test]
fn a_client_is_told_which_desktop_it_is_inside() {
    // Only the variable counts. A session can hold several desktops, so
    // scanning the runtime directory would have to guess.
    assert_eq!(
        advertised(Some("/run/user/1000/domicile-ipc.4242.sock")),
        Ok(PathBuf::from("/run/user/1000/domicile-ipc.4242.sock"))
    );
}

#[test]
fn a_client_outside_every_desktop_is_told_so_rather_than_guessed_for() {
    assert_eq!(advertised(None), Err(NotInADesktop));
}

#[test]
fn a_desktop_takes_the_socket_and_keeps_it_to_itself() {
    let (_scratch, path) = scratch();
    let control = take(&path).expect("nothing was there");

    assert!(
        UnixStream::connect(&path).is_ok(),
        "a desktop that took the socket is answering on it"
    );
    // 0600 because the /tmp fallback is shared with every user on the machine.
    assert_eq!(
        std::fs::metadata(&path)
            .expect("the socket is on disk")
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    drop(control);
    assert!(
        !path.exists(),
        "a run that ended took its socket with it: a file left behind is the \
         next run's stale socket"
    );
}

#[test]
fn two_desktops_on_one_session_each_answer_a_socket_of_their_own() {
    // Keying the name on the pid lets several desktops run at once, as Wayland
    // counts up from `wayland-0`.
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let session = scratch.path().to_str().expect("a utf-8 scratch directory");
    let mine = address(Some(session), 4242);
    let theirs = address(Some(session), 4243);

    let _first = take(&mine).expect("nothing was there");
    let _second = take(&theirs).expect("and the first desktop is not in the way");

    assert!(UnixStream::connect(&mine).is_ok(), "both are answering");
    assert!(UnixStream::connect(&theirs).is_ok(), "both are answering");
}

#[test]
fn a_socket_that_is_already_answering_is_not_taken_from_whoever_has_it() {
    // The pid in the name keeps desktops apart. The check stays so a run never
    // deletes a socket another process is serving.
    let (_scratch, path) = scratch();
    let _first = take(&path).expect("nothing was there");

    assert_eq!(
        take(&path).unwrap_err(),
        TakeError::AlreadyRunning {
            path: path.display().to_string()
        }
    );
}

#[test]
fn the_socket_a_dead_desktop_left_behind_is_replaced() {
    // A desktop killed with SIGKILL leaves its socket file behind. That file
    // must not block the next start.
    let (_scratch, path) = scratch();
    drop(UnixListener::bind(&path).expect("a desktop that is no longer running"));
    assert!(path.exists(), "the file outlives the listener");

    take(&path).expect("nothing is answering there");
}

#[test]
fn something_that_is_not_a_socket_in_the_way_is_not_deleted() {
    // Connecting to a plain file fails the same way as connecting to a dead
    // socket, so a failed connect alone does not justify unlinking.
    let (_scratch, path) = scratch();
    std::fs::write(&path, "not a socket").expect("scratch is writable");

    assert_eq!(
        take(&path).unwrap_err(),
        TakeError::InTheWay {
            path: path.display().to_string()
        }
    );
    assert!(path.exists(), "and it is still there");
}

#[test]
fn a_command_reaches_the_desktop_and_the_answer_comes_back() {
    let (_scratch, path) = scratch();
    let control = take(&path).expect("nothing was there");
    let listener = control.listener().expect("the run's own listener");
    let serving = std::thread::spawn(move || {
        let (stream, _) = listener.accept().expect("the client connected");
        answer_one(stream, BRIEFLY, &|line| {
            domicile_launch::control::answer(
                line,
                Path::new("/desktops/mine/shell.js"),
                &|_, _| panic!("a question about this desktop reaches no engine"),
                &|_| panic!("a question about this desktop reaches no engine"),
                &|_| panic!("a question about this desktop reaches no engine"),
            )
        })
        .expect("the client asked and read the answer");
    });

    assert_eq!(
        ask(&path, &Request::WhichShell, Some(BRIEFLY)).expect("a desktop is running"),
        Response::Shell {
            module: PathBuf::from("/desktops/mine/shell.js")
        }
    );
    serving.join().expect("the desktop answered");
}

#[test]
fn asking_where_no_desktop_is_running_says_so() {
    let (_scratch, path) = scratch();

    assert_eq!(
        ask(&path, &Request::WhichShell, Some(BRIEFLY)).unwrap_err(),
        AskError::NoDesktop {
            path: path.display().to_string()
        }
    );
}

#[test]
fn the_socket_a_dead_desktop_left_behind_is_a_failure_rather_than_a_wait() {
    // Terminals that outlived a SIGKILLed desktop still have its path in
    // `DOMICILE_SOCK`. The kernel refuses the connect, so the client fails at
    // once instead of waiting out the timeout.
    let (_scratch, path) = scratch();
    drop(UnixListener::bind(&path).expect("a desktop that is no longer running"));

    assert_eq!(
        ask(&path, &Request::WhichShell, Some(BRIEFLY)).unwrap_err(),
        AskError::NoDesktop {
            path: path.display().to_string()
        }
    );
}

#[test]
fn a_connection_that_says_nothing_is_given_up_on() {
    // A silent client would hold one of the desktop's threads indefinitely.
    let (_scratch, path) = scratch();
    let control = take(&path).expect("nothing was there");
    let listener = control.listener().expect("the run's own listener");
    let _silent = UnixStream::connect(&path).expect("a client that connects and says nothing");
    let (stream, _) = listener.accept().expect("the desktop took the connection");

    assert!(answer_one(stream, BRIEFLY, &|_| unreachable!(
        "nothing was said, so there is nothing to answer"
    ))
    .is_err());
}

#[test]
fn a_line_with_no_newline_on_it_is_still_answered() {
    // A client that writes and closes its end has finished, with or without a
    // trailing newline. Waiting for one would hang.
    let (_scratch, path) = scratch();
    let control = take(&path).expect("nothing was there");
    let listener = control.listener().expect("the run's own listener");
    let mut client = UnixStream::connect(&path).expect("a client");
    client
        .write_all(b"{\"type\":\"which_shell\"}")
        .expect("it asked");
    client
        .shutdown(std::net::Shutdown::Write)
        .expect("and stopped talking");
    let (stream, _) = listener.accept().expect("the desktop took the connection");

    answer_one(stream, BRIEFLY, &|line| {
        assert_eq!(line.trim(), "{\"type\":\"which_shell\"}");
        String::from("answered\n")
    })
    .expect("the desktop answered");
}

#[test]
fn a_desktop_that_takes_the_connection_and_says_nothing_is_not_a_transport_fault() {
    // The read returns WouldBlock, but the socket is fine: the desktop stopped
    // answering. The error says so.
    let (_scratch, path) = scratch();
    let control = take(&path).expect("nothing was there");
    let listener = control.listener().expect("the run's own listener");
    let wedged = std::thread::spawn(move || {
        let taken = listener.accept().expect("the client connected");
        std::thread::sleep(BRIEFLY * 4);
        drop(taken);
    });

    assert_eq!(
        ask(&path, &Request::WhichShell, Some(BRIEFLY)).unwrap_err(),
        AskError::NoAnswer {
            path: path.display().to_string()
        }
    );
    wedged.join().expect("the desktop that never answered");
}

#[test]
fn a_desktop_that_hangs_up_without_answering_is_the_same_answer() {
    // Reported as an unreadable response, the message would end in an empty
    // "not a response: " and look like a bug.
    let (_scratch, path) = scratch();
    let control = take(&path).expect("nothing was there");
    let listener = control.listener().expect("the run's own listener");
    let hanging_up = std::thread::spawn(move || {
        drop(listener.accept().expect("the client connected"));
    });

    assert_eq!(
        ask(&path, &Request::WhichShell, Some(BRIEFLY)).unwrap_err(),
        AskError::NoAnswer {
            path: path.display().to_string()
        }
    );
    hanging_up.join().expect("the desktop that hung up");
}

#[test]
fn a_client_with_no_patience_waits_for_however_long_the_answer_takes() {
    // An interactive screenshot answers when the user has picked.
    let (_scratch, path) = scratch();
    let control = take(&path).expect("nothing was there");
    let listener = control.listener().expect("the run's own listener");
    let slow = std::thread::spawn(move || {
        let (stream, _) = listener.accept().expect("the client connected");
        answer_one(stream, BRIEFLY, &|_| {
            std::thread::sleep(BRIEFLY * 2);
            String::from("{\"type\":\"canceled\"}\n")
        })
        .expect("the client waited for the answer");
    });

    assert_eq!(
        ask(&path, &Request::WhichShell, None).expect("the desktop answered in the end"),
        Response::Canceled
    );
    slow.join().expect("the desktop answered");
}

/// A temporary directory and a socket path inside it.
///
/// Keep the directory alive: dropping it deletes the directory.
fn scratch() -> (tempfile::TempDir, PathBuf) {
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let path = scratch.path().join("domicile-ipc.4242.sock");
    (scratch, path)
}
