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

// Each test binary compiles its own copy of this module and uses the part of
// it that its own subject needs, so anything only one file calls is dead code
// in every other. That is a fact about how integration tests are built rather
// than about this fixture: `wait_for_log` has a caller, and so does `socket`,
// just not in the same binary.
#![allow(dead_code)]

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
    /// The directory the compositor was told to run in, which is also where
    /// its Wayland socket lives — so a client this fixture starts is pointed
    /// at the same one rather than at the runner's own session.
    runtime_dir: PathBuf,
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
    /// The display applications connect to, as the compositor named it.
    ///
    /// Read from the session rather than assumed to be `wayland-1`, which is
    /// what the scripts this replaced did — and why they each began by
    /// deleting `$XDG_RUNTIME_DIR/wayland-*`. The compositor picks the first
    /// free name, so the assumption held only for a directory nothing else had
    /// ever bound in, and the deletion was there to force that.
    pub wayland_display: String,
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
            // A decoy, and load-bearing. The compositor aims what it spawns
            // by setting `WAYLAND_DISPLAY`, and a child that inherited the
            // compositor's instead would open on whatever session the runner
            // is in rather than inside Domicile. Left unset, the compositor
            // inherits the runner's — very often `wayland-1`, which is also
            // the first name the compositor binds in a fresh runtime
            // directory, so "inherited" and "aimed" produce the same string
            // and the test cannot tell them apart. `e2e-spawn.sh` set this
            // for the same reason and said so; dropping it made the port
            // silently weaker than the script on any machine running Wayland.
            .env("WAYLAND_DISPLAY", "not-domicile")
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
            runtime_dir: directory.path().to_path_buf(),
            _directory: directory,
            session: Session {
                chrome_socket: chrome_socket.clone(),
                // Filled in from the document itself, below. Empty until the
                // compositor has said what it bound, because until then there
                // is no true answer and a guess would be one a test carries
                // into every client it starts.
                wayland_display: String::new(),
            },
        };
        let published = compositor.await_session(&session_file);
        compositor.session.wayland_display = published.wayland_display;
        compositor
    }

    /// The chrome socket, for a test that has to play the chrome itself —
    /// one whose whole subject is a handshake that does not happen.
    pub fn socket(&self) -> &std::path::Path {
        &self.session.chrome_socket
    }

    /// A stand-in chrome, connected and past the handshake.
    pub fn chrome(&self) -> Chrome {
        Chrome::connect(&self.session.chrome_socket, PATIENCE)
            .expect("a chrome can connect to a compositor that published a session")
    }

    /// Start a real Wayland client against this compositor, and watch what it
    /// says.
    ///
    /// `domicile-test-client` under `--trace`, on the display the compositor
    /// actually published rather than on `wayland-1`. Its trace is the only
    /// window a test has into what the *client* was told — a `close`, an
    /// `enter`, a buffer coming back — because those are events the compositor
    /// sends outward and never mentions on the chrome socket.
    ///
    /// Killed on drop, like the compositor: a client that outlived its test
    /// would hold a window open on a compositor the next test starts.
    pub fn client(&self, title: &str) -> Client {
        self.client_on(&self.session.wayland_display, title)
    }

    fn client_on(&self, display: &str, title: &str) -> Client {
        let mut child = Command::new(test_client_binary())
            .arg("--title")
            .arg(title)
            .arg("--trace")
            .env("WAYLAND_DISPLAY", display)
            .env("XDG_RUNTIME_DIR", &self.runtime_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap_or_else(|why| panic!("the test client starts: {why}"));
        let said = Arc::new(Mutex::new(String::new()));
        drain(child.stdout.take().expect("stdout was piped"), &said);
        drain(child.stderr.take().expect("stderr was piped"), &said);
        Client {
            child,
            said,
            title: title.to_string(),
        }
    }

    /// The display the compositor published for applications.
    pub fn wayland_display(&self) -> &str {
        &self.session.wayland_display
    }

    /// A path inside this compositor's run directory, for a program it starts
    /// to write to.
    ///
    /// In the run directory rather than a temporary of its own so it goes when
    /// the compositor does — a spawned program that outlives its test would
    /// otherwise leave a file nothing owns.
    pub fn scratch_file(&self, name: &str) -> PathBuf {
        self.runtime_dir.join(name)
    }

    /// Wait for `path` to exist and answer with its contents.
    ///
    /// For asking a spawned program what it saw. Fails with what the
    /// compositor said, because the interesting failure is not "no file" but
    /// whatever the compositor did instead of starting the program.
    pub fn await_file(&self, path: &std::path::Path) -> String {
        let until = Instant::now() + PATIENCE;
        loop {
            if let Ok(said) = std::fs::read_to_string(path) {
                return said;
            }
            assert!(
                Instant::now() < until,
                "nothing wrote {} in {PATIENCE:?}; the compositor said:\n{}",
                path.display(),
                self.complaint()
            );
            std::thread::sleep(Duration::from_millis(20));
        }
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

    /// Wait for the session document, and answer with the display it names.
    ///
    /// The document is published by rename, so it is either absent or whole —
    /// which is what makes reading it the moment it exists safe, and why this
    /// waits on the file rather than on the socket it describes.
    fn await_session(
        &mut self,
        session_file: &std::path::Path,
    ) -> domicile_launch::session::Session {
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
        let published = std::fs::read_to_string(session_file).expect("the session is readable");
        // Through the launcher's own type rather than by reaching into the
        // JSON, so a field this reads is one a shell would have got too. A
        // session that will not parse is the compositor having published
        // something no shell could start against, which is a failure of the
        // subject rather than of the fixture.
        serde_json::from_str::<domicile_launch::session::Session>(&published).unwrap_or_else(
            |why| {
                let said = self.complaint();
                panic!(
                "the compositor published a session no shell could read: {why}\n{published}\n{said}"
            )
            },
        )
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

/// A `domicile-test-client` talking to the compositor.
pub struct Client {
    child: Child,
    said: Arc<Mutex<String>>,
    title: String,
}

impl Client {
    /// Wait for the client to exit, and answer whether it did so cleanly.
    ///
    /// The end of `e2e-close`'s question: a client told to close is one that
    /// *goes*, and a client still running is the failure that check exists
    /// for. Bounded, because a client that ignores the request would otherwise
    /// hang the run rather than fail it.
    pub fn wait_for_exit(&mut self) -> bool {
        let until = Instant::now() + PATIENCE;
        loop {
            match self.child.try_wait().expect("the client is waitable") {
                Some(status) => return status.success(),
                None if Instant::now() >= until => panic!(
                    "the client {:?} was still running after {PATIENCE:?}:\n{}",
                    self.title,
                    self.trace()
                ),
                None => std::thread::sleep(Duration::from_millis(20)),
            }
        }
    }

    /// Wait until the client has traced at least `wanted` lines matching
    /// `pattern`, and answer whether it did.
    ///
    /// Counted rather than merely present, because the questions here are
    /// about *how many* screens a client was told about, and one is the answer
    /// a broken compositor gives. Bounded, so a compositor that never says it
    /// fails the assertion that follows rather than hanging the run.
    pub fn wait_for_trace(&mut self, pattern: &str, wanted: usize) -> bool {
        let until = Instant::now() + PATIENCE;
        loop {
            if self.trace().matches(pattern).count() >= wanted {
                return true;
            }
            if Instant::now() >= until {
                return false;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// What the client was told each screen is, one entry per `wl_output`.
    ///
    /// The same fields `wayland-info` printed for the shell check this
    /// replaces — name, position, scale, and the mode with its flags — read
    /// out of the client's own trace instead. That is what lets this run
    /// anywhere: the script skipped when `wayland-info` was missing, and while
    /// CI installs it, every machine without it got a pass for a check that
    /// had not run.
    ///
    /// Every field is one a client acts on, which is why none is dropped: the
    /// position places the screen, the scale is what a toolkit draws at, the
    /// mode is the logical size in physical pixels, and the flags are two
    /// separate promises — `current` and `preferred` — each of which a
    /// one-line mutation can drop on its own.
    pub fn screens(&self) -> Vec<String> {
        let trace = self.trace();
        let mut found: Vec<(String, Screen)> = Vec::new();
        for line in trace.lines() {
            let Some((object, event)) = line.split_once('.') else {
                continue;
            };
            let object = object.trim();
            if !object.contains("wl_output") {
                continue;
            }
            let slot = match found.iter().position(|(id, _)| id == object) {
                Some(at) => at,
                None => {
                    found.push((object.to_string(), Screen::default()));
                    found.len() - 1
                }
            };
            found[slot].1.take(event.trim());
        }
        found.into_iter().map(|(_, screen)| screen.said()).collect()
    }

    /// Whatever the client has traced so far.
    pub fn trace(&self) -> String {
        let said = self.said.lock().expect("nothing panics holding this");
        if said.trim().is_empty() {
            "(it said nothing)".to_string()
        } else {
            said.clone()
        }
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// One screen, as the client was told about it.
///
/// Built up across the four events that describe an output rather than read
/// from one, because that is how Wayland says it: `name`, `geometry`, `mode`
/// and `scale` arrive separately and a client knows the screen only once it
/// has them all.
#[derive(Default)]
struct Screen {
    name: Option<String>,
    position: Option<String>,
    scale: Option<String>,
    mode: Option<String>,
}

impl Screen {
    /// Take whatever one traced event says about this screen.
    ///
    /// Unknown events are ignored rather than refused: the client traces more
    /// than this reads, and a compositor that starts sending something new
    /// should not fail a check about geometry.
    fn take(&mut self, event: &str) {
        let Some((name, rest)) = event.split_once('(') else {
            return;
        };
        let args: Vec<&str> = rest.trim_end_matches(')').split(", ").collect();
        match (name, args.as_slice()) {
            ("name", [called]) => self.name = Some(called.trim_matches('"').to_string()),
            ("geometry", [x, y, ..]) => self.position = Some(format!("{x},{y}")),
            ("scale", [factor]) => self.scale = Some((*factor).to_string()),
            ("mode", [flags, width, height, ..]) => {
                self.mode = Some(format!("{width}x{height}({})", Self::flags(flags)));
            }
            _ => {}
        }
    }

    /// `wl_output.mode`'s flags, spelled the way the protocol names them.
    ///
    /// Named rather than left as a number so a mode advertised as neither
    /// current nor preferred reads as `(none)` instead of `(0)` — a client
    /// bound to a screen with nothing to draw at, which is a real failure and
    /// an unreadable one as an integer.
    ///
    /// The two bits are separately droppable, which is why both are spelled.
    /// `change_current_state` writes only `current_mode`; `preferred_mode` is
    /// written solely by `set_preferred`, so deleting `restate_output`'s call
    /// to it leaves `(current)` and fails the check below. `preferred` alone
    /// would leave a client bound to a screen with no mode to draw at, and
    /// `current` alone a toolkit choosing a mode with nothing marked
    /// preferred; a number would make those two failures look like one.
    fn flags(said: &str) -> String {
        // Not a fallback: `take` matches the arity first, so a torn line never
        // reaches here and the only way in is the client changing its trace
        // format. Defaulting to 0 would render that harness break as `(none)`
        // — this function's own word for a real compositor fault.
        let bits: u32 = said
            .parse()
            .expect("the client traces a mode's flags as a number");
        let mut named = Vec::new();
        if bits & 1 != 0 {
            named.push("current");
        }
        if bits & 2 != 0 {
            named.push("preferred");
        }
        if named.is_empty() {
            named.push("none");
        }
        named.join(" ")
    }

    /// The one line this screen was described in, or what is still missing.
    ///
    /// A screen the client was told only half about is its own failure, and
    /// naming the absent field beats comparing against a string with a hole
    /// in it.
    fn said(&self) -> String {
        match (&self.name, &self.position, &self.scale, &self.mode) {
            (Some(name), Some(position), Some(scale), Some(mode)) => {
                format!("{name}@{position}@{scale}={mode}")
            }
            _ => format!(
                "an output described only as name={:?} position={:?} scale={:?} mode={:?}",
                self.name, self.position, self.scale, self.mode
            ),
        }
    }
}

/// Where `domicile-test-client` was built.
///
/// `CARGO_BIN_EXE_` covers only the binaries of the crate under test, so the
/// client — another crate's — has to be found rather than handed over. Its
/// sibling of the compositor binary is where cargo puts it, and taking the
/// path from the compositor's own means it follows a `--release` or a custom
/// `--target-dir` without this knowing about either.
///
/// Checked rather than assumed: `cargo test -p domicile-compositor` does not
/// build another crate's binary — cargo has no stable way to depend on one, so
/// it has to be asked for separately — and a missing file would otherwise
/// surface as a bare `NotFound` against a path nobody in the test wrote.
fn test_client_binary() -> PathBuf {
    let compositor = PathBuf::from(env!("CARGO_BIN_EXE_domicile-compositor"));
    let client = compositor
        .parent()
        .expect("the compositor binary is in a directory")
        .join("domicile-test-client");
    assert!(
        client.exists(),
        "{} is not built; `cargo test --workspace` builds it, \
         or `cargo build -p domicile-test-client` on its own",
        client.display()
    );
    client
}
