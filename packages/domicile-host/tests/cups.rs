//! The CUPS client against a fake IPP server on a Unix socket.

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixListener;
use std::sync::mpsc::{channel, Receiver};
use std::thread;

use domicile_host::cups::{Cups, CupsError, Endpoint};
use domicile_host::ipp::{self, Attribute, Group, Message, Value};
use domicile_protocol::{PageRange, PrintOptions, Sides};

/// A request the fake server heard, and the data after it.
type Heard = (Message, Vec<u8>);

/// A server answering as CUPS with two printers, `office` the default, and
/// the requests it heard. `status` is every answer's IPP status.
struct FakeCups {
    cups: Cups,
    heard: Receiver<Heard>,
    _dir: tempfile::TempDir,
}

fn fake_cups(status: u16) -> FakeCups {
    let dir = tempfile::tempdir().expect("a directory");
    let socket = dir.path().join("cups.sock");
    let listener = UnixListener::bind(&socket).expect("the socket bound");
    let (hear, heard) = channel();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = stream.expect("a connection");
            let (request, data) = read_request(&mut stream);
            let answer = answered(&request, status);
            let _ = hear.send((request, data));
            let body = answer.encoded(&[]);
            // Chunked, as cupsd answers.
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/ipp\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(&body).unwrap();
            stream.write_all(b"\r\n0\r\n\r\n").unwrap();
        }
    });
    FakeCups {
        cups: Cups::new(
            vec![
                Endpoint::Socket(dir.path().join("absent.sock")),
                Endpoint::Socket(socket),
            ],
            "me".into(),
        ),
        heard,
        _dir: dir,
    }
}

/// The IPP request in one HTTP request.
fn read_request(stream: &mut std::os::unix::net::UnixStream) -> Heard {
    let mut reader = BufReader::new(stream);
    let mut length = 0;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        if line == "\r\n" {
            break;
        }
        if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            length = value.trim().parse().unwrap();
        }
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).unwrap();
    let (message, data) = Message::decoded(&body).expect("an IPP request");
    (message, data.to_vec())
}

fn operation_value(request: &Message, name: &str) -> Vec<Value> {
    request
        .groups(ipp::OPERATION)
        .next()
        .expect("operation attributes")
        .values(name)
        .to_vec()
}

fn answered(request: &Message, status: u16) -> Message {
    let printer = |name: &str| Group {
        tag: ipp::PRINTER,
        attributes: vec![Attribute::new(
            "printer-name",
            vec![Value::Name(name.into())],
        )],
    };
    let groups = match request.code {
        // CUPS-Get-Printers
        0x4002 => vec![printer("office"), printer("label")],
        // CUPS-Get-Default
        0x4001 => vec![printer("office")],
        // Get-Printer-Attributes
        0x000b => {
            let mut described = printer(match operation_value(request, "printer-uri").as_slice() {
                [Value::Uri(uri)] => uri.rsplit('/').next().unwrap(),
                other => panic!("no printer-uri: {other:?}"),
            });
            described.attributes.extend([
                Attribute::new("sides-supported", vec![Value::Keyword("one-sided".into())]),
                Attribute::new(
                    "copies-supported",
                    vec![Value::Range { lower: 1, upper: 9 }],
                ),
            ]);
            vec![described]
        }
        // Print-Job
        0x0002 => vec![Group {
            tag: ipp::JOB,
            attributes: vec![Attribute::new("job-id", vec![Value::Integer(42)])],
        }],
        other => panic!("an operation CUPS was not asked: {other:#x}"),
    };
    Message {
        code: status,
        request_id: request.request_id,
        groups: std::iter::once(Group {
            tag: ipp::OPERATION,
            attributes: vec![Attribute::new(
                "attributes-charset",
                vec![Value::Charset("utf-8".into())],
            )],
        })
        .chain(groups)
        .collect(),
    }
}

#[test]
fn the_printers_come_with_their_options_and_the_default() {
    let fake = fake_cups(0x0000);

    let offered = fake.cups.printers().expect("CUPS answered");

    assert_eq!(offered.default.as_deref(), Some("office"));
    let names: Vec<_> = offered
        .printers
        .iter()
        .map(|printer| printer.name.as_str())
        .collect();
    assert_eq!(names, ["office", "label"]);
    assert_eq!(offered.printers[1].sides, [Sides::OneSided]);
    assert_eq!(offered.printers[1].copies_max, 9);
}

#[test]
fn a_job_carries_its_options_and_document_to_the_printer() {
    let fake = fake_cups(0x0000);
    let options = PrintOptions {
        media: Some("iso_a4_210x297mm".into()),
        copies: 2,
        sides: None,
        color_mode: None,
        orientation: None,
        quality: None,
        pages: vec![PageRange { first: 2, last: 3 }],
    };

    let printed = fake
        .cups
        .print("office", &options, "Report", b"%PDF-1.7 ...");

    assert_eq!(printed, Ok(()));
    let (request, document) = fake.heard.recv().expect("the job arrived");
    assert_eq!(request.code, 0x0002);
    assert_eq!(document, b"%PDF-1.7 ...");
    assert_eq!(
        operation_value(&request, "printer-uri"),
        [Value::Uri("ipp://localhost/printers/office".into())]
    );
    assert_eq!(
        operation_value(&request, "job-name"),
        [Value::Name("Report".into())]
    );
    assert_eq!(
        operation_value(&request, "requesting-user-name"),
        [Value::Name("me".into())]
    );
    assert_eq!(
        operation_value(&request, "document-format"),
        [Value::MimeType("application/pdf".into())]
    );
    let job = request.groups(ipp::JOB).next().expect("job attributes");
    assert_eq!(job.values("copies"), [Value::Integer(2)]);
    assert_eq!(
        job.values("page-ranges"),
        [Value::Range { lower: 2, upper: 3 }]
    );
}

#[test]
fn a_job_cups_refuses_is_an_error() {
    let fake = fake_cups(0x0400);
    let options = PrintOptions {
        media: None,
        copies: 1,
        sides: None,
        color_mode: None,
        orientation: None,
        quality: None,
        pages: Vec::new(),
    };

    assert_eq!(
        fake.cups.print("office", &options, "Report", b"%PDF"),
        Err(CupsError::Refused(0x0400))
    );
}

#[test]
fn no_cups_is_unreachable() {
    let dir = tempfile::tempdir().expect("a directory");
    let cups = Cups::new(
        vec![Endpoint::Socket(dir.path().join("cups.sock"))],
        "me".into(),
    );

    assert!(matches!(cups.printers(), Err(CupsError::Unreachable(_))));
}
