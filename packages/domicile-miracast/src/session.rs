//! The source side of a Wi-Fi Display session: the RTSP exchange that agrees
//! what to send (`M1` to `M7`), then keepalives (`M16`) while it plays, and a
//! teardown.
//!
//! The TV opens the connection; [`start`] runs the exchange on it until the
//! TV says `PLAY`, and [`Playing::serve`] answers the TV until either side
//! ends the cast.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::rtsp::{self, Message, ReadError, Request, Response};
use crate::wfd::{self, CapabilityError, Negotiated};

/// A connection whose reads can wait a bounded time.
pub trait Connection: Read + Write {
    fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()>;
}

impl Connection for TcpStream {
    fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        TcpStream::set_read_timeout(self, timeout)
    }
}

impl Connection for UnixStream {
    fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        UnixStream::set_read_timeout(self, timeout)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error(transparent)]
    Read(#[from] ReadError),
    #[error("the TV refused `{method}`: {status} {reason}")]
    Refused {
        method: String,
        status: u16,
        reason: String,
    },
    #[error(transparent)]
    Capabilities(#[from] CapabilityError),
    #[error("the TV stopped answering")]
    Silent,
}

impl From<io::Error> for SessionError {
    fn from(error: io::Error) -> Self {
        SessionError::Read(ReadError::Io(error))
    }
}

/// How a cast that played ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ended {
    /// The TV tore it down: its remote, or another source.
    ByTv,
    /// [`Playing::serve`] was asked to stop.
    Stopped,
}

/// The session's id, which `SETUP` hands the TV.
const SESSION: &str = "domicile0";

/// The session timeout the TV is told; keepalives go at half of it.
const SESSION_TIMEOUT: Duration = Duration::from_secs(60);

/// How long the TV may take to answer a request, or to take its next step.
const ANSWER_WITHIN: Duration = Duration::from_secs(15);

/// How often [`Playing::serve`] looks at its stop flag while the TV is quiet.
const TICK: Duration = Duration::from_millis(250);

const URI: &str = "rtsp://localhost/wfd1.0";

const PUBLIC: &str = "org.wfa.wfd1.0, SETUP, TEARDOWN, PLAY, PAUSE, GET_PARAMETER, SET_PARAMETER";

/// A session the TV is playing.
pub struct Playing<C: Connection> {
    talk: Talk<C>,
    pub negotiated: Negotiated,
}

/// Agrees on what to send with the TV on `connection`, until it says `PLAY`.
/// `source_address` is this computer's address as the TV reaches it.
pub fn start<C: Connection>(
    connection: C,
    source_address: &str,
) -> Result<Playing<C>, SessionError> {
    let mut talk = Talk::new(connection);
    // M1: the TV must speak Wi-Fi Display.
    talk.exchange(Request::new("OPTIONS", "*", 0).with_header("Require", "org.wfa.wfd1.0"))?;
    // M3: what it plays.
    let answer =
        talk.exchange(Request::new("GET_PARAMETER", URI, 0).with_parameters(wfd::ASKED))?;
    let negotiated = wfd::negotiate(&wfd::capabilities(&rtsp::parameters(&answer.body))?);
    // M4: what it gets.
    talk.exchange(
        Request::new("SET_PARAMETER", URI, 0)
            .with_parameters(&wfd::chosen(&negotiated, source_address)),
    )?;
    // M5: set it up; the TV answers with M6 SETUP and M7 PLAY.
    talk.exchange(trigger("SETUP"))?;
    let deadline = Instant::now() + ANSWER_WITHIN;
    while !talk.playing {
        talk.hear(deadline)?;
    }
    Ok(Playing { talk, negotiated })
}

impl<C: Connection> Playing<C> {
    /// Answers the TV and keeps the session alive until the TV tears it down
    /// or `stop` is set, when it asks the TV to tear it down.
    pub fn serve(mut self, stop: &AtomicBool) -> Result<Ended, SessionError> {
        let keepalive = SESSION_TIMEOUT / 2;
        let mut next_keepalive = Instant::now() + keepalive;
        while !self.talk.torn_down {
            if stop.load(Ordering::Relaxed) {
                // M5: ask the TV to tear it down; it says TEARDOWN. A TV that
                // does not is left: the stream stops either way.
                self.talk.send(trigger("TEARDOWN"))?;
                let deadline = Instant::now() + ANSWER_WITHIN;
                while !self.talk.torn_down && self.talk.hear(deadline).is_ok() {}
                return Ok(Ended::Stopped);
            }
            if Instant::now() >= next_keepalive {
                // M16, answered as it comes.
                self.talk.send(Request::new("GET_PARAMETER", URI, 0))?;
                next_keepalive = Instant::now() + keepalive;
            }
            self.talk.hear_for(TICK)?;
            if self
                .talk
                .unanswered_since
                .is_some_and(|sent| sent.elapsed() > ANSWER_WITHIN)
            {
                return Err(SessionError::Silent);
            }
        }
        Ok(Ended::ByTv)
    }
}

/// `wfd_trigger_method`, which asks the TV to send `method`.
fn trigger(method: &str) -> Request {
    Request::new("SET_PARAMETER", URI, 0)
        .with_parameters(&format!("wfd_trigger_method: {method}\r\n"))
}

/// Both directions of the RTSP connection.
struct Talk<C: Connection> {
    reader: BufReader<C>,
    cseq: u32,
    /// Since when the oldest request sent is unanswered.
    unanswered_since: Option<Instant>,
    playing: bool,
    torn_down: bool,
}

impl<C: Connection> Talk<C> {
    fn new(connection: C) -> Self {
        Self {
            reader: BufReader::new(connection),
            cseq: 0,
            unanswered_since: None,
            playing: false,
            torn_down: false,
        }
    }

    /// Sends `request` with the next `CSeq`, returning it.
    fn send(&mut self, request: Request) -> Result<u32, SessionError> {
        self.cseq += 1;
        let cseq = self.cseq;
        let mut request = request;
        request.headers[0].1 = cseq.to_string();
        rtsp::write(self.reader.get_mut(), &Message::Request(request))?;
        self.unanswered_since.get_or_insert_with(Instant::now);
        Ok(cseq)
    }

    /// Sends `request` and answers the TV until its `200` comes.
    fn exchange(&mut self, request: Request) -> Result<Response, SessionError> {
        let method = request.method.clone();
        let cseq = self.send(request)?;
        let deadline = Instant::now() + ANSWER_WITHIN;
        loop {
            if let Some(response) = self.hear(deadline)? {
                if response.cseq() != Some(cseq) {
                    continue;
                }
                return match response.status {
                    200 => Ok(response),
                    status => Err(SessionError::Refused {
                        method,
                        status,
                        reason: response.reason,
                    }),
                };
            }
        }
    }

    /// Reads one message by `deadline`, answering a request, and returning a
    /// response.
    fn hear(&mut self, deadline: Instant) -> Result<Option<Response>, SessionError> {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() || !self.ready_within(left)? {
            return Err(SessionError::Silent);
        }
        self.read_one()
    }

    /// Reads one message if one comes within `wait`.
    fn hear_for(&mut self, wait: Duration) -> Result<Option<Response>, SessionError> {
        match self.ready_within(wait)? {
            true => self.read_one(),
            false => Ok(None),
        }
    }

    /// Whether a message starts within `wait`. Only the wait for its first
    /// byte times out, so a timeout never splits a message.
    fn ready_within(&mut self, wait: Duration) -> Result<bool, SessionError> {
        self.reader.get_ref().set_read_timeout(Some(wait))?;
        let ready = match self.reader.fill_buf() {
            // An empty buffer is the end of the stream, which the read says.
            Ok(_) => Ok(true),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                Ok(false)
            }
            Err(error) => Err(error),
        }?;
        self.reader
            .get_ref()
            .set_read_timeout(Some(ANSWER_WITHIN))?;
        Ok(ready)
    }

    fn read_one(&mut self) -> Result<Option<Response>, SessionError> {
        match rtsp::read(&mut self.reader)? {
            Message::Response(response) => {
                self.unanswered_since = None;
                Ok(Some(response))
            }
            Message::Request(request) => {
                let answer = self.answer(&request);
                rtsp::write(self.reader.get_mut(), &Message::Response(answer))?;
                Ok(None)
            }
        }
    }

    /// The answer to the TV's `request`.
    fn answer(&mut self, request: &Request) -> Response {
        let ok = request.ok();
        match request.method.as_str() {
            // M2.
            "OPTIONS" => ok.with_header("Public", PUBLIC),
            // M6: the port was agreed in M4.
            "SETUP" => {
                let transport = request.header("Transport").unwrap_or("RTP/AVP/UDP;unicast");
                ok.with_header(
                    "Session",
                    &format!("{SESSION};timeout={}", SESSION_TIMEOUT.as_secs()),
                )
                .with_header("Transport", transport)
            }
            // M7.
            "PLAY" => {
                self.playing = true;
                ok.with_header("Session", SESSION)
            }
            // M8.
            "TEARDOWN" => {
                self.torn_down = true;
                ok.with_header("Session", SESSION)
            }
            // A keepalive from the TV, an IDR request, a pause: all fine.
            _ => ok,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    /// A TV: answers each request it is sent with `answers`, in order, and
    /// sends `then` once it has answered them all.
    fn tv(
        mut stream: UnixStream,
        answers: Vec<(&'static str, &'static str)>,
        then: Vec<Request>,
    ) -> thread::JoinHandle<Vec<Request>> {
        thread::spawn(move || {
            let mut heard = Vec::new();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            for (headers, body) in answers {
                let Ok(Message::Request(request)) = rtsp::read(&mut reader) else {
                    panic!("the source sent no request");
                };
                let mut response = Response {
                    status: 200,
                    reason: "OK".into(),
                    headers: vec![("CSeq".into(), request.cseq().unwrap().to_string())],
                    body: body.into(),
                };
                if !headers.is_empty() {
                    let (name, value) = headers.split_once(": ").unwrap();
                    response = response.with_header(name, value);
                }
                heard.push(request);
                rtsp::write(&mut stream, &Message::Response(response)).unwrap();
            }
            for (cseq, request) in then.into_iter().enumerate() {
                let mut request = request;
                request.headers[0].1 = (100 + cseq).to_string();
                rtsp::write(&mut stream, &Message::Request(request)).unwrap();
                let Ok(Message::Response(response)) = rtsp::read(&mut reader) else {
                    panic!("the source did not answer");
                };
                assert_eq!(response.status, 200);
            }
            heard
        })
    }

    const CAPABILITIES: &str =
        "wfd_video_formats: 00 00 01 08 000000ff 00000000 00000000 00 0000 0000 00 none none\r\n\
        wfd_audio_codecs: AAC 00000001 00\r\n\
        wfd_client_rtp_ports: RTP/AVP/UDP;unicast 1028 0 mode=play\r\n";

    fn plays() -> Vec<Request> {
        vec![
            Request::new("OPTIONS", "*", 0).with_header("Require", "org.wfa.wfd1.0"),
            Request::new("SETUP", "rtsp://192.168.49.1/wfd1.0/streamid=0", 0)
                .with_header("Transport", "RTP/AVP/UDP;unicast;client_port=1028"),
            Request::new("PLAY", "rtsp://192.168.49.1/wfd1.0/streamid=0", 0),
        ]
    }

    #[test]
    fn agrees_on_a_format_and_plays() {
        let (source, sink) = UnixStream::pair().unwrap();
        let tv = tv(
            sink,
            vec![
                ("Public: org.wfa.wfd1.0", ""),
                ("", CAPABILITIES),
                ("", ""),
                ("", ""),
            ],
            plays(),
        );

        let playing = start(source, "192.168.49.1").unwrap();

        assert_eq!(playing.negotiated.mode.width, 1920);
        assert_eq!(playing.negotiated.rtp_port, 1028);
        let heard: Vec<String> = tv.join().unwrap().into_iter().map(|r| r.method).collect();
        assert_eq!(
            heard,
            ["OPTIONS", "GET_PARAMETER", "SET_PARAMETER", "SET_PARAMETER"]
        );
    }

    #[test]
    fn says_why_the_tv_refused() {
        let (source, mut sink) = UnixStream::pair().unwrap();
        let tv = thread::spawn(move || {
            let mut reader = BufReader::new(sink.try_clone().unwrap());
            let _ = rtsp::read(&mut reader).unwrap();
            let refusal = Response {
                status: 551,
                reason: "Option not supported".into(),
                headers: vec![("CSeq".into(), "1".into())],
                body: String::new(),
            };
            rtsp::write(&mut sink, &Message::Response(refusal)).unwrap();
        });

        let error = start(source, "192.168.49.1").err().unwrap();

        tv.join().unwrap();
        assert_eq!(
            error.to_string(),
            "the TV refused `OPTIONS`: 551 Option not supported"
        );
    }

    #[test]
    fn ends_when_the_tv_tears_it_down() {
        let (source, sink) = UnixStream::pair().unwrap();
        let mut then = plays();
        then.push(Request::new(
            "TEARDOWN",
            "rtsp://192.168.49.1/wfd1.0/streamid=0",
            0,
        ));
        let tv = tv(
            sink,
            vec![("", ""), ("", CAPABILITIES), ("", ""), ("", "")],
            then,
        );
        let playing = start(source, "192.168.49.1").unwrap();

        assert_eq!(playing.serve(&AtomicBool::new(false)).unwrap(), Ended::ByTv);
        tv.join().unwrap();
    }

    #[test]
    fn asks_the_tv_to_tear_it_down_when_stopped() {
        let (source, sink) = UnixStream::pair().unwrap();
        let tv = tv(
            sink.try_clone().unwrap(),
            vec![("", ""), ("", CAPABILITIES), ("", ""), ("", "")],
            plays(),
        );
        let playing = start(source, "192.168.49.1").unwrap();
        tv.join().unwrap();
        let asked = thread::spawn(move || {
            let mut reader = BufReader::new(sink.try_clone().unwrap());
            let Ok(Message::Request(request)) = rtsp::read(&mut reader) else {
                panic!();
            };
            let mut sink = sink;
            rtsp::write(&mut sink, &Message::Response(request.ok())).unwrap();
            let teardown = Request::new("TEARDOWN", "rtsp://192.168.49.1/wfd1.0/streamid=0", 200);
            rtsp::write(&mut sink, &Message::Request(teardown)).unwrap();
            let _ = rtsp::read(&mut reader);
            request.body
        });

        assert_eq!(
            playing.serve(&AtomicBool::new(true)).unwrap(),
            Ended::Stopped
        );
        assert_eq!(asked.join().unwrap(), "wfd_trigger_method: TEARDOWN\r\n");
    }
}
