//! Files, watches, processes, D-Bus and screenshots for one chrome connection.
//! The compositor takes the screenshots ([`System::screenshotting_with`]).
//!
//! [`System::handle`] runs a `ChromeMessage::SystemRequest` and sends every
//! answer through the callback it was built with. Nothing here blocks the
//! caller: file calls run on a thread each, and a process has threads for its
//! output and its exit. The lock is the compositor's to check before calling;
//! [`reach`] tells it what a request touches. See
//! `docs/SHELL-SYSTEM-ACCESS.md`.

use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{self, Read, Write};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::UNIX_EPOCH;

use domicile_protocol::{
    Bus, DirEntry, FileType, HostMessage, Signal, Stream, SystemEnd, SystemError, SystemErrorKind,
    SystemEvent, SystemReply, SystemRequest,
};
use notify::{EventKindMask, RecursiveMode, Watcher};
use zbus::blocking::{Connection, MessageIterator};
use zbus::zvariant::{Signature, Structure, StructureBuilder};

use crate::base64::{decoded, encoded};
use crate::dbus_json::{self, NotABody};
use crate::lock_screen_readouts::is_a_readout;

/// How much of a process's output one event carries at most.
const CHUNK: usize = 64 * 1024;

/// Where answers go.
type Tell = Arc<dyn Fn(HostMessage) + Send + Sync>;

/// Variables to set, or with `None` to remove, in every process's environment.
pub type Environment = Vec<(OsString, Option<OsString>)>;

/// The calls one chrome connection has running.
///
/// Dropping it kills its processes and ends its watches, so a page that goes
/// away leaves nothing behind.
pub struct System {
    home: PathBuf,
    environment: Environment,
    tell: Tell,
    running: Arc<Mutex<HashMap<u32, Running>>>,
    connect: Connect,
    /// The connection each bus's calls share, once one was made.
    buses: Arc<Mutex<HashMap<Bus, Connection>>>,
    /// Takes screenshots; `None` on a system that takes none.
    screenshot: Option<Screenshot>,
}

/// Takes a screenshot, into the file if one is given, and returns where it
/// was saved. Blocks until it is saved, the dialog included.
pub type Screenshot = Arc<dyn Fn(Option<PathBuf>) -> Result<PathBuf, SystemError> + Send + Sync>;

/// How a [`System`] reaches a D-Bus bus.
type Connect = Arc<dyn Fn(Bus) -> zbus::Result<Connection> + Send + Sync>;

/// A call that outlives its reply.
enum Running {
    Process {
        /// The process group, which is the process's own pid.
        group: libc::pid_t,
        /// `None` when the process has no stdin or it was closed.
        stdin: Option<Sender<Vec<u8>>>,
    },
    Watch(notify::RecommendedWatcher),
    /// A D-Bus match, on a connection of its own so closing it ends the match.
    Match(Connection),
}

/// What [`System::handle`] did with a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Handled {
    /// Started, answered or applied.
    Done,
    /// It drives an id with nothing running under it: the call already ended,
    /// or never started. Usually a race with an exit, so nothing is sent.
    NothingRunning,
    /// It drives a running id but is malformed: bad base64, or stdin for a
    /// process started without it. Nothing is sent, since only events and the
    /// end may follow a start.
    Malformed,
}

/// What a request touches, for the lock to judge. See `docs/LOCK.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reach {
    /// It ends or quiets something already running.
    Stops,
    /// It only reads the kernel's state under `/sys`.
    ReadsTheKernel,
    /// A lock screen's battery, brightness or volume readout. See
    /// `crate::lock_screen_readouts`.
    Readout,
    /// Anything else.
    Acts,
}

/// What `request` touches.
///
/// A read reaches only the kernel when its path is absolute, under `/sys` and
/// free of `..`. Nothing under `/sys` can be changed by the user, so no symlink
/// can be swapped between this judgment and the read. Any other spelling, such
/// as a symlink in the home that points into `/sys`, is judged
/// [`Reach::Acts`].
///
/// A spawn or D-Bus call is a [`Reach::Readout`] only when it is one of the
/// calls `crate::lock_screen_readouts` lists.
pub fn reach(request: &SystemRequest) -> Reach {
    match request {
        SystemRequest::Unwatch | SystemRequest::CloseStdin | SystemRequest::Kill { .. } => {
            Reach::Stops
        }
        SystemRequest::ReadFile { path }
        | SystemRequest::ReadDir { path }
        | SystemRequest::Stat { path }
        | SystemRequest::Watch { path } => {
            let path = Path::new(path);
            let kernel = path.starts_with("/sys")
                && path
                    .components()
                    .all(|part| !matches!(part, Component::ParentDir));
            match kernel {
                true => Reach::ReadsTheKernel,
                false => Reach::Acts,
            }
        }
        SystemRequest::Spawn { .. }
        | SystemRequest::DbusCall { .. }
        | SystemRequest::DbusMatch { .. } => match is_a_readout(request) {
            true => Reach::Readout,
            false => Reach::Acts,
        },
        SystemRequest::WriteFile { .. }
        | SystemRequest::Stdin { .. }
        | SystemRequest::Screenshot { .. } => Reach::Acts,
    }
}

/// What the page is told when the lock refuses `request`.
///
/// A call that would start something fails with
/// [`SystemErrorKind::Locked`], so the page's promise settles. A call that
/// drives something running gets nothing, since only events and the end may
/// follow a start.
pub fn locked_out(id: u32, request: &SystemRequest) -> Option<HostMessage> {
    match request {
        SystemRequest::ReadFile { .. }
        | SystemRequest::WriteFile { .. }
        | SystemRequest::ReadDir { .. }
        | SystemRequest::Stat { .. }
        | SystemRequest::Watch { .. }
        | SystemRequest::Spawn { .. }
        | SystemRequest::DbusCall { .. }
        | SystemRequest::DbusMatch { .. }
        | SystemRequest::Screenshot { .. } => Some(HostMessage::SystemReply {
            id,
            reply: SystemReply::Failed {
                error: SystemError {
                    kind: SystemErrorKind::Locked,
                    message: "the desktop is locked".into(),
                },
            },
        }),
        SystemRequest::Unwatch
        | SystemRequest::Stdin { .. }
        | SystemRequest::CloseStdin
        | SystemRequest::Kill { .. } => None,
    }
}

impl System {
    /// A system for one connection. Relative paths and processes start from
    /// `home`. Processes inherit this process's environment changed by
    /// `environment`, then the page's `env`. Answers go to `tell`, from any
    /// thread.
    pub fn new(
        home: PathBuf,
        environment: Environment,
        tell: impl Fn(HostMessage) + Send + Sync + 'static,
    ) -> System {
        System {
            home,
            environment,
            tell: Arc::new(tell),
            running: Arc::new(Mutex::new(HashMap::new())),
            connect: Arc::new(|bus| match bus {
                Bus::Session => Connection::session(),
                Bus::System => Connection::system(),
            }),
            buses: Arc::default(),
            screenshot: None,
        }
    }

    /// This system, reaching D-Bus through `connect` instead of the session
    /// and system buses.
    pub fn connecting_with(
        mut self,
        connect: impl Fn(Bus) -> zbus::Result<Connection> + Send + Sync + 'static,
    ) -> System {
        self.connect = Arc::new(connect);
        self
    }

    /// This system, taking screenshots through `screenshot`.
    pub fn screenshotting_with(
        mut self,
        screenshot: impl Fn(Option<PathBuf>) -> Result<PathBuf, SystemError> + Send + Sync + 'static,
    ) -> System {
        self.screenshot = Some(Arc::new(screenshot));
        self
    }

    /// Run `request` under the page's `id`.
    pub fn handle(&self, id: u32, request: SystemRequest) -> Handled {
        match request {
            SystemRequest::ReadFile { path } => self.on_a_thread(id, move |home| {
                std::fs::read(home.join(path)).map(|bytes| SystemReply::Read {
                    data: encoded(&bytes),
                })
            }),
            SystemRequest::WriteFile { path, data, atomic } => self.on_a_thread(id, move |home| {
                let bytes = decoded(&data)
                    .map_err(|err| io::Error::new(io::ErrorKind::InvalidInput, err))?;
                let path = home.join(path);
                match atomic {
                    true => written_atomically(&path, &bytes, id),
                    false => std::fs::write(&path, &bytes),
                }
                .map(|()| SystemReply::Written)
            }),
            SystemRequest::ReadDir { path } => self.on_a_thread(id, move |home| {
                std::fs::read_dir(home.join(path))?
                    .map(|entry| {
                        let entry = entry?;
                        Ok(DirEntry {
                            name: entry.file_name().to_string_lossy().into_owned(),
                            file_type: file_type(entry.file_type()?),
                        })
                    })
                    .collect::<io::Result<_>>()
                    .map(|entries| SystemReply::Entries { entries })
            }),
            SystemRequest::Stat { path } => self.on_a_thread(id, move |home| -> io::Result<_> {
                let metadata = std::fs::metadata(home.join(path))?;
                Ok(SystemReply::Stat {
                    file_type: file_type(metadata.file_type()),
                    size: metadata.len(),
                    modified_ms: metadata
                        .modified()
                        .ok()
                        .and_then(|at| at.duration_since(UNIX_EPOCH).ok())
                        .map(|since| since.as_millis() as u64),
                })
            }),
            SystemRequest::Watch { path } => {
                self.starting(id, |system| Ok(system.watched(id, &path)?))
            }
            SystemRequest::Spawn {
                argv,
                cwd,
                env,
                stdin,
            } => self.starting(id, |system| {
                let (program, args) = argv
                    .split_first()
                    .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "an empty argv"))?;
                let mut command = Command::new(program);
                for (name, value) in &system.environment {
                    match value {
                        Some(value) => command.env(name, value),
                        None => command.env_remove(name),
                    };
                }
                command
                    .args(args)
                    .current_dir(system.home.join(cwd.unwrap_or_default()))
                    .envs(env)
                    .stdin(if stdin { Stdio::piped() } else { Stdio::null() })
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    // Its own group, so a kill reaches what it started too.
                    .process_group(0);
                Ok(system.spawned(id, command.spawn()?)?)
            }),
            SystemRequest::DbusCall {
                bus,
                destination,
                path,
                interface,
                member,
                signature,
                body,
            } => {
                let (connect, buses) = (self.connect.clone(), self.buses.clone());
                self.on_a_thread(id, move |_| -> Result<SystemReply, Failure> {
                    let values = dbus_json::read(&signature, &body)?;
                    let connection = shared(&connect, &buses, bus)?;
                    let returned = if values.is_empty() {
                        connection.call_method(
                            Some(destination.as_str()),
                            path.as_str(),
                            Some(interface.as_str()),
                            member.as_str(),
                            &(),
                        )
                    } else {
                        let arguments = values
                            .into_iter()
                            .fold(StructureBuilder::new(), StructureBuilder::append_field)
                            .build()?;
                        connection.call_method(
                            Some(destination.as_str()),
                            path.as_str(),
                            Some(interface.as_str()),
                            member.as_str(),
                            &arguments,
                        )
                    }?;
                    let (signature, body) = body_of(&returned)?;
                    Ok(SystemReply::Returned { signature, body })
                })
            }
            SystemRequest::DbusMatch {
                bus,
                sender,
                path,
                interface,
                member,
            } => self.starting(id, |system| {
                let rule = [
                    ("sender", sender),
                    ("path", path),
                    ("interface", interface),
                    ("member", member),
                ]
                .into_iter()
                .filter_map(|(field, value)| value.map(|value| format!(",{field}='{value}'")))
                .fold("type='signal'".to_string(), |rule, field| rule + &field);
                let connection = (system.connect)(bus)?;
                let signals = MessageIterator::for_match_rule(rule.as_str(), &connection, None)?;
                let (tell, running) = (system.tell.clone(), system.running.clone());
                let go = move || {
                    thread::spawn(move || matched(id, signals, &tell, &running));
                };
                Ok((Running::Match(connection), Box::new(go)))
            }),
            SystemRequest::Unwatch => {
                let mut running = self.running.lock().unwrap();
                match running.remove(&id) {
                    Some(Running::Watch(watcher)) => {
                        // Under the lock, so no change is told after the end.
                        (self.tell)(HostMessage::SystemEnd {
                            id,
                            end: SystemEnd::Stopped,
                        });
                        // Dropped outside the lock: dropping joins the
                        // watcher's thread, which may be waiting for the lock.
                        drop(running);
                        drop(watcher);
                        Handled::Done
                    }
                    Some(Running::Match(connection)) => {
                        (self.tell)(HostMessage::SystemEnd {
                            id,
                            end: SystemEnd::Stopped,
                        });
                        drop(running);
                        // Ends the match's iterator, and so its thread. An
                        // error here is a connection already gone.
                        let _ = connection.close();
                        Handled::Done
                    }
                    Some(process) => {
                        running.insert(id, process);
                        Handled::Malformed
                    }
                    None => Handled::NothingRunning,
                }
            }
            SystemRequest::Stdin { data } => match self.running.lock().unwrap().get(&id) {
                Some(Running::Process {
                    stdin: Some(stdin), ..
                }) => match decoded(&data) {
                    // The writer stops only after the process closed its end,
                    // and then nobody is reading.
                    Ok(bytes) => {
                        let _ = stdin.send(bytes);
                        Handled::Done
                    }
                    Err(_) => Handled::Malformed,
                },
                Some(_) => Handled::Malformed,
                None => Handled::NothingRunning,
            },
            SystemRequest::CloseStdin => match self.running.lock().unwrap().get_mut(&id) {
                Some(Running::Process { stdin, .. }) => {
                    // Dropping the sender ends the writer, which closes the pipe.
                    stdin.take();
                    Handled::Done
                }
                Some(Running::Watch(_) | Running::Match(_)) => Handled::Malformed,
                None => Handled::NothingRunning,
            },
            SystemRequest::Kill { signal } => match self.running.lock().unwrap().get(&id) {
                Some(Running::Process { group, .. }) => {
                    // SAFETY: `kill` takes plain integers. The group is
                    // registered only until it exits, before it is reaped, so
                    // its pid has not been reused.
                    unsafe { libc::kill(-group, number(signal)) };
                    Handled::Done
                }
                Some(Running::Watch(_) | Running::Match(_)) => Handled::Malformed,
                None => Handled::NothingRunning,
            },
            SystemRequest::Screenshot { file } => {
                let screenshot = self.screenshot.clone();
                self.on_a_thread(id, move |home| -> Result<SystemReply, SystemError> {
                    let screenshot = screenshot.ok_or_else(|| SystemError {
                        kind: SystemErrorKind::Other,
                        message: "this desktop takes no screenshots".into(),
                    })?;
                    let path = screenshot(file.map(|file| home.join(file)))?;
                    Ok(SystemReply::Saved {
                        path: path.display().to_string(),
                    })
                })
            }
        }
    }

    /// Answer a one-shot call from its own thread, so a slow disk does not hold
    /// the connection.
    fn on_a_thread<E>(
        &self,
        id: u32,
        call: impl FnOnce(&Path) -> Result<SystemReply, E> + Send + 'static,
    ) -> Handled
    where
        Failure: From<E>,
    {
        let home = self.home.clone();
        let tell = self.tell.clone();
        thread::spawn(move || {
            tell(HostMessage::SystemReply {
                id,
                reply: call(&home).unwrap_or_else(|failure| failed(Failure::from(failure).into())),
            })
        });
        Handled::Done
    }

    /// Start a watch or process under `id`, unless one is already running
    /// there, and reply.
    ///
    /// `start` returns what to register and what to run once the reply is out.
    /// The lock is held from the start until the reply is sent, so a watch's
    /// first change, which takes the lock, cannot come before it.
    fn starting(
        &self,
        id: u32,
        start: impl FnOnce(&System) -> Result<(Running, Box<dyn FnOnce()>), Failure>,
    ) -> Handled {
        let mut running = self.running.lock().unwrap();
        let (reply, then) = match running.entry(id) {
            Entry::Occupied(_) => (
                failed(error_of(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("{id} is already running"),
                ))),
                None,
            ),
            Entry::Vacant(vacant) => match start(self) {
                Ok((started, then)) => {
                    vacant.insert(started);
                    (SystemReply::Started, Some(then))
                }
                Err(failure) => (failed(failure.into()), None),
            },
        };
        (self.tell)(HostMessage::SystemReply { id, reply });
        drop(running);
        if let Some(then) = then {
            then();
        }
        Handled::Done
    }

    fn watched(&self, id: u32, path: &str) -> io::Result<(Running, Box<dyn FnOnce()>)> {
        let tell = self.tell.clone();
        let running = Arc::downgrade(&self.running);
        let mut watcher = notify::RecommendedWatcher::new(
            move |heard: notify::Result<notify::Event>| {
                let Some(running) = running.upgrade() else {
                    return;
                };
                // Under the lock, so nothing is told after `Unwatch` ends it.
                let mut running = running.lock().unwrap();
                if !matches!(running.get(&id), Some(Running::Watch(_))) {
                    return;
                }
                match heard {
                    Ok(event) => event.paths.into_iter().for_each(|path| {
                        tell(HostMessage::SystemEvent {
                            id,
                            event: SystemEvent::Changed {
                                path: path.display().to_string(),
                            },
                        })
                    }),
                    Err(err) => {
                        // Dropped on another thread: this is the watcher's own
                        // thread, which dropping joins.
                        if let Some(watch) = running.remove(&id) {
                            thread::spawn(move || drop(watch));
                        }
                        tell(HostMessage::SystemEnd {
                            id,
                            end: SystemEnd::Failed {
                                error: SystemError {
                                    kind: SystemErrorKind::Other,
                                    message: err.to_string(),
                                },
                            },
                        });
                    }
                }
            },
            // Opens and closes are left out: a page that reads a file it
            // watches would hear its own reads.
            notify::Config::default().with_event_kinds(EventKindMask::CORE),
        )
        .map_err(io::Error::other)?;
        watcher
            .watch(&self.home.join(path), RecursiveMode::NonRecursive)
            .map_err(|err| match err.kind {
                notify::ErrorKind::PathNotFound => io::Error::from(io::ErrorKind::NotFound),
                notify::ErrorKind::Io(err) => err,
                _ => io::Error::other(err),
            })?;
        Ok((Running::Watch(watcher), Box::new(|| {})))
    }

    /// Register `child`, and return what starts its output and its waiter.
    fn spawned(&self, id: u32, mut child: Child) -> io::Result<(Running, Box<dyn FnOnce()>)> {
        let group = libc::pid_t::try_from(child.id()).expect("a pid fits a pid_t");
        let stdin = child.stdin.take().map(writer);
        let (stdout, stderr) = (child.stdout.take(), child.stderr.take());
        let tell = self.tell.clone();
        let running = self.running.clone();
        let go = move || {
            let readers = [
                stdout.map(|out| reader(tell.clone(), id, Stream::Stdout, out)),
                stderr.map(|err| reader(tell.clone(), id, Stream::Stderr, err)),
            ];
            thread::spawn(move || {
                // All output goes out before the end.
                readers.into_iter().flatten().for_each(|reader| {
                    reader.join().expect("a reader does not panic");
                });
                // Wait without reaping, and stop `Kill` from reaching the
                // group before reaping it, so a signal never reaches a reused
                // pid.
                //
                // SAFETY: `siginfo_t` is plain data, `exited` is valid to
                // write to, and the pid is this process's own child.
                unsafe {
                    let mut exited: libc::siginfo_t = std::mem::zeroed();
                    libc::waitid(
                        libc::P_PID,
                        group as libc::id_t,
                        &mut exited,
                        libc::WEXITED | libc::WNOWAIT,
                    )
                };
                running.lock().unwrap().remove(&id);
                let end = match child.wait() {
                    Ok(status) => SystemEnd::Exited {
                        code: status.code(),
                        signal: status.signal(),
                    },
                    Err(err) => SystemEnd::Failed {
                        error: error_of(err),
                    },
                };
                tell(HostMessage::SystemEnd { id, end });
            });
        };
        Ok((Running::Process { group, stdin }, Box::new(go)))
    }
}

impl Drop for System {
    /// Kill every process and end every watch and match. Each process's waiter
    /// still reaps it.
    fn drop(&mut self) {
        // Taken out first, so the watches drop outside the lock; see `Unwatch`.
        let ended: Vec<Running> = self
            .running
            .lock()
            .unwrap()
            .drain()
            .map(|(_, running)| running)
            .collect();
        for running in ended {
            match running {
                Running::Process { group, .. } => {
                    // SAFETY: as in `handle`'s `Kill`.
                    unsafe { libc::kill(-group, libc::SIGKILL) };
                }
                Running::Watch(watcher) => drop(watcher),
                // The match's iterator holds the connection too, so it must be
                // closed rather than dropped. An error is a connection already
                // gone.
                Running::Match(connection) => {
                    let _ = connection.close();
                }
            }
        }
    }
}

/// A thread that writes what it is sent to `stdin`, so a process that is not
/// reading cannot block the connection.
fn writer(mut stdin: ChildStdin) -> Sender<Vec<u8>> {
    let (send, received) = channel::<Vec<u8>>();
    thread::spawn(move || {
        // Ends when the sender is dropped, which closes the pipe, or when the
        // process closes its end.
        for bytes in received {
            if stdin.write_all(&bytes).is_err() {
                break;
            }
        }
    });
    send
}

/// A thread that sends what `from` produces as `stream` output of `id`.
fn reader(
    tell: Tell,
    id: u32,
    stream: Stream,
    mut from: impl Read + Send + 'static,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = vec![0; CHUNK];
        // A read error ends the stream like an EOF; the exit status says what
        // happened to the process.
        while let Ok(read @ 1..) = from.read(&mut buffer) {
            tell(HostMessage::SystemEvent {
                id,
                event: SystemEvent::Output {
                    stream,
                    data: encoded(&buffer[..read]),
                },
            });
        }
    })
}

/// Write through a temporary file beside `path`, renamed over it.
fn written_atomically(path: &Path, bytes: &[u8], id: u32) -> io::Result<()> {
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no file name"))?;
    let mut temporary = name.to_owned();
    temporary.push(format!(".domicile-{}-{id}", std::process::id()));
    let temporary = path.with_file_name(temporary);
    std::fs::write(&temporary, bytes)
        .and_then(|()| std::fs::rename(&temporary, path))
        .inspect_err(|_| {
            // The write failed already; a leftover temporary is the lesser
            // problem, and the error reported is the write's.
            let _ = std::fs::remove_file(&temporary);
        })
}

fn file_type(of: std::fs::FileType) -> FileType {
    if of.is_symlink() {
        FileType::Symlink
    } else if of.is_dir() {
        FileType::Directory
    } else if of.is_file() {
        FileType::File
    } else {
        FileType::Other
    }
}

fn number(signal: Signal) -> libc::c_int {
    match signal {
        Signal::Hup => libc::SIGHUP,
        Signal::Int => libc::SIGINT,
        Signal::Term => libc::SIGTERM,
        Signal::Kill => libc::SIGKILL,
        Signal::Usr1 => libc::SIGUSR1,
        Signal::Usr2 => libc::SIGUSR2,
    }
}

fn failed(error: SystemError) -> SystemReply {
    SystemReply::Failed { error }
}

/// Why a call failed, before it is told to the page.
enum Failure {
    Io(io::Error),
    Dbus(zbus::Error),
    Body(NotABody),
    /// Already told as the page will be.
    Said(SystemError),
}

impl From<SystemError> for Failure {
    fn from(err: SystemError) -> Failure {
        Failure::Said(err)
    }
}

impl From<io::Error> for Failure {
    fn from(err: io::Error) -> Failure {
        Failure::Io(err)
    }
}

impl From<zbus::Error> for Failure {
    fn from(err: zbus::Error) -> Failure {
        Failure::Dbus(err)
    }
}

impl From<zbus::zvariant::Error> for Failure {
    fn from(err: zbus::zvariant::Error) -> Failure {
        Failure::Dbus(err.into())
    }
}

impl From<NotABody> for Failure {
    fn from(err: NotABody) -> Failure {
        Failure::Body(err)
    }
}

impl From<Failure> for SystemError {
    fn from(failure: Failure) -> SystemError {
        match failure {
            Failure::Io(err) => error_of(err),
            Failure::Dbus(zbus::Error::MethodError(name, text, _)) => SystemError {
                kind: SystemErrorKind::Dbus,
                message: match text {
                    Some(text) => format!("{name}: {text}"),
                    None => name.to_string(),
                },
            },
            // A name that is not a bus, object or member name.
            Failure::Dbus(err @ (zbus::Error::Names(_) | zbus::Error::Variant(_))) => SystemError {
                kind: SystemErrorKind::InvalidInput,
                message: err.to_string(),
            },
            Failure::Dbus(err) => SystemError {
                kind: SystemErrorKind::Other,
                message: err.to_string(),
            },
            Failure::Body(err) => SystemError {
                kind: SystemErrorKind::InvalidInput,
                message: err.to_string(),
            },
            Failure::Said(err) => err,
        }
    }
}

/// The connection `bus`'s calls share, made on the first call.
fn shared(
    connect: &Connect,
    buses: &Mutex<HashMap<Bus, Connection>>,
    bus: Bus,
) -> zbus::Result<Connection> {
    let mut buses = buses.lock().unwrap();
    match buses.get(&bus) {
        Some(connection) => Ok(connection.clone()),
        None => {
            let connection = connect(bus)?;
            buses.insert(bus, connection.clone());
            Ok(connection)
        }
    }
}

/// A message's body as JSON text, and the signature it is read by.
///
/// A body of one structure has the same signature as a body of its fields, so
/// it is written as its fields.
fn body_of(message: &zbus::Message) -> zbus::Result<(String, String)> {
    let body = message.body();
    let signature = body.signature();
    let values = match signature {
        Signature::Unit => Vec::new(),
        _ => body.deserialize::<Structure>()?.into_fields(),
    };
    Ok((signature.to_string_no_parens(), dbus_json::written(&values)))
}

/// Tell each signal `signals` yields as an event of match `id`, until the
/// match is stopped or its connection breaks.
fn matched(id: u32, signals: MessageIterator, tell: &Tell, running: &Mutex<HashMap<u32, Running>>) {
    for signal in signals {
        let told = signal.map_err(Failure::from).and_then(|signal| {
            let header = signal.header();
            let (signature, body) = body_of(&signal)?;
            Ok(SystemEvent::Signal {
                sender: header
                    .sender()
                    .map(|name| name.to_string())
                    .unwrap_or_default(),
                path: header
                    .path()
                    .map(|path| path.to_string())
                    .unwrap_or_default(),
                interface: header
                    .interface()
                    .map(|name| name.to_string())
                    .unwrap_or_default(),
                member: header
                    .member()
                    .map(|name| name.to_string())
                    .unwrap_or_default(),
                signature,
                body,
            })
        });
        // Under the lock, so nothing is told after `Unwatch` ends it.
        let mut running = running.lock().unwrap();
        if !matches!(running.get(&id), Some(Running::Match(_))) {
            return;
        }
        match told {
            Ok(event) => tell(HostMessage::SystemEvent { id, event }),
            Err(failure) => {
                running.remove(&id);
                tell(HostMessage::SystemEnd {
                    id,
                    end: SystemEnd::Failed {
                        error: failure.into(),
                    },
                });
                return;
            }
        }
    }
    // The connection closed without `Unwatch`.
    if running.lock().unwrap().remove(&id).is_some() {
        tell(HostMessage::SystemEnd {
            id,
            end: SystemEnd::Failed {
                error: SystemError {
                    kind: SystemErrorKind::Other,
                    message: "the bus connection closed".into(),
                },
            },
        });
    }
}

fn error_of(err: io::Error) -> SystemError {
    let kind = match err.kind() {
        io::ErrorKind::NotFound => SystemErrorKind::NotFound,
        io::ErrorKind::PermissionDenied => SystemErrorKind::PermissionDenied,
        io::ErrorKind::AlreadyExists => SystemErrorKind::AlreadyExists,
        io::ErrorKind::NotADirectory => SystemErrorKind::NotADirectory,
        io::ErrorKind::IsADirectory => SystemErrorKind::IsADirectory,
        io::ErrorKind::InvalidInput | io::ErrorKind::InvalidData => SystemErrorKind::InvalidInput,
        _ => SystemErrorKind::Other,
    };
    SystemError {
        kind,
        message: err.to_string(),
    }
}
