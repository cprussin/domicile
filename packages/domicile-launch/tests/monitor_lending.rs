//! Tests for lending a virtual monitor to `domicile monitor` for as long as
//! its connection is open.

use std::io::{BufRead as _, BufReader, Write as _};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use domicile_launch::cli::MonitorMode;
use domicile_launch::control::Lent;
use domicile_launch::monitor_lending::{forward_sizes, lend};
use domicile_protocol::Scale;

const BRIEFLY: Duration = Duration::from_millis(200);

const ADDED: &str = "{\"type\":\"system_reply\",\"id\":1,\"reply\":{\"kind\":\
                     \"virtual_monitor\",\"output\":\"virtual-1\"}}\n";

#[test]
fn a_lent_monitor_follows_the_clients_sizes_and_goes_with_it() {
    let (_scratch, chrome) = scratch();
    let compositor = a_compositor(&chrome, ADDED, false);
    let (lent, client) = lent();
    let lending = std::thread::spawn(move || lend(lent, &chrome, BRIEFLY));

    let mut heard = BufReader::new(client.try_clone().expect("readable"));
    let mut answer = String::new();
    heard.read_line(&mut answer).expect("the client heard back");
    let mut client = client;
    client
        .write_all(
            b"{\"type\":\"resize_virtual_monitor\",\"width\":800,\"height\":600,\
              \"refresh_mhz\":30000,\"scale\":1.5}\n",
        )
        .expect("the client resized it");
    drop(heard);
    drop(client);
    lending.join().expect("the lend ended with its client");

    assert_eq!(
        answer,
        "{\"type\":\"virtual_monitor\",\"output\":\"virtual-1\"}\n"
    );
    let lines = compositor.join().expect("the compositor heard it all");
    assert_eq!(lines.len(), 2, "{lines:?}");
    assert!(
        lines[0].contains("\"call\":\"virtual_monitor\""),
        "{lines:?}"
    );
    assert!(lines[1].contains("\"width\":800"), "{lines:?}");
    assert!(lines[1].contains("\"scale\":1.5"), "{lines:?}");
}

#[test]
fn a_monitor_its_compositor_takes_away_hangs_up_on_the_client() {
    let (_scratch, chrome) = scratch();
    let compositor = a_compositor(&chrome, ADDED, true);
    let (lent, client) = lent();
    let lending = std::thread::spawn(move || lend(lent, &chrome, BRIEFLY));

    let said: Vec<String> = BufReader::new(client)
        .lines()
        .map(|line| line.expect("a line"))
        .collect();

    assert_eq!(said.len(), 1, "only the answer, then the hang-up: {said:?}");
    compositor.join().expect("the compositor went");
    lending.join().expect("the lend ended with its compositor");
}

#[test]
fn a_compositor_that_refuses_is_quoted_to_the_client() {
    let (_scratch, chrome) = scratch();
    let compositor = a_compositor(
        &chrome,
        "{\"type\":\"system_reply\",\"id\":1,\"reply\":{\"kind\":\"failed\",\
         \"error\":{\"kind\":\"other\",\"message\":\"nested\"}}}\n",
        true,
    );
    let (lent, client) = lent();

    lend(lent, &chrome, BRIEFLY);

    let mut answer = String::new();
    BufReader::new(client)
        .read_line(&mut answer)
        .expect("the client heard back");
    assert!(
        answer.contains("refused") && answer.contains("nested"),
        "{answer}"
    );
    compositor.join().expect("the compositor refused");
}

#[test]
fn each_size_typed_resizes_and_anything_else_is_said_and_skipped() {
    let mut sent = Vec::new();
    let mut said = Vec::new();

    forward_sizes(
        "1280x720\nhuge\n\n800x600@30 2\n".as_bytes(),
        &mut sent,
        &mut said,
    )
    .expect("every size went");

    assert_eq!(
        String::from_utf8(sent).expect("text"),
        "{\"type\":\"resize_virtual_monitor\",\"width\":1280,\"height\":720,\
         \"refresh_mhz\":60000,\"scale\":1.0}\n{\"type\":\"resize_virtual_monitor\",\
         \"width\":800,\"height\":600,\"refresh_mhz\":30000,\"scale\":2.0}\n"
    );
    let said = String::from_utf8(said).expect("text");
    assert!(said.contains("huge"), "{said}");
}

/// A lent connection, as `serve_one` hands it over, and its client's end.
fn lent() -> (Lent, UnixStream) {
    let (desktop, client) = UnixStream::pair().expect("a connection");
    (
        Lent {
            name: "Pane".to_string(),
            mode: MonitorMode {
                size: (1280, 720),
                refresh_mhz: 60_000,
                scale: Scale::ONE,
            },
            lines: BufReader::new(desktop.try_clone().expect("readable")),
            client: desktop,
        },
        client,
    )
}

/// A fake compositor at `path` that reads the request and replies `with`.
/// Then it hangs up if `goes`, or reads until the supervisor does. Returns
/// the lines it read.
fn a_compositor(
    path: &Path,
    with: &'static str,
    goes: bool,
) -> std::thread::JoinHandle<Vec<String>> {
    let listener = UnixListener::bind(path).expect("the compositor binds its chrome socket");
    std::thread::spawn(move || {
        let (stream, _) = listener.accept().expect("a supervisor dialed");
        let mut reader = BufReader::new(stream.try_clone().expect("readable"));
        let mut first = String::new();
        reader.read_line(&mut first).expect("the supervisor asked");
        let mut answering = stream;
        answering
            .write_all(with.as_bytes())
            .expect("the compositor answers");
        if goes {
            return vec![first];
        }
        std::iter::once(first)
            .chain(reader.lines().map(|line| line.expect("a line")))
            .collect()
    })
}

fn scratch() -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().expect("a temp directory");
    let path = directory.path().join("chrome.sock");
    (directory, path)
}
