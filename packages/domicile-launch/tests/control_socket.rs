//! Where a running desktop answers, and what happens to whoever else is there.

use std::io::Write as _;
use std::os::unix::fs::PermissionsExt as _;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use domicile_launch::control::{Request, Response};
use domicile_launch::control_socket::{address, answer_one, ask, take, AskError, TakeError};

/// Long enough that a machine under load does not report a client that never
/// wrote as one that did, short enough that a test which waits it out is not
/// the reason the suite is slow.
const BRIEFLY: Duration = Duration::from_millis(200);

#[test]
fn the_socket_is_in_the_runtime_directory() {
    // Discovered rather than passed: a client that has to be told where the
    // desktop is has to be told by something that already knew, and a watcher
    // outside Domicile was not started by it.
    assert_eq!(
        address(Some("/run/user/1000")),
        PathBuf::from("/run/user/1000/domicile.sock")
    );
}

#[test]
fn with_no_runtime_directory_it_goes_where_the_runs_own_files_do() {
    // The same fallback the run directory takes, because it is the same
    // question: where do this user's runtime files go. Two answers would mean
    // a desktop whose sockets and whose control socket are in different
    // places, and a client that has to guess which rule ran.
    assert_eq!(address(None), std::env::temp_dir().join("domicile.sock"));
}

#[test]
fn a_desktop_takes_the_socket_and_keeps_it_to_itself() {
    let (_scratch, path) = scratch();
    let control = take(&path).expect("nothing was there");

    assert!(
        UnixStream::connect(&path).is_ok(),
        "a desktop that took the socket is answering on it"
    );
    // 0600, because the fallback above is world-readable: the run directory
    // under XDG_RUNTIME_DIR is the user's own and mode 700, and /tmp is not.
    // Every other process on the machine can see this path, and what it
    // carries is what the desktop is.
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
fn a_second_desktop_is_refused_rather_than_started_beside_the_first() {
    // One socket at one path is one desktop. A second run that started anyway
    // would be a desktop no `domicile load-shell` could ever reach, and the
    // command would go to the other one without either of them saying so.
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
    // A desktop killed with SIGKILL never unlinks its socket, and a file that
    // nothing is listening on must not be what stops the next one starting.
    let (_scratch, path) = scratch();
    drop(UnixListener::bind(&path).expect("a desktop that is no longer running"));
    assert!(path.exists(), "the file outlives the listener");

    take(&path).expect("nothing is answering there");
}

#[test]
fn something_that_is_not_a_socket_in_the_way_is_not_deleted() {
    // Connecting to a plain file is refused exactly as connecting to a dead
    // socket is, so "nothing answered" is not enough to unlink by. Whatever
    // this is, it is not a desktop's leavings.
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
            domicile_launch::control::answer(line, Path::new("/desktops/mine/shell.js"))
        })
        .expect("the client asked and read the answer");
    });

    assert_eq!(
        ask(&path, &Request::WhichShell, BRIEFLY).expect("a desktop is running"),
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
        ask(&path, &Request::WhichShell, BRIEFLY).unwrap_err(),
        AskError::NoDesktop {
            path: path.display().to_string()
        }
    );
}

#[test]
fn a_connection_that_says_nothing_is_given_up_on() {
    // The desktop answers one connection at a time, so a client that connects
    // and never writes would otherwise be the whole control socket, for the
    // life of the desktop, from any process that can reach the path.
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
    // A client that writes its request and closes its end of the connection
    // has said everything it is going to say, whether or not the last byte was
    // a newline. Waiting for one is a desktop that hangs on a well-behaved
    // client.
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
    // "WouldBlock" is what the read gives back, and it is the wrong sentence
    // for a person: nothing is wrong with the socket, the desktop on the far
    // end of it has stopped answering. They are different things to go and
    // look at.
    let (_scratch, path) = scratch();
    let control = take(&path).expect("nothing was there");
    let listener = control.listener().expect("the run's own listener");
    let wedged = std::thread::spawn(move || {
        let taken = listener.accept().expect("the client connected");
        std::thread::sleep(BRIEFLY * 4);
        drop(taken);
    });

    assert_eq!(
        ask(&path, &Request::WhichShell, BRIEFLY).unwrap_err(),
        AskError::NoAnswer {
            path: path.display().to_string()
        }
    );
    wedged.join().expect("the desktop that never answered");
}

#[test]
fn a_desktop_that_hangs_up_without_answering_is_the_same_answer() {
    // Read as an unreadable response it is a sentence with nothing after the
    // colon — "answered something that is not a response: " — which reads as
    // a bug in whoever wrote the message rather than as what happened.
    let (_scratch, path) = scratch();
    let control = take(&path).expect("nothing was there");
    let listener = control.listener().expect("the run's own listener");
    let hanging_up = std::thread::spawn(move || {
        drop(listener.accept().expect("the client connected"));
    });

    assert_eq!(
        ask(&path, &Request::WhichShell, BRIEFLY).unwrap_err(),
        AskError::NoAnswer {
            path: path.display().to_string()
        }
    );
    hanging_up.join().expect("the desktop that hung up");
}

/// A directory of this test's own, and the socket path inside it.
///
/// The directory is returned with the path because dropping it deletes it, and
/// a test that only kept the path would be binding a socket in a directory
/// that is already gone.
fn scratch() -> (tempfile::TempDir, PathBuf) {
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let path = scratch.path().join("domicile.sock");
    (scratch, path)
}
