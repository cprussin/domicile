//! Behavior tests for `domicile_host::system`, against a real disk and real
//! processes.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

use domicile_host::system::{locked_out, reach, Handled, Reach, System};
use domicile_protocol::{
    Bus, FileType, HostMessage, Signal, Stream, SystemEnd, SystemErrorKind, SystemEvent,
    SystemReply, SystemRequest,
};

/// How long a test waits for the next message before failing.
const PATIENCE: Duration = Duration::from_secs(10);

/// A [`System`] in `home`, and what it sends.
fn system_in(home: &Path) -> (System, Receiver<HostMessage>) {
    let (told, heard) = channel();
    let system = System::new(home.to_path_buf(), Vec::new(), move |message| {
        // A test that has finished stops listening; the process may still talk.
        let _ = told.send(message);
    });
    (system, heard)
}

fn next(heard: &Receiver<HostMessage>) -> HostMessage {
    heard.recv_timeout(PATIENCE).expect("a message in time")
}

fn reply(heard: &Receiver<HostMessage>, id: u32) -> SystemReply {
    match next(heard) {
        HostMessage::SystemReply { id: replied, reply } if replied == id => reply,
        other => panic!("expected a reply to {id}, heard {other:?}"),
    }
}

fn failure(reply: SystemReply) -> SystemErrorKind {
    match reply {
        SystemReply::Failed { error } => error.kind,
        other => panic!("expected a failure, got {other:?}"),
    }
}

/// Everything a process sends until it ends: its stdout, its stderr and how it
/// ended.
fn run_out(heard: &Receiver<HostMessage>, id: u32) -> (String, String, SystemEnd) {
    let (mut out, mut err) = (Vec::new(), Vec::new());
    loop {
        match next(heard) {
            HostMessage::SystemEvent {
                id: from,
                event: SystemEvent::Output { stream, data },
            } if from == id => {
                let bytes = domicile_host::base64::decoded(&data).expect("base64");
                match stream {
                    Stream::Stdout => out.extend(bytes),
                    Stream::Stderr => err.extend(bytes),
                }
            }
            HostMessage::SystemEnd { id: from, end } if from == id => {
                return (
                    String::from_utf8(out).expect("utf-8"),
                    String::from_utf8(err).expect("utf-8"),
                    end,
                );
            }
            other => panic!("expected output from {id}, heard {other:?}"),
        }
    }
}

fn spawn(argv: &[&str]) -> SystemRequest {
    SystemRequest::Spawn {
        argv: argv.iter().map(|arg| arg.to_string()).collect(),
        cwd: None,
        env: BTreeMap::new(),
        stdin: false,
    }
}

fn exited(code: i32) -> SystemEnd {
    SystemEnd::Exited {
        code: Some(code),
        signal: None,
    }
}

mod files {
    use super::*;

    #[test]
    fn a_relative_path_is_read_from_the_home() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(home.path().join("note"), "hi").unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(
            1,
            SystemRequest::ReadFile {
                path: "note".into(),
                offset: 0,
                length: None,
            },
        );

        assert_eq!(
            reply(&heard, 1),
            SystemReply::Read {
                data: "aGk=".into()
            }
        );
    }

    #[test]
    fn a_range_reads_only_its_bytes() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(home.path().join("note"), "a big hi").unwrap();
        let (system, heard) = system_in(home.path());

        // "hi", whether the range ends at the file's end or past it. One at a
        // time: each read answers from its own thread.
        for (id, length) in [(1, Some(2)), (2, Some(100)), (3, None)] {
            system.handle(
                id,
                SystemRequest::ReadFile {
                    path: "note".into(),
                    offset: 6,
                    length,
                },
            );
            assert_eq!(
                reply(&heard, id),
                SystemReply::Read {
                    data: "aGk=".into()
                },
                "{id}"
            );
        }
    }

    #[test]
    fn a_missing_file_is_not_found() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(
            1,
            SystemRequest::ReadFile {
                path: "/no/such/file".into(),
                offset: 0,
                length: None,
            },
        );

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::NotFound);
    }

    #[test]
    fn a_file_is_written_whole_either_way() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        for (id, atomic) in [(1, true), (2, false)] {
            let name = format!("written-{id}");
            system.handle(
                id,
                SystemRequest::WriteFile {
                    path: name.clone(),
                    data: "aGk=".into(),
                    atomic,
                },
            );

            assert_eq!(reply(&heard, id), SystemReply::Written);
            assert_eq!(std::fs::read(home.path().join(name)).unwrap(), b"hi");
        }
        // An atomic write leaves no temporary file behind.
        assert_eq!(std::fs::read_dir(home.path()).unwrap().count(), 2);
    }

    #[test]
    fn data_that_is_not_base64_is_refused() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(
            1,
            SystemRequest::WriteFile {
                path: "f".into(),
                data: "not base64!".into(),
                atomic: false,
            },
        );

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::InvalidInput);
        assert!(!home.path().join("f").exists());
    }

    #[test]
    fn a_directory_lists_each_entry_with_its_own_type() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(home.path().join("file"), "").unwrap();
        std::fs::create_dir(home.path().join("dir")).unwrap();
        std::os::unix::fs::symlink("dir", home.path().join("link")).unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(1, SystemRequest::ReadDir { path: "".into() });

        let SystemReply::Entries { mut entries } = reply(&heard, 1) else {
            panic!("expected entries");
        };
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        let listed: Vec<_> = entries
            .into_iter()
            .map(|entry| (entry.name, entry.file_type))
            .collect();
        assert_eq!(
            listed,
            vec![
                ("dir".to_string(), FileType::Directory),
                ("file".to_string(), FileType::File),
                ("link".to_string(), FileType::Symlink),
            ]
        );
    }

    #[test]
    fn a_stat_follows_symlinks() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(home.path().join("file"), "four").unwrap();
        std::os::unix::fs::symlink("file", home.path().join("link")).unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(
            1,
            SystemRequest::Stat {
                path: "link".into(),
            },
        );

        let SystemReply::Stat {
            file_type,
            size,
            modified_ms,
        } = reply(&heard, 1)
        else {
            panic!("expected a stat");
        };
        assert_eq!((file_type, size), (FileType::File, 4));
        assert!(modified_ms.is_some());
    }
}

mod processes {
    use super::*;

    #[test]
    fn a_process_sends_its_output_then_how_it_exited() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(1, spawn(&["sh", "-c", "echo out; echo err >&2; exit 3"]));

        assert_eq!(reply(&heard, 1), SystemReply::Started);
        assert_eq!(
            run_out(&heard, 1),
            ("out\n".into(), "err\n".into(), exited(3))
        );
    }

    #[test]
    fn a_process_runs_in_the_home_with_the_environment_it_was_given() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(
            1,
            SystemRequest::Spawn {
                argv: vec!["sh".into(), "-c".into(), "echo $GREETING; pwd".into()],
                cwd: None,
                env: BTreeMap::from([("GREETING".into(), "hello".into())]),
                stdin: false,
            },
        );

        assert_eq!(reply(&heard, 1), SystemReply::Started);
        let (out, _, end) = run_out(&heard, 1);
        let home = home.path().canonicalize().unwrap();
        assert_eq!(out, format!("hello\n{}\n", home.display()));
        assert_eq!(end, exited(0));
    }

    /// The desktop's own variables, such as its `WAYLAND_DISPLAY`, are set or
    /// removed before the page's.
    #[test]
    fn a_process_runs_in_the_desktops_environment() {
        let home = tempfile::tempdir().unwrap();
        let (told, heard) = channel();
        let system = System::new(
            home.path().to_path_buf(),
            vec![
                ("DESKTOP_SET".into(), Some("desk".into())),
                ("HOME".into(), None),
                ("PAGE_WINS".into(), Some("desk".into())),
            ],
            move |message| {
                let _ = told.send(message);
            },
        );

        system.handle(
            1,
            SystemRequest::Spawn {
                argv: vec![
                    "sh".into(),
                    "-c".into(),
                    "echo $DESKTOP_SET ${HOME-unset} $PAGE_WINS".into(),
                ],
                cwd: None,
                env: BTreeMap::from([("PAGE_WINS".into(), "page".into())]),
                stdin: false,
            },
        );

        assert_eq!(reply(&heard, 1), SystemReply::Started);
        assert_eq!(run_out(&heard, 1).0, "desk unset page\n");
    }

    #[test]
    fn a_process_reads_what_it_is_written() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(
            1,
            SystemRequest::Spawn {
                argv: vec!["cat".into()],
                cwd: None,
                env: BTreeMap::new(),
                stdin: true,
            },
        );
        assert_eq!(reply(&heard, 1), SystemReply::Started);
        system.handle(
            1,
            SystemRequest::Stdin {
                data: "aGk=".into(),
            },
        );
        system.handle(1, SystemRequest::CloseStdin);

        assert_eq!(run_out(&heard, 1), ("hi".into(), "".into(), exited(0)));
    }

    #[test]
    fn a_killed_process_reports_the_signal() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(1, spawn(&["sleep", "100"]));
        assert_eq!(reply(&heard, 1), SystemReply::Started);
        system.handle(
            1,
            SystemRequest::Kill {
                signal: Signal::Term,
            },
        );

        assert_eq!(
            run_out(&heard, 1).2,
            SystemEnd::Exited {
                code: None,
                signal: Some(libc::SIGTERM),
            }
        );
    }

    #[test]
    fn a_program_that_is_not_installed_is_not_found() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(1, spawn(&["domicile-no-such-program"]));

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::NotFound);
    }

    #[test]
    fn an_empty_argv_is_refused() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(1, spawn(&[]));

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::InvalidInput);
    }

    #[test]
    fn an_id_that_is_running_cannot_start_another() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(1, spawn(&["sleep", "100"]));
        assert_eq!(reply(&heard, 1), SystemReply::Started);
        system.handle(1, spawn(&["true"]));

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::InvalidInput);
    }

    #[test]
    fn driving_an_id_that_is_not_running_says_so() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        assert_eq!(
            system.handle(
                9,
                SystemRequest::Kill {
                    signal: Signal::Term
                }
            ),
            Handled::NothingRunning
        );
        assert!(heard.recv_timeout(Duration::from_millis(100)).is_err());
    }

    /// A page that goes away takes its processes with it.
    #[test]
    fn dropping_the_system_ends_its_processes() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(1, spawn(&["sh", "-c", "echo $$; exec sleep 100"]));
        assert_eq!(reply(&heard, 1), SystemReply::Started);
        let HostMessage::SystemEvent {
            event: SystemEvent::Output { data, .. },
            ..
        } = next(&heard)
        else {
            panic!("expected the pid");
        };
        let pid = String::from_utf8(domicile_host::base64::decoded(&data).unwrap()).unwrap();
        let proc = Path::new("/proc").join(pid.trim());
        drop(system);

        let deadline = Instant::now() + PATIENCE;
        while proc.exists() {
            assert!(Instant::now() < deadline, "{} is still running", pid.trim());
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

mod watches {
    use super::*;

    #[test]
    fn a_watch_reports_changes_until_it_is_stopped() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(1, SystemRequest::Watch { path: "".into() });
        assert_eq!(reply(&heard, 1), SystemReply::Started);
        let file = home.path().join("new");
        std::fs::write(&file, "").unwrap();

        let HostMessage::SystemEvent {
            id: 1,
            event: SystemEvent::Changed { path },
        } = next(&heard)
        else {
            panic!("expected a change");
        };
        assert_eq!(path, file.display().to_string());

        assert_eq!(system.handle(1, SystemRequest::Unwatch), Handled::Done);
        // Changes may still be queued ahead of the end; the end comes last.
        loop {
            match next(&heard) {
                HostMessage::SystemEvent { id: 1, .. } => continue,
                end => {
                    assert_eq!(
                        end,
                        HostMessage::SystemEnd {
                            id: 1,
                            end: SystemEnd::Stopped
                        }
                    );
                    break;
                }
            }
        }
    }

    #[test]
    fn watching_a_missing_path_fails() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(
            1,
            SystemRequest::Watch {
                path: "missing".into(),
            },
        );

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::NotFound);
    }
}

/// What the lock needs to know about a request.
mod reaches {
    use super::*;

    #[test]
    fn reading_the_kernel_is_told_apart_from_reading_anything_else() {
        let read = |path: &str| SystemRequest::ReadFile {
            path: path.into(),
            offset: 0,
            length: None,
        };

        assert_eq!(reach(&read("/sys/class")), Reach::ReadsTheKernel);
        assert_eq!(
            reach(&SystemRequest::Stat {
                path: "/sys/kernel".into()
            }),
            Reach::ReadsTheKernel
        );
        assert_eq!(reach(&read("/sys/../etc/passwd")), Reach::Acts);
        assert_eq!(reach(&read("/sysfs")), Reach::Acts);
        assert_eq!(reach(&read("/proc/self/status")), Reach::Acts);
        // Relative paths start in the home, where a symlink into `/sys` could
        // be swapped for one out of it after the lock has judged it.
        assert_eq!(reach(&read("sys/class")), Reach::Acts);
    }

    #[test]
    fn stopping_something_is_its_own_reach() {
        for stops in [
            SystemRequest::Unwatch,
            SystemRequest::CloseStdin,
            SystemRequest::Kill {
                signal: Signal::Kill,
            },
        ] {
            assert_eq!(reach(&stops), Reach::Stops);
        }
        for acts in [
            spawn(&["true"]),
            SystemRequest::Stdin { data: "".into() },
            SystemRequest::WriteFile {
                path: "/sys/power/state".into(),
                data: "".into(),
                atomic: false,
            },
        ] {
            assert_eq!(reach(&acts), Reach::Acts);
        }
    }
}

/// What a refused request gets while the desktop is locked.
mod locked {
    use super::*;

    #[test]
    fn a_call_that_would_start_something_is_told_it_is_locked() {
        let Some(HostMessage::SystemReply {
            id: 4,
            reply: SystemReply::Failed { error },
        }) = locked_out(4, &spawn(&["true"]))
        else {
            panic!("expected a failure for 4");
        };
        assert_eq!(error.kind, SystemErrorKind::Locked);
    }

    /// Only events and the end may follow a start, so a refused write to a
    /// running process's stdin gets nothing.
    #[test]
    fn a_call_that_drives_something_running_gets_nothing() {
        assert_eq!(
            locked_out(4, &SystemRequest::Stdin { data: "".into() }),
            None
        );
    }
}

/// D-Bus calls and matches, against a service on a peer-to-peer connection
/// rather than a bus, so no bus daemon is needed.
mod dbus {
    use std::os::unix::net::UnixStream;
    use std::sync::{Arc, Mutex};

    use zbus::blocking::connection::Builder;
    use zbus::blocking::Connection;

    use super::*;

    /// The service the tests call.
    struct Greeter;

    #[zbus::interface(name = "org.domicile.Test")]
    impl Greeter {
        fn greet(&self, name: &str, times: u32) -> String {
            format!("hello {name}").repeat(times as usize)
        }

        fn fail(&self) -> zbus::fdo::Result<()> {
            Err(zbus::fdo::Error::Failed("on purpose".into()))
        }
    }

    /// Each connection the system opens, by the service's end of it.
    type Services = Arc<Mutex<Vec<Connection>>>;

    /// A system whose buses are each a fresh connection to a [`Greeter`].
    fn connected(home: &Path) -> (System, Receiver<HostMessage>, Services) {
        let services: Services = Arc::default();
        let (told, heard) = channel();
        let system = System::new(home.to_path_buf(), Vec::new(), move |message| {
            let _ = told.send(message);
        })
        .connecting_with({
            let services = services.clone();
            move |_bus| {
                let (ours, theirs) = UnixStream::pair()?;
                let serving = std::thread::spawn(move || {
                    Builder::async_io_unix_stream(theirs)
                        .server(zbus::Guid::generate())?
                        .p2p()
                        .serve_at("/test", Greeter)?
                        .build()
                });
                let client = Builder::async_io_unix_stream(ours).p2p().build()?;
                services
                    .lock()
                    .unwrap()
                    .push(serving.join().expect("the service starts")?);
                Ok(client)
            }
        });
        (system, heard, services)
    }

    fn call(member: &str, signature: &str, body: &str) -> SystemRequest {
        SystemRequest::DbusCall {
            bus: Bus::Session,
            destination: "org.domicile.Test".into(),
            path: "/test".into(),
            interface: "org.domicile.Test".into(),
            member: member.into(),
            signature: signature.into(),
            body: body.into(),
        }
    }

    #[test]
    fn a_call_returns_its_body_as_json() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard, _services) = connected(home.path());

        system.handle(1, call("Greet", "su", r#"["ada", 2]"#));

        assert_eq!(
            reply(&heard, 1),
            SystemReply::Returned {
                signature: "s".into(),
                body: r#"["hello adahello ada"]"#.into(),
            }
        );
    }

    #[test]
    fn a_method_error_is_named() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard, _services) = connected(home.path());

        system.handle(1, call("Fail", "", "[]"));

        let SystemReply::Failed { error } = reply(&heard, 1) else {
            panic!("expected a failure");
        };
        assert_eq!(error.kind, SystemErrorKind::Dbus);
        assert!(
            error
                .message
                .starts_with("org.freedesktop.DBus.Error.Failed"),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_body_that_does_not_fit_is_refused() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard, _services) = connected(home.path());

        system.handle(1, call("Greet", "su", r#"["ada"]"#));

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::InvalidInput);
    }

    #[test]
    fn a_match_reports_signals_until_it_is_stopped() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard, services) = connected(home.path());

        system.handle(
            1,
            SystemRequest::DbusMatch {
                bus: Bus::Session,
                sender: None,
                path: None,
                interface: Some("org.domicile.Test".into()),
                member: Some("Pinged".into()),
            },
        );
        assert_eq!(reply(&heard, 1), SystemReply::Started);
        let service = services.lock().unwrap().last().cloned().expect("a service");
        service
            .emit_signal(None::<&str>, "/test", "org.domicile.Test", "Ignored", &())
            .unwrap();
        service
            .emit_signal(
                None::<&str>,
                "/test",
                "org.domicile.Test",
                "Pinged",
                &(7u32,),
            )
            .unwrap();

        let HostMessage::SystemEvent {
            id: 1,
            event:
                SystemEvent::Signal {
                    path,
                    interface,
                    member,
                    signature,
                    body,
                    ..
                },
        } = next(&heard)
        else {
            panic!("expected the signal");
        };
        assert_eq!(
            (path, interface, member, signature, body),
            (
                "/test".into(),
                "org.domicile.Test".into(),
                "Pinged".into(),
                "u".into(),
                "[7]".into()
            )
        );

        assert_eq!(system.handle(1, SystemRequest::Unwatch), Handled::Done);
        assert_eq!(
            next(&heard),
            HostMessage::SystemEnd {
                id: 1,
                end: SystemEnd::Stopped
            }
        );
    }

    /// A page that goes away leaves no match listening.
    #[test]
    fn dropping_the_system_closes_its_matches() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard, services) = connected(home.path());
        system.handle(
            1,
            SystemRequest::DbusMatch {
                bus: Bus::Session,
                sender: None,
                path: None,
                interface: None,
                member: None,
            },
        );
        assert_eq!(reply(&heard, 1), SystemReply::Started);
        let service = services.lock().unwrap().last().cloned().expect("a service");

        drop(system);

        let (closed, heard_closed) = channel();
        std::thread::spawn(move || {
            service.closed();
            let _ = closed.send(());
        });
        heard_closed
            .recv_timeout(PATIENCE)
            .expect("the match's connection closes with the system");
    }

    #[test]
    fn calls_and_matches_are_actions_to_the_lock() {
        assert_eq!(reach(&call("Greet", "", "[]")), Reach::Acts);
        assert_eq!(
            reach(&SystemRequest::DbusMatch {
                bus: Bus::System,
                sender: None,
                path: None,
                interface: None,
                member: None,
            }),
            Reach::Acts
        );
        assert!(locked_out(1, &call("Greet", "", "[]")).is_some());
    }
}
