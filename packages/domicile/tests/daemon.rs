//! End-to-end test of the actual `domicile` daemon binary, written before the
//! implementation. Spawns the built binary, connects over the Unix socket, and
//! completes the chrome handshake — proving config boot + socket serve + the
//! session loop work as a real process.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use domicile_protocol::PROTOCOL_VERSION;

fn wait_for_socket(path: &Path, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if path.exists() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

#[test]
fn daemon_boots_from_config_and_completes_handshake() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("domicile.sock");
    let missing_config = dir.path().join("domicile.toml"); // absent -> daemon uses defaults

    let mut child = Command::new(env!("CARGO_BIN_EXE_domicile"))
        .arg("--socket")
        .arg(&socket)
        .arg("--config")
        .arg(&missing_config)
        .arg("--shells-dir")
        .arg(dir.path())
        .spawn()
        .expect("daemon should start");

    assert!(
        wait_for_socket(&socket, Duration::from_secs(10)),
        "daemon never created its socket"
    );

    let stream = UnixStream::connect(&socket).expect("connect to daemon");
    // A daemon that never answers must fail the test rather than hang it.
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let mut writer = stream.try_clone().unwrap();
    writer
        .write_all(
            format!("{{\"type\":\"hello\",\"protocol_version\":{PROTOCOL_VERSION}}}\n").as_bytes(),
        )
        .unwrap();

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let read = reader.read_line(&mut line);

    child.kill().ok();
    child.wait().ok();
    read.expect("daemon should answer the handshake");

    assert!(
        line.contains("\"welcome\""),
        "expected a welcome, got: {line}"
    );
    assert!(line.contains(&format!("\"protocol_version\":{PROTOCOL_VERSION}")));
}

/// The bug this guards: hot-reload said it was on and was not.
///
/// `watch_config` spawns a thread that reads the watcher's channel. It named
/// only `watcher.rx` inside a `move` closure, and a `move` closure in edition
/// 2021 captures the *fields* it names — so the OS watcher was dropped when
/// `watch_config` returned, the channel closed, and the loop ended before the
/// first edit. Nothing said so: the daemon had already printed "watching", and
/// a watcher nobody kept looks exactly like a file nobody edits.
///
/// Against the real binary, because the bug is in how a thread captures a
/// value and no unit test of `apply_reload` can see it — that function was
/// tested throughout and stayed correct.
#[test]
fn an_edited_config_is_reloaded_while_the_daemon_runs() {
    let dir = tempfile::tempdir().unwrap();
    // The config gets a directory to itself, and that is load-bearing rather
    // than tidy. `domicile_config::watch` watches the config's *parent*,
    // because that is how a save by atomic rename is caught, and the daemon
    // reports every event there as a reload. With the socket beside it, the
    // daemon binding its own socket fires one before this test has edited
    // anything — and the assertion below, which only looks for the line, was
    // satisfied by that. It still failed against the bug it guards, because a
    // watcher that was dropped produces no events at all; it just was not
    // testing the edit.
    let watched = tempfile::tempdir().unwrap();
    let socket = dir.path().join("domicile.sock");
    let config = watched.path().join("domicile.toml");
    std::fs::write(&config, "[compositor]\nnested_size = [1280, 800]\n").unwrap();

    let child = Command::new(env!("CARGO_BIN_EXE_domicile"))
        .arg("--socket")
        .arg(&socket)
        .arg("--config")
        .arg(&config)
        .arg("--shells-dir")
        .arg(dir.path())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("daemon should start");
    // Killed however this test leaves, including by an assertion below: a panic
    // would otherwise drop the temp directories and leave the daemon running
    // past the end of the test binary.
    let mut child = Reaped(child);

    // Its own thread, because the daemon keeps writing and a blocking read on
    // the last line would outlive the test rather than fail it.
    let stderr = child.0.stderr.take().expect("stderr is piped");
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                return;
            }
        }
    });

    assert!(
        wait_for_socket(&socket, Duration::from_secs(10)),
        "daemon never created its socket"
    );
    // The edit. Its content differs, though the daemon does not require that:
    // it reports every event in the watched directory as a reload, and with
    // the config alone in one this write is the only event there is.
    std::fs::write(&config, "[compositor]\nnested_size = [1920, 1080]\n").unwrap();

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut seen = Vec::new();
    let reloaded = loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break false;
        }
        match rx.recv_timeout(left) {
            Ok(line) => {
                let hit = line.contains("config reloaded");
                seen.push(line);
                if hit {
                    break true;
                }
            }
            Err(_) => break false,
        }
    };
    drop(child);
    assert!(
        reloaded,
        "the daemon never reloaded its config; it said:\n{}",
        seen.join("\n")
    );
}

/// A spawned daemon that is killed when it goes out of scope.
///
/// `kill`/`wait` after the assertions only runs when the assertions pass, and
/// a test that panics between spawning and that line leaves a daemon holding a
/// socket in a directory that is about to be deleted.
struct Reaped(std::process::Child);

impl Drop for Reaped {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
