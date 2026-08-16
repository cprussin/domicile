//! End-to-end test of the actual `loom` daemon binary, written before the
//! implementation. Spawns the built binary, connects over the Unix socket, and
//! completes the chrome handshake — proving config boot + socket serve + the
//! session loop work as a real process.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

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
    let socket = dir.path().join("loom.sock");
    let missing_config = dir.path().join("loom.toml"); // absent -> daemon uses defaults

    let mut child = Command::new(env!("CARGO_BIN_EXE_loom"))
        .arg("--socket")
        .arg(&socket)
        .arg("--config")
        .arg(&missing_config)
        .arg("--shells-dir")
        .arg(dir.path())
        .spawn()
        .expect("daemon should start");

    assert!(wait_for_socket(&socket, Duration::from_secs(10)), "daemon never created its socket");

    let stream = UnixStream::connect(&socket).expect("connect to daemon");
    let mut writer = stream.try_clone().unwrap();
    writer.write_all(b"{\"type\":\"hello\",\"protocol_version\":1}\n").unwrap();

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();

    child.kill().ok();
    child.wait().ok();

    assert!(line.contains("\"welcome\""), "expected a welcome, got: {line}");
    assert!(line.contains("\"protocol_version\":1"));
}
