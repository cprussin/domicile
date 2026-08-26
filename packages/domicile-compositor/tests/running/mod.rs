//! A real compositor, started the way a shell starts one.
//!
//! Everything a script used to arrange: a runtime directory of this test's
//! own, a config written where the compositor was told to look, the binary
//! under test rather than whatever is on `PATH`, and a wait for the session it
//! publishes rather than for a socket that appears before it.
//!
//! Killed on drop, so a test that fails an assertion still takes its
//! compositor with it. Not for the display name — each test has a runtime
//! directory of its own, so two compositors cannot collide on one — but
//! because a leaked compositor outlives the whole run: `cargo test` waits for
//! its own children, and nothing else would ever reap it.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use domicile_test_chrome::Chrome;

/// How long a compositor gets to publish its session.
///
/// Generous: this covers an EGL probe on a machine with no GPU, which falls
/// back through software rasterisation and is the slowest thing a headless
/// start does.
const PATIENCE: Duration = Duration::from_secs(20);

/// A compositor process and the directory it was given.
pub struct Compositor {
    child: Child,
    complaint: Arc<Mutex<String>>,
    config_file: PathBuf,
    /// Held, not read: dropping it removes the run directory, and the config
    /// and socket in it. Underscored because that is the whole of its job.
    _directory: tempfile::TempDir,
    session: Session,
}

/// What the compositor published, as this fixture needs it.
pub struct Session {
    pub chrome_socket: PathBuf,
}

impl Compositor {
    /// Start one on `config`, which is the JSON a shell would have generated.
    ///
    /// Panics rather than returning a `Result`: every caller is a test, and a
    /// compositor that would not start is the end of that test either way —
    /// with the difference that a panic here carries its stderr.
    pub fn started_with(config: &str) -> Compositor {
        let directory = tempfile::tempdir().expect("a runtime directory");
        let config_file = directory.path().join("config.json");
        std::fs::write(&config_file, config).expect("the config is written");
        let session_file = directory.path().join("session.json");
        let chrome_socket = directory.path().join("chrome.sock");

        let child = Command::new(env!("CARGO_BIN_EXE_domicile-compositor"))
            .arg("--chrome-socket")
            .arg(&chrome_socket)
            .arg("--session")
            .arg(&session_file)
            .arg("--config")
            .arg(&config_file)
            // Its own, so a display this binds cannot collide with the
            // session the test runner itself is in.
            .env("XDG_RUNTIME_DIR", directory.path())
            // Debug, because some of what a compositor decides it never says
            // over the socket — a density it *refused* is a no-op on the wire,
            // and this log line is the only trace that path leaves. Drained on
            // a thread, so the extra volume costs nothing.
            .env("RUST_LOG", "info,domicile_compositor=debug")
            // Both, and into one buffer. `tracing_subscriber::fmt()` writes to
            // *stdout*, so a fixture that piped only stderr had every log line
            // the compositor ever wrote go to /dev/null — including the ones
            // its own failure messages promise to quote. Panics come out the
            // other one, and a test wants whichever of the two explains it.
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("the compositor starts");

        let mut child = child;
        let complaint = Arc::new(Mutex::new(String::new()));
        drain(child.stdout.take().expect("stdout was piped"), &complaint);
        drain(child.stderr.take().expect("stderr was piped"), &complaint);

        let mut compositor = Compositor {
            child,
            complaint,
            config_file: config_file.clone(),
            _directory: directory,
            session: Session {
                chrome_socket: chrome_socket.clone(),
            },
        };
        compositor.await_session(&session_file);
        compositor
    }

    /// A stand-in chrome, connected and past the handshake.
    pub fn chrome(&self) -> Chrome {
        Chrome::connect(&self.session.chrome_socket, PATIENCE)
            .expect("a chrome can connect to a compositor that published a session")
    }

    /// Rewrite the config the compositor is watching.
    ///
    /// By rename, which is how an editor saves and what the compositor's
    /// watcher is arranged around — a plain write is several events, and the
    /// ones in the middle are a truncated file that parses as a desktop with
    /// no displays in it.
    pub fn reconfigure(&self, config: &str) {
        let staging = self.config_file.with_extension("json.new");
        std::fs::write(&staging, config).expect("the new config is written");
        std::fs::rename(&staging, &self.config_file).expect("it replaces the old one");
    }

    /// Wait for the session document, or say why there will not be one.
    fn await_session(&mut self, session_file: &std::path::Path) {
        let until = Instant::now() + PATIENCE;
        while !session_file.exists() {
            if let Some(status) = self.child.try_wait().expect("the child is waitable") {
                let said = self.complaint();
                panic!(
                    "the compositor exited with {status} instead of publishing a session:\n{said}"
                );
            }
            if Instant::now() >= until {
                let said = self.complaint();
                panic!("the compositor never published a session in {PATIENCE:?}:\n{said}");
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Wait until the compositor has said something containing `pattern`.
    ///
    /// For the decisions that leave no mark on the socket. A test cannot prove
    /// "nothing was broadcast" by waiting — every wait for an absence is
    /// either a sleep or a lie — but it can watch for the compositor saying
    /// why it declined.
    pub fn wait_for_log(&self, pattern: &str) {
        let until = Instant::now() + PATIENCE;
        loop {
            let said = self.complaint();
            if said.contains(pattern) {
                return;
            }
            assert!(
                Instant::now() < until,
                "the compositor never said {pattern:?} in {PATIENCE:?}:\n{said}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Whatever the compositor has said on stderr so far.
    ///
    /// So far, rather than all of it: the compositor is usually still running
    /// when this is asked for, and reading its pipe to end-of-file would wait
    /// for it to exit — which on the timeout path is exactly what has not
    /// happened. Reading to EOF here hung the run in place of failing it, and
    /// a hang has no message at all.
    fn complaint(&self) -> String {
        let said = self.complaint.lock().expect("nothing panics holding this");
        if said.trim().is_empty() {
            "(it said nothing)".to_string()
        } else {
            said.clone()
        }
    }
}

impl Drop for Compositor {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Read one of a compositor's pipes onto a thread of its own, into `said`.
///
/// Two failures at once. A pipe nobody reads fills at 64 KiB and the writer
/// blocks — so a compositor logging at `debug`, which is what these tests ask
/// for, would stop *because* it was being watched. And reading it on demand
/// meant reading to end-of-file, which for a running compositor never comes.
///
/// Bytes rather than lines, appended lossily. A `lines()` loop has to decide
/// what to do with a read error, and every answer is wrong here: stopping
/// leaves `complaint()` returning a log that ends mid-run with nothing saying
/// so, and one stray non-UTF-8 byte — a panic payload, a C library writing
/// through the inherited fd — would turn a compositor's own explanation into a
/// silent truncation, reported as a verdict against the compositor. A
/// replacement character is a much smaller lie.
fn drain(mut pipe: impl std::io::Read + Send + 'static, said: &Arc<Mutex<String>>) {
    let writing = said.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        // What the last read ended in the middle of. A `read` boundary falls
        // wherever the kernel put it, so a multi-byte character can arrive in
        // two halves — decoding each read on its own would put a replacement
        // character into a log that was perfectly good UTF-8.
        let mut pending = Vec::new();
        loop {
            let read = match pipe.read(&mut buffer) {
                // The tail goes out too. It is at most three bytes, and only
                // when the compositor died part-way through a character — but
                // that is the moment a test most wants the last thing it said,
                // and this fixture kills its compositor on drop.
                Ok(0) => return flush(&pending, &writing),
                Ok(read) => read,
                // Said out loud rather than swallowed: this thread is the only
                // reader, so a failure here is the rest of the log going
                // missing, and the message that quotes it has to show that.
                Err(err) => {
                    flush(&pending, &writing);
                    let mut said = writing.lock().expect("nothing panics holding this");
                    said.push_str(&format!("\n(the test could not read on: {err})\n"));
                    return;
                }
            };
            pending.extend_from_slice(&buffer[..read]);
            let mut said = writing.lock().expect("nothing panics holding this");
            said.push_str(&decoded(&mut pending));
        }
    });
}

/// Put whatever is left of a pipe into `said`, whole character or not.
fn flush(pending: &[u8], said: &Mutex<String>) {
    if !pending.is_empty() {
        let mut said = said.lock().expect("nothing panics holding this");
        said.push_str(&String::from_utf8_lossy(pending));
    }
}

/// Everything in `pending` that is a whole character, taken out of it.
///
/// What is left behind is either the start of a character whose rest has not
/// arrived, or nothing. A byte that can never begin one is not waited for —
/// it becomes a replacement character and the log goes on, which is the whole
/// point: a compositor's own explanation is worth more slightly damaged than
/// truncated at the first stray byte.
fn decoded(pending: &mut Vec<u8>) -> String {
    let mut taken = String::new();
    loop {
        let whole = match std::str::from_utf8(pending) {
            Ok(_) => pending.len(),
            Err(err) => match err.error_len() {
                // Cut short: the rest of this character is still on the wire.
                None => err.valid_up_to(),
                // Not a character at all, and never will be. Take it with the
                // valid part so `from_utf8_lossy` replaces it, then go round
                // again — a bad byte in the middle of a read must not hold up
                // the good bytes after it until the *next* read arrives, and
                // on the last read there is no next one.
                Some(bad) => err.valid_up_to() + bad,
            },
        };
        if whole == 0 {
            return taken;
        }
        taken.push_str(&String::from_utf8_lossy(&pending[..whole]));
        pending.drain(..whole);
    }
}

/// A character split across two reads is one character, not two mistakes.
///
/// The `read` boundary falls wherever the kernel put it. Decoding each read on
/// its own would turn a log line that was perfectly good UTF-8 into one with
/// replacement characters in it — and the log is what a failing test quotes.
#[test]
fn a_character_cut_in_half_by_a_read_is_waited_for() {
    let em_dash = "—".as_bytes();
    let (first, rest) = em_dash.split_at(1);

    let mut pending = first.to_vec();
    assert_eq!(decoded(&mut pending), "", "nothing whole has arrived yet");
    pending.extend_from_slice(rest);

    assert_eq!(decoded(&mut pending), "—");
    assert!(pending.is_empty(), "and nothing is left waiting");
}

/// A byte that can never start a character is not waited for.
///
/// The failure this whole path exists for: a panic payload or a C library
/// writing raw bytes through the inherited fd used to end the drain thread, so
/// `complaint()` returned a log that stopped mid-run with nothing saying so.
#[test]
fn a_byte_that_is_not_a_character_costs_one_character_rather_than_the_rest() {
    let mut pending = b"before\xffafter".to_vec();

    let taken = decoded(&mut pending);

    assert!(taken.starts_with("before"), "got {taken:?}");
    assert!(
        taken.ends_with("after"),
        "everything after the bad byte is still there: {taken:?}"
    );
    assert!(pending.is_empty());
}

/// A pipe that ends part-way through a character still gives up its tail.
///
/// The cut this fixture makes itself: `Drop` kills the compositor, so a write
/// in progress is a stream that stops mid-character — at the very moment a
/// failing test most wants the last thing it said.
#[test]
fn what_a_pipe_was_cut_off_mid_character_saying_is_still_reported() {
    let em_dash = "—".as_bytes();
    let (head, _) = em_dash.split_at(2);
    let said = Arc::new(Mutex::new(String::new()));

    drain(
        std::io::Cursor::new([b"cut here: ".as_slice(), head].concat()),
        &said,
    );

    let until = Instant::now() + Duration::from_secs(2);
    loop {
        let text = said.lock().expect("nothing panics holding this").clone();
        if text.starts_with("cut here: ") && text.len() > "cut here: ".len() {
            // The tail is a replacement character rather than nothing: what
            // came before it is the point, and dropping the whole read to
            // avoid one glyph is the bug this exists for.
            assert!(text.ends_with('\u{fffd}'), "got {text:?}");
            return;
        }
        assert!(Instant::now() < until, "the tail never arrived: {text:?}");
        std::thread::sleep(Duration::from_millis(5));
    }
}
