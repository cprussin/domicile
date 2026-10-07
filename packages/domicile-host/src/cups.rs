//! A CUPS client: the printers and their options, and print jobs, over IPP.
//!
//! Speaks HTTP/1.1 to CUPS's local socket or `localhost:631`, as libcups
//! does, one request per connection. The Print portal is its only caller; see
//! `docs/PORTALS.md`.

use std::ffi::OsString;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;

use domicile_protocol::{
    ColorMode, Media, Orientation, PrintOptions, PrintQuality, Printer, Sides,
};

use crate::ipp::{self, Attribute, Group, Malformed, Message, Value};
use crate::print_media::{label, Paper};

/// `CUPS-Get-Default`.
const GET_DEFAULT: u16 = 0x4001;
/// `CUPS-Get-Printers`.
const GET_PRINTERS: u16 = 0x4002;
/// `Get-Printer-Attributes`.
const GET_PRINTER_ATTRIBUTES: u16 = 0x000b;
/// `Print-Job`.
const PRINT_JOB: u16 = 0x0002;
/// `client-error-not-found`: CUPS has no default printer.
const NOT_FOUND: u16 = 0x0406;

/// The attributes a dialog offers.
const PRINTER_ATTRIBUTES: [&str; 14] = [
    "printer-name",
    "printer-info",
    "media-supported",
    "media-default",
    "copies-supported",
    "sides-supported",
    "sides-default",
    "print-color-mode-supported",
    "print-color-mode-default",
    "orientation-requested-supported",
    "orientation-requested-default",
    "print-quality-supported",
    "print-quality-default",
    "page-ranges-supported",
];

/// IPP's `sides` keywords.
const SIDES: [(Sides, &str); 3] = [
    (Sides::OneSided, "one-sided"),
    (Sides::TwoSidedLongEdge, "two-sided-long-edge"),
    (Sides::TwoSidedShortEdge, "two-sided-short-edge"),
];

/// IPP's `print-color-mode` keywords a dialog offers.
const COLOR_MODES: [(ColorMode, &str); 2] = [
    (ColorMode::Color, "color"),
    (ColorMode::Monochrome, "monochrome"),
];

/// IPP's `orientation-requested` enums.
const ORIENTATIONS: [(Orientation, i32); 4] = [
    (Orientation::Portrait, 3),
    (Orientation::Landscape, 4),
    (Orientation::ReverseLandscape, 5),
    (Orientation::ReversePortrait, 6),
];

/// IPP's `print-quality` enums.
const QUALITIES: [(PrintQuality, i32); 3] = [
    (PrintQuality::Draft, 3),
    (PrintQuality::Normal, 4),
    (PrintQuality::High, 5),
];

/// Where CUPS listens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Endpoint {
    /// A Unix socket, such as `/run/cups/cups.sock`.
    Socket(PathBuf),
    /// `host:port`.
    Host(String),
}

/// A CUPS server, reached at the first endpoint that answers.
#[derive(Debug, Clone)]
pub struct Cups {
    endpoints: Vec<Endpoint>,
    /// The `requesting-user-name` of each job.
    user: String,
}

/// The printers CUPS offers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offered {
    pub printers: Vec<Printer>,
    /// The default printer's name, if CUPS has one.
    pub default: Option<String>,
}

/// Why CUPS did not do what was asked.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CupsError {
    #[error("CUPS cannot be reached: {0}")]
    Unreachable(String),
    #[error("CUPS's answer is not HTTP")]
    NotHttp,
    #[error("CUPS answered HTTP {0}")]
    Http(u16),
    #[error(transparent)]
    Malformed(#[from] Malformed),
    #[error("CUPS refused with IPP status {0:#06x}")]
    Refused(u16),
}

impl Cups {
    /// A server at `endpoints`, tried in order, printing as `user`.
    pub fn new(endpoints: Vec<Endpoint>, user: String) -> Cups {
        Cups { endpoints, user }
    }

    /// Where libcups looks: `cups_server` (a socket path or `host[:port]`),
    /// else the local socket, else `localhost:631`.
    pub fn at(cups_server: Option<OsString>, user: String) -> Cups {
        let endpoints = match cups_server.filter(|server| !server.is_empty()) {
            Some(server) if server.as_encoded_bytes().starts_with(b"/") => {
                vec![Endpoint::Socket(server.into())]
            }
            Some(server) => {
                let host = server.to_string_lossy();
                if host.contains(':') {
                    vec![Endpoint::Host(host.into())]
                } else {
                    vec![Endpoint::Host(format!("{host}:631"))]
                }
            }
            None => vec![
                Endpoint::Socket("/run/cups/cups.sock".into()),
                Endpoint::Socket("/var/run/cups/cups.sock".into()),
                Endpoint::Host("localhost:631".into()),
            ],
        };
        Cups::new(endpoints, user)
    }

    /// Every printer, with its options and defaults.
    pub fn printers(&self) -> Result<Offered, CupsError> {
        let name = || vec![requested(&["printer-name"])];
        let listed = self.exchange(GET_PRINTERS, None, name(), Vec::new(), &[])?;
        let default = match self.exchange(GET_DEFAULT, None, name(), Vec::new(), &[]) {
            Ok(answer) => answer
                .groups(ipp::PRINTER)
                .next()
                .map(|group| printer(group).name),
            Err(CupsError::Refused(NOT_FOUND)) => None,
            Err(why) => return Err(why),
        };
        let mut printers = Vec::new();
        for listed in listed.groups(ipp::PRINTER) {
            let described = self.exchange(
                GET_PRINTER_ATTRIBUTES,
                Some(&printer(listed).name),
                vec![requested(&PRINTER_ATTRIBUTES)],
                Vec::new(),
                &[],
            )?;
            printers.extend(described.groups(ipp::PRINTER).map(printer));
        }
        Ok(Offered { printers, default })
    }

    /// Send `document`, a PDF or PostScript file, to `printer` as a job named
    /// `title`.
    pub fn print(
        &self,
        printer: &str,
        options: &PrintOptions,
        title: &str,
        document: &[u8],
    ) -> Result<(), CupsError> {
        let operation = vec![
            Attribute::new("requesting-user-name", vec![Value::Name(self.user.clone())]),
            Attribute::new("job-name", vec![Value::Name(title.into())]),
            Attribute::new(
                "document-format",
                vec![Value::MimeType(document_format(document).into())],
            ),
        ];
        self.exchange(PRINT_JOB, Some(printer), operation, job(options), document)?;
        Ok(())
    }

    /// Send one request, about `printer` if named, and read CUPS's answer.
    fn exchange(
        &self,
        code: u16,
        printer: Option<&str>,
        operation: Vec<Attribute>,
        job: Vec<Attribute>,
        data: &[u8],
    ) -> Result<Message, CupsError> {
        let mut attributes = vec![
            Attribute::new("attributes-charset", vec![Value::Charset("utf-8".into())]),
            Attribute::new(
                "attributes-natural-language",
                vec![Value::Language("en".into())],
            ),
        ];
        attributes.extend(printer.map(|name| {
            Attribute::new(
                "printer-uri",
                vec![Value::Uri(format!("ipp://localhost/printers/{name}"))],
            )
        }));
        attributes.extend(operation);
        let mut groups = vec![Group {
            tag: ipp::OPERATION,
            attributes,
        }];
        if !job.is_empty() {
            groups.push(Group {
                tag: ipp::JOB,
                attributes: job,
            });
        }
        let request = Message {
            code,
            request_id: 1,
            groups,
        };
        let body = request.encoded(data);
        let mut stream = self.connected()?;
        let sent = write!(
            stream,
            "POST / HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/ipp\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .and_then(|()| stream.write_all(&body));
        let mut response = Vec::new();
        sent.and_then(|()| stream.read_to_end(&mut response))
            .map_err(|why| CupsError::Unreachable(why.to_string()))?;
        let (answer, _) = Message::decoded(&http_body(&response)?)?;
        // Every status below `0x0100` is a success.
        if answer.code < 0x0100 {
            Ok(answer)
        } else {
            Err(CupsError::Refused(answer.code))
        }
    }

    /// A connection to the first endpoint that accepts one.
    fn connected(&self) -> Result<Box<dyn Stream>, CupsError> {
        let mut failures = Vec::new();
        for endpoint in &self.endpoints {
            let connected: std::io::Result<Box<dyn Stream>> = match endpoint {
                Endpoint::Socket(path) => {
                    UnixStream::connect(path).map(|stream| Box::new(stream) as _)
                }
                Endpoint::Host(host) => {
                    TcpStream::connect(host).map(|stream| Box::new(stream) as _)
                }
            };
            match connected {
                Ok(stream) => return Ok(stream),
                Err(why) => failures.push(format!("{endpoint:?}: {why}")),
            }
        }
        Err(CupsError::Unreachable(failures.join("; ")))
    }
}

/// A connection to CUPS.
trait Stream: Read + Write {}

impl<T: Read + Write> Stream for T {}

/// `requested-attributes`.
fn requested(names: &[&str]) -> Attribute {
    Attribute::new(
        "requested-attributes",
        names
            .iter()
            .map(|name| Value::Keyword(name.to_string()))
            .collect(),
    )
}

/// The printer one `Get-Printer-Attributes` group describes. Values a
/// dialog cannot offer are left out.
fn printer(attributes: &Group) -> Printer {
    let texts = |name: &str| -> Vec<&str> {
        attributes
            .values(name)
            .iter()
            .filter_map(|value| match value {
                Value::Text(text) | Value::Name(text) | Value::Keyword(text) => Some(text.as_str()),
                _ => None,
            })
            .collect()
    };
    let enums = |name: &str| -> Vec<i32> {
        attributes
            .values(name)
            .iter()
            .filter_map(|value| match value {
                Value::Enum(number) => Some(*number),
                _ => None,
            })
            .collect()
    };
    let sides = |name: &str| -> Vec<Sides> {
        texts(name)
            .into_iter()
            .filter_map(|text| named(&SIDES, text))
            .collect()
    };
    let media_default = texts("media-default")
        .first()
        .map(|media| media.to_string());
    Printer {
        name: texts("printer-name")
            .first()
            .copied()
            .unwrap_or_default()
            .into(),
        description: texts("printer-info")
            .first()
            .filter(|info| !info.is_empty())
            .map(|info| info.to_string()),
        media: texts("media-supported")
            .into_iter()
            .filter(|media| Paper::of(media).is_some())
            .map(|media| Media {
                name: media.into(),
                label: label(media),
            })
            .collect(),
        sides: sides("sides-supported"),
        color_modes: texts("print-color-mode-supported")
            .into_iter()
            .filter_map(|text| named(&COLOR_MODES, text))
            .collect(),
        orientations: enums("orientation-requested-supported")
            .into_iter()
            .filter_map(|number| named(&ORIENTATIONS, number))
            .collect(),
        qualities: enums("print-quality-supported")
            .into_iter()
            .filter_map(|number| named(&QUALITIES, number))
            .collect(),
        copies_max: attributes
            .values("copies-supported")
            .iter()
            .find_map(|value| match value {
                Value::Range { upper, .. } => u32::try_from(*upper).ok(),
                _ => None,
            })
            .unwrap_or(1),
        page_ranges: attributes.values("page-ranges-supported") == [Value::Boolean(true)],
        initial: PrintOptions {
            media: media_default.filter(|media| Paper::of(media).is_some()),
            copies: 1,
            sides: sides("sides-default").first().copied(),
            color_mode: texts("print-color-mode-default")
                .into_iter()
                .find_map(|text| named(&COLOR_MODES, text)),
            orientation: enums("orientation-requested-default")
                .into_iter()
                .find_map(|number| named(&ORIENTATIONS, number)),
            quality: enums("print-quality-default")
                .into_iter()
                .find_map(|number| named(&QUALITIES, number)),
            pages: Vec::new(),
        },
    }
}

/// The job attributes for `options`. An absent option is left to the
/// printer.
fn job(options: &PrintOptions) -> Vec<Attribute> {
    let keyword = |text: &str| vec![Value::Keyword(text.into())];
    let copies = i32::try_from(options.copies).expect("the shell asks for a sane number of copies");
    [
        Some(Attribute::new("copies", vec![Value::Integer(copies)])),
        options
            .media
            .as_deref()
            .map(|media| Attribute::new("media", keyword(media))),
        options
            .sides
            .map(|sides| Attribute::new("sides", keyword(spelling(&SIDES, sides)))),
        options
            .color_mode
            .map(|mode| Attribute::new("print-color-mode", keyword(spelling(&COLOR_MODES, mode)))),
        options.orientation.map(|orientation| {
            Attribute::new(
                "orientation-requested",
                vec![Value::Enum(spelling(&ORIENTATIONS, orientation))],
            )
        }),
        options.quality.map(|quality| {
            Attribute::new(
                "print-quality",
                vec![Value::Enum(spelling(&QUALITIES, quality))],
            )
        }),
        (!options.pages.is_empty()).then(|| {
            Attribute::new(
                "page-ranges",
                options
                    .pages
                    .iter()
                    .map(|range| Value::Range {
                        lower: i32::try_from(range.first).expect("a page number fits IPP"),
                        upper: i32::try_from(range.last).expect("a page number fits IPP"),
                    })
                    .collect(),
            )
        }),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// The `document-format` of `document`, by its first bytes. CUPS detects
/// any other type itself.
fn document_format(document: &[u8]) -> &'static str {
    if document.starts_with(b"%PDF") {
        "application/pdf"
    } else if document.starts_with(b"%!") {
        "application/postscript"
    } else {
        "application/octet-stream"
    }
}

/// The body of an HTTP/1.1 response, de-chunked. An error unless it is
/// `200 OK`.
fn http_body(response: &[u8]) -> Result<Vec<u8>, CupsError> {
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or(CupsError::NotHttp)?;
    let head = std::str::from_utf8(&response[..split]).map_err(|_| CupsError::NotHttp)?;
    let body = &response[split + 4..];
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|line| line.strip_prefix("HTTP/1."))
        .and_then(|line| line.split(' ').nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or(CupsError::NotHttp)?;
    if status != 200 {
        return Err(CupsError::Http(status));
    }
    let headers: Vec<(String, &str)> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim()))
        .collect();
    let header = |wanted: &str| {
        headers
            .iter()
            .find(|(name, _)| name == wanted)
            .map(|(_, value)| *value)
    };
    if header("transfer-encoding").is_some_and(|coding| coding.eq_ignore_ascii_case("chunked")) {
        dechunked(body)
    } else {
        match header("content-length").and_then(|length| length.parse::<usize>().ok()) {
            Some(length) => body
                .get(..length)
                .map(<[u8]>::to_vec)
                .ok_or(CupsError::NotHttp),
            None => Ok(body.to_vec()),
        }
    }
}

/// A chunked body's chunks, joined.
fn dechunked(mut body: &[u8]) -> Result<Vec<u8>, CupsError> {
    let mut joined = Vec::new();
    loop {
        let line_end = body
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or(CupsError::NotHttp)?;
        let size = std::str::from_utf8(&body[..line_end])
            .ok()
            .and_then(|line| usize::from_str_radix(line.split(';').next()?.trim(), 16).ok())
            .ok_or(CupsError::NotHttp)?;
        if size == 0 {
            return Ok(joined);
        }
        let chunk = body
            .get(line_end + 2..line_end + 2 + size)
            .ok_or(CupsError::NotHttp)?;
        joined.extend(chunk);
        body = body.get(line_end + 4 + size..).ok_or(CupsError::NotHttp)?;
    }
}

/// The value `table` spells `spelled`.
fn named<T: Copy, S: PartialEq + Copy>(table: &[(T, S)], spelled: S) -> Option<T> {
    table
        .iter()
        .find(|(_, listed)| *listed == spelled)
        .map(|(value, _)| *value)
}

/// How `table` spells `value`.
fn spelling<T: PartialEq, S: Copy>(table: &[(T, S)], value: T) -> S {
    table
        .iter()
        .find(|(listed, _)| *listed == value)
        .map(|(_, spelled)| *spelled)
        .expect("every value is in its table")
}

#[cfg(test)]
mod tests {
    use super::*;
    use domicile_protocol::PageRange;

    fn keywords(words: &[&str]) -> Vec<Value> {
        words
            .iter()
            .map(|word| Value::Keyword(word.to_string()))
            .collect()
    }

    #[test]
    fn a_printers_attributes_become_what_the_dialog_offers() {
        let attributes = Group {
            tag: ipp::PRINTER,
            attributes: vec![
                Attribute::new("printer-name", vec![Value::Name("office".into())]),
                Attribute::new("printer-info", vec![Value::Text("Office laser".into())]),
                Attribute::new(
                    "media-supported",
                    keywords(&["iso_a4_210x297mm", "custom_min_3x5in", "na_letter_8.5x11in"]),
                ),
                Attribute::new("media-default", keywords(&["iso_a4_210x297mm"])),
                Attribute::new(
                    "copies-supported",
                    vec![Value::Range {
                        lower: 1,
                        upper: 99,
                    }],
                ),
                Attribute::new(
                    "sides-supported",
                    keywords(&["one-sided", "two-sided-long-edge"]),
                ),
                Attribute::new("sides-default", keywords(&["one-sided"])),
                Attribute::new(
                    "print-color-mode-supported",
                    keywords(&["auto", "monochrome", "color"]),
                ),
                Attribute::new("print-color-mode-default", keywords(&["auto"])),
                Attribute::new(
                    "orientation-requested-supported",
                    vec![Value::Enum(3), Value::Enum(4), Value::Enum(7)],
                ),
                Attribute::new("orientation-requested-default", vec![Value::Enum(3)]),
                Attribute::new(
                    "print-quality-supported",
                    vec![Value::Enum(4), Value::Enum(5)],
                ),
                Attribute::new("print-quality-default", vec![Value::Enum(4)]),
                Attribute::new("page-ranges-supported", vec![Value::Boolean(true)]),
            ],
        };

        assert_eq!(
            printer(&attributes),
            Printer {
                name: "office".into(),
                description: Some("Office laser".into()),
                media: vec![
                    Media {
                        name: "iso_a4_210x297mm".into(),
                        label: "A4 (210 × 297 mm)".into(),
                    },
                    Media {
                        name: "na_letter_8.5x11in".into(),
                        label: "Letter (8.5 × 11 in)".into(),
                    },
                ],
                sides: vec![Sides::OneSided, Sides::TwoSidedLongEdge],
                color_modes: vec![ColorMode::Monochrome, ColorMode::Color],
                orientations: vec![Orientation::Portrait, Orientation::Landscape],
                qualities: vec![PrintQuality::Normal, PrintQuality::High],
                copies_max: 99,
                page_ranges: true,
                initial: PrintOptions {
                    media: Some("iso_a4_210x297mm".into()),
                    copies: 1,
                    sides: Some(Sides::OneSided),
                    color_mode: None,
                    orientation: Some(Orientation::Portrait),
                    quality: Some(PrintQuality::Normal),
                    pages: Vec::new(),
                },
            }
        );
    }

    #[test]
    fn a_printer_that_says_nothing_offers_one_copy_of_every_page() {
        let bare = printer(&Group {
            tag: ipp::PRINTER,
            attributes: vec![Attribute::new(
                "printer-name",
                vec![Value::Name("bare".into())],
            )],
        });

        assert_eq!(
            (bare.copies_max, bare.page_ranges, bare.description),
            (1, false, None)
        );
        assert!(bare.media.is_empty() && bare.sides.is_empty());
    }

    #[test]
    fn chosen_options_become_job_attributes() {
        let options = PrintOptions {
            media: Some("iso_a4_210x297mm".into()),
            copies: 2,
            sides: Some(Sides::TwoSidedShortEdge),
            color_mode: Some(ColorMode::Monochrome),
            orientation: Some(Orientation::ReversePortrait),
            quality: Some(PrintQuality::Draft),
            pages: vec![
                PageRange { first: 1, last: 2 },
                PageRange { first: 4, last: 4 },
            ],
        };

        assert_eq!(
            job(&options),
            [
                Attribute::new("copies", vec![Value::Integer(2)]),
                Attribute::new("media", keywords(&["iso_a4_210x297mm"])),
                Attribute::new("sides", keywords(&["two-sided-short-edge"])),
                Attribute::new("print-color-mode", keywords(&["monochrome"])),
                Attribute::new("orientation-requested", vec![Value::Enum(6)]),
                Attribute::new("print-quality", vec![Value::Enum(3)]),
                Attribute::new(
                    "page-ranges",
                    vec![
                        Value::Range { lower: 1, upper: 2 },
                        Value::Range { lower: 4, upper: 4 }
                    ],
                ),
            ]
        );
        let defaults = PrintOptions {
            media: None,
            copies: 1,
            sides: None,
            color_mode: None,
            orientation: None,
            quality: None,
            pages: Vec::new(),
        };
        assert_eq!(
            job(&defaults),
            [Attribute::new("copies", vec![Value::Integer(1)])]
        );
    }

    #[test]
    fn a_document_is_typed_by_its_first_bytes() {
        assert_eq!(document_format(b"%PDF-1.7\n"), "application/pdf");
        assert_eq!(
            document_format(b"%!PS-Adobe-3.0\n"),
            "application/postscript"
        );
        assert_eq!(document_format(b"plain"), "application/octet-stream");
    }

    #[test]
    fn a_chunked_body_is_joined() {
        let response = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: application/ipp\r\n\r\n4\r\nabcd\r\n2\r\nef\r\n0\r\n\r\n";

        assert_eq!(http_body(response), Ok(b"abcdef".to_vec()));
    }

    #[test]
    fn a_sized_body_is_read_to_its_length() {
        let response = b"HTTP/1.1 200 OK\r\ncontent-length: 3\r\n\r\nabcdef";

        assert_eq!(http_body(response), Ok(b"abc".to_vec()));
    }

    #[test]
    fn a_failed_or_foreign_response_is_an_error() {
        assert_eq!(
            http_body(b"HTTP/1.1 401 Unauthorized\r\n\r\n"),
            Err(CupsError::Http(401))
        );
        assert_eq!(http_body(b"SSH-2.0-OpenSSH\r\n"), Err(CupsError::NotHttp));
    }

    #[test]
    fn cups_server_names_a_socket_or_a_host_and_otherwise_the_local_ones_are_tried() {
        let endpoints =
            |server: Option<&str>| Cups::at(server.map(OsString::from), "me".into()).endpoints;

        assert_eq!(
            endpoints(Some("/tmp/cups.sock")),
            [Endpoint::Socket("/tmp/cups.sock".into())]
        );
        assert_eq!(
            endpoints(Some("printhost")),
            [Endpoint::Host("printhost:631".into())]
        );
        assert_eq!(
            endpoints(Some("printhost:8631")),
            [Endpoint::Host("printhost:8631".into())]
        );
        assert_eq!(
            endpoints(None),
            [
                Endpoint::Socket("/run/cups/cups.sock".into()),
                Endpoint::Socket("/var/run/cups/cups.sock".into()),
                Endpoint::Host("localhost:631".into()),
            ]
        );
    }
}
