//! RTSP messages, as Wi-Fi Display speaks them: a start line, headers, and a
//! `Content-Length` body of `text/parameters`.

use std::fmt;
use std::io::{self, BufRead, Write};

/// A request or a response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    Request(Request),
    Response(Response),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub method: String,
    pub uri: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub reason: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ReadError {
    #[error("the TV closed the connection")]
    Closed,
    #[error("the TV sent an RTSP message this does not read: {0}")]
    Malformed(String),
    #[error(transparent)]
    Io(#[from] io::Error),
}

const VERSION: &str = "RTSP/1.0";

/// Headers are matched without case.
fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

impl Request {
    pub fn new(method: &str, uri: &str, cseq: u32) -> Self {
        Self {
            method: method.to_string(),
            uri: uri.to_string(),
            headers: vec![("CSeq".to_string(), cseq.to_string())],
            body: String::new(),
        }
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        header(&self.headers, name)
    }

    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    /// A `text/parameters` body.
    pub fn with_parameters(self, body: &str) -> Self {
        Self {
            body: body.to_string(),
            ..self.with_header("Content-Type", "text/parameters")
        }
    }

    pub fn cseq(&self) -> Option<u32> {
        self.header("CSeq")?.trim().parse().ok()
    }

    /// The `200 OK` that answers it, with its `CSeq`.
    pub fn ok(&self) -> Response {
        Response {
            status: 200,
            reason: "OK".to_string(),
            headers: self
                .header("CSeq")
                .map(|cseq| vec![("CSeq".to_string(), cseq.to_string())])
                .unwrap_or_default(),
            body: String::new(),
        }
    }
}

impl Response {
    pub fn header(&self, name: &str) -> Option<&str> {
        header(&self.headers, name)
    }

    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn cseq(&self) -> Option<u32> {
        self.header("CSeq")?.trim().parse().ok()
    }
}

fn write_rest(
    out: &mut fmt::Formatter<'_>,
    headers: &[(String, String)],
    body: &str,
) -> fmt::Result {
    for (name, value) in headers {
        write!(out, "{name}: {value}\r\n")?;
    }
    if !body.is_empty() {
        write!(out, "Content-Length: {}\r\n", body.len())?;
    }
    write!(out, "\r\n{body}")
}

impl fmt::Display for Message {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Message::Request(request) => {
                write!(out, "{} {} {VERSION}\r\n", request.method, request.uri)?;
                write_rest(out, &request.headers, &request.body)
            }
            Message::Response(response) => {
                write!(out, "{VERSION} {} {}\r\n", response.status, response.reason)?;
                write_rest(out, &response.headers, &response.body)
            }
        }
    }
}

/// Writes `message` whole.
pub fn write(stream: &mut impl Write, message: &Message) -> io::Result<()> {
    stream.write_all(message.to_string().as_bytes())?;
    stream.flush()
}

/// Reads the next message. A read that times out before the first byte is
/// the `Io` error of the timeout, so a caller can do other work and read
/// again.
pub fn read(stream: &mut impl BufRead) -> Result<Message, ReadError> {
    let start = line(stream)?;
    let start = start.ok_or(ReadError::Closed)?;
    let mut headers = Vec::new();
    loop {
        let next = line(stream)?.ok_or(ReadError::Closed)?;
        if next.is_empty() {
            break;
        }
        let (name, value) = next
            .split_once(':')
            .ok_or_else(|| ReadError::Malformed(next.clone()))?;
        headers.push((name.trim().to_string(), value.trim().to_string()));
    }
    let length = match header(&headers, "Content-Length") {
        None => 0,
        Some(length) => length
            .parse::<usize>()
            .map_err(|_| ReadError::Malformed(format!("Content-Length: {length}")))?,
    };
    let mut body = vec![0; length];
    stream.read_exact(&mut body)?;
    let body = String::from_utf8(body).map_err(|_| ReadError::Malformed("a body".into()))?;
    let mut parts = start.splitn(3, ' ');
    let (first, second, third) = (parts.next(), parts.next(), parts.next());
    match (first, second, third) {
        (Some(VERSION), Some(status), reason) => Ok(Message::Response(Response {
            status: status
                .parse()
                .map_err(|_| ReadError::Malformed(start.clone()))?,
            reason: reason.unwrap_or_default().to_string(),
            headers,
            body,
        })),
        (Some(method), Some(uri), Some(VERSION)) => Ok(Message::Request(Request {
            method: method.to_string(),
            uri: uri.to_string(),
            headers,
            body,
        })),
        _ => Err(ReadError::Malformed(start)),
    }
}

/// A line without its `\r\n`, or `None` at the end of the stream.
fn line(stream: &mut impl BufRead) -> Result<Option<String>, ReadError> {
    let mut text = String::new();
    match stream.read_line(&mut text)? {
        0 => Ok(None),
        _ => Ok(Some(text.trim_end_matches(['\r', '\n']).to_string())),
    }
}

/// `name: value` lines of a `text/parameters` body.
pub fn parameters(body: &str) -> Vec<(&str, &str)> {
    body.lines()
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim(), value.trim()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_request_with_its_body_length() {
        let request = Request::new("SET_PARAMETER", "rtsp://localhost/wfd1.0", 4)
            .with_parameters("wfd_trigger_method: SETUP\r\n");

        assert_eq!(
            Message::Request(request).to_string(),
            "SET_PARAMETER rtsp://localhost/wfd1.0 RTSP/1.0\r\n\
             CSeq: 4\r\n\
             Content-Type: text/parameters\r\n\
             Content-Length: 27\r\n\
             \r\n\
             wfd_trigger_method: SETUP\r\n"
        );
    }

    #[test]
    fn reads_a_response_and_its_body() {
        let text = "RTSP/1.0 200 OK\r\nCSeq: 2\r\ncontent-length: 22\r\n\r\nwfd_audio_codecs: none";

        let message = read(&mut text.as_bytes()).unwrap();

        let Message::Response(response) = message else {
            panic!("{message:?}");
        };
        assert_eq!(response.status, 200);
        assert_eq!(response.cseq(), Some(2));
        assert_eq!(response.body, "wfd_audio_codecs: none");
    }

    #[test]
    fn reads_a_request() {
        let text = "OPTIONS * RTSP/1.0\r\nCSeq: 1\r\nRequire: org.wfa.wfd1.0\r\n\r\n";

        let Message::Request(request) = read(&mut text.as_bytes()).unwrap() else {
            panic!();
        };
        assert_eq!(request.method, "OPTIONS");
        assert_eq!(request.header("require"), Some("org.wfa.wfd1.0"));
        assert_eq!(request.ok().cseq(), Some(1));
    }

    #[test]
    fn says_when_the_tv_hung_up() {
        assert!(matches!(read(&mut "".as_bytes()), Err(ReadError::Closed)));
    }

    #[test]
    fn splits_parameters() {
        assert_eq!(
            parameters("wfd_audio_codecs: AAC 00000001 00\r\nwfd_uibc_capability: none\r\n"),
            vec![
                ("wfd_audio_codecs", "AAC 00000001 00"),
                ("wfd_uibc_capability", "none"),
            ]
        );
    }
}
