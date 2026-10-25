//! Behavior tests for `domicile_host::system`, against a real disk and real
//! processes.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

use domicile_host::priority;
use domicile_host::system::{locked_out, reach, refused_to_an_app, Handled, Reach, System};
use domicile_protocol::{
    Bus, FileType, HostMessage, PreviewedWindow, Signal, Stream, SystemEnd, SystemErrorKind,
    SystemEvent, SystemReply, SystemRequest,
};

/// How long a test waits for the next message before failing.
const PATIENCE: Duration = Duration::from_secs(10);

/// A [`System`] in `home`, and what it sends.
fn system_in(home: &Path) -> (System, Receiver<HostMessage>) {
    system_starting_at(home, ours())
}

/// As [`system_in`], starting processes at nice `nice`.
fn system_starting_at(home: &Path, nice: i32) -> (System, Receiver<HostMessage>) {
    let (told, heard) = channel();
    let system = System::new(home.to_path_buf(), Vec::new(), nice, move |message| {
        // A test that has finished stops listening; the process may still talk.
        let _ = told.send(message);
    });
    (system, heard)
}

/// This thread's nice value, which a process may always start at.
fn ours() -> i32 {
    priority::nice(priority::this_thread()).unwrap()
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
    fn a_directory_is_created_once() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        // One at a time: each call answers from its own thread, so the second
        // could otherwise create the directory first.
        system.handle(1, SystemRequest::CreateDir { path: "new".into() });
        assert_eq!(reply(&heard, 1), SystemReply::Created);
        assert!(home.path().join("new").is_dir());

        system.handle(2, SystemRequest::CreateDir { path: "new".into() });
        assert_eq!(failure(reply(&heard, 2)), SystemErrorKind::AlreadyExists);
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

    /// The compositor raises its own threads; a page's processes start at the
    /// nice value they are given instead.
    #[test]
    fn a_process_starts_at_the_nice_value_the_system_was_given() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_starting_at(home.path(), ours() + 3);

        system.handle(1, spawn(&["nice"]));

        assert_eq!(reply(&heard, 1), SystemReply::Started);
        let (out, _, end) = run_out(&heard, 1);
        assert_eq!((out, end), (format!("{}\n", ours() + 3), exited(0)));
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
            ours(),
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
            SystemRequest::Screenshot { file: None },
            SystemRequest::PreviewWindow {
                window: PreviewedWindow::App { id: "app-1".into() },
            },
        ] {
            assert_eq!(reach(&acts), Reach::Acts);
        }
    }
}

/// Screenshots, taken by whatever the compositor hands the system.
mod screenshots {
    use std::path::PathBuf;

    use domicile_host::system::Kept;
    use domicile_protocol::SystemError;

    use super::*;

    #[test]
    fn a_screenshot_is_saved_where_the_compositor_says() {
        let home = tempfile::tempdir().unwrap();
        let (told, asked) = channel();
        let (system, heard) = system_in(home.path());
        let system = system.screenshotting_with(move |file| {
            told.send(file).unwrap();
            Ok(Kept::Saved(PathBuf::from("/pictures/a.png")))
        });

        system.handle(
            1,
            SystemRequest::Screenshot {
                file: Some("shot.png".into()),
            },
        );

        assert_eq!(
            reply(&heard, 1),
            SystemReply::Saved {
                path: "/pictures/a.png".into()
            }
        );
        assert_eq!(asked.recv().unwrap(), Some(home.path().join("shot.png")));
    }

    #[test]
    fn a_screenshot_copied_from_the_dialog_says_so() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());
        let system = system.screenshotting_with(|_| Ok(Kept::Copied));

        system.handle(1, SystemRequest::Screenshot { file: None });

        assert_eq!(reply(&heard, 1), SystemReply::Copied);
    }

    #[test]
    fn a_screenshot_the_compositor_did_not_take_says_why() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());
        let system = system.screenshotting_with(|_| {
            Err(SystemError {
                kind: SystemErrorKind::Canceled,
                message: "dismissed".into(),
            })
        });

        system.handle(1, SystemRequest::Screenshot { file: None });

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::Canceled);
    }

    #[test]
    fn a_system_that_takes_no_screenshots_says_so() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(1, SystemRequest::Screenshot { file: None });

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::Other);
    }
}

/// Screen recordings, run by whatever the compositor hands the system.
mod screen_recordings {
    use std::path::PathBuf;

    use domicile_protocol::SystemError;

    use super::*;

    #[test]
    fn a_recording_is_answered_with_its_file_once_it_stops() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());
        let system =
            system.recording_with(|| Ok(PathBuf::from("/videos/Screen recordings/a.webm")));

        system.handle(1, SystemRequest::ScreenRecord);

        assert_eq!(
            reply(&heard, 1),
            SystemReply::Saved {
                path: "/videos/Screen recordings/a.webm".into()
            }
        );
    }

    #[test]
    fn a_recording_the_user_called_off_says_so() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());
        let system = system.recording_with(|| {
            Err(SystemError {
                kind: SystemErrorKind::Canceled,
                message: "discarded".into(),
            })
        });

        system.handle(1, SystemRequest::ScreenRecord);

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::Canceled);
    }

    #[test]
    fn a_system_that_records_nothing_says_so() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(1, SystemRequest::ScreenRecord);

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::Other);
    }
}

/// Window previews, drawn by whatever the compositor hands the system.
mod previews {
    use domicile_protocol::SystemError;

    use super::*;

    #[test]
    fn a_preview_is_the_frame_the_compositor_draws() {
        let home = tempfile::tempdir().unwrap();
        let (told, asked) = channel();
        let (system, heard) = system_in(home.path());
        let system = system.previewing_with(move |window| {
            told.send(window).unwrap();
            Ok("data:image/png;base64,AA==".into())
        });

        system.handle(
            1,
            SystemRequest::PreviewWindow {
                window: PreviewedWindow::Browser { id: "7".into() },
            },
        );

        assert_eq!(
            reply(&heard, 1),
            SystemReply::Preview {
                frame: "data:image/png;base64,AA==".into()
            }
        );
        assert_eq!(
            asked.recv().unwrap(),
            PreviewedWindow::Browser { id: "7".into() }
        );
    }

    #[test]
    fn a_preview_the_compositor_did_not_draw_says_why() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());
        let system = system.previewing_with(|_| {
            Err(SystemError {
                kind: SystemErrorKind::NotFound,
                message: "no window app-1".into(),
            })
        });

        system.handle(
            1,
            SystemRequest::PreviewWindow {
                window: PreviewedWindow::App { id: "app-1".into() },
            },
        );

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::NotFound);
    }

    #[test]
    fn a_system_that_draws_no_previews_says_so() {
        let home = tempfile::tempdir().unwrap();
        let (system, heard) = system_in(home.path());

        system.handle(
            1,
            SystemRequest::PreviewWindow {
                window: PreviewedWindow::App { id: "app-1".into() },
            },
        );

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::Other);
    }
}

/// `domicile send-shell` commands, sent on one connection and heard on every
/// connection listening.
mod shell_commands {
    use domicile_host::shell_commands::ShellCommands;

    use super::*;

    fn focus_right() -> Vec<String> {
        vec!["focus".into(), "right".into()]
    }

    /// Two systems sharing `commands`, as two chrome connections do.
    fn two_pages(
        commands: &ShellCommands,
    ) -> (
        (System, Receiver<HostMessage>),
        (System, Receiver<HostMessage>),
    ) {
        let home = std::env::temp_dir();
        let (first, first_heard) = system_in(&home);
        let (second, second_heard) = system_in(&home);
        (
            (first.sharing_shell_commands(commands.clone()), first_heard),
            (
                second.sharing_shell_commands(commands.clone()),
                second_heard,
            ),
        )
    }

    #[test]
    fn a_command_sent_on_one_connection_is_heard_on_every_page_listening() {
        let commands = ShellCommands::default();
        let ((page, page_heard), (sender, sender_heard)) = two_pages(&commands);
        page.handle(7, SystemRequest::ShellCommands);
        assert_eq!(reply(&page_heard, 7), SystemReply::Started);

        sender.handle(
            1,
            SystemRequest::SendShell {
                command: focus_right(),
            },
        );

        assert_eq!(reply(&sender_heard, 1), SystemReply::Sent);
        assert_eq!(
            next(&page_heard),
            HostMessage::SystemEvent {
                id: 7,
                event: SystemEvent::ShellCommand {
                    command: focus_right()
                },
            }
        );
    }

    #[test]
    fn a_command_nobody_listens_for_says_so() {
        let commands = ShellCommands::default();
        let (_, (sender, sender_heard)) = two_pages(&commands);

        sender.handle(
            1,
            SystemRequest::SendShell {
                command: focus_right(),
            },
        );

        assert_eq!(failure(reply(&sender_heard, 1)), SystemErrorKind::Other);
    }

    #[test]
    fn a_page_that_stopped_listening_hears_no_more() {
        let commands = ShellCommands::default();
        let ((page, page_heard), (sender, sender_heard)) = two_pages(&commands);
        page.handle(7, SystemRequest::ShellCommands);
        reply(&page_heard, 7);

        page.handle(7, SystemRequest::Unwatch);
        sender.handle(
            1,
            SystemRequest::SendShell {
                command: focus_right(),
            },
        );

        assert_eq!(
            next(&page_heard),
            HostMessage::SystemEnd {
                id: 7,
                end: SystemEnd::Stopped,
            }
        );
        assert_eq!(failure(reply(&sender_heard, 1)), SystemErrorKind::Other);
    }

    #[test]
    fn a_page_that_went_away_hears_no_more() {
        let commands = ShellCommands::default();
        let ((page, page_heard), (sender, sender_heard)) = two_pages(&commands);
        page.handle(7, SystemRequest::ShellCommands);
        reply(&page_heard, 7);

        drop(page);
        sender.handle(
            1,
            SystemRequest::SendShell {
                command: focus_right(),
            },
        );

        assert_eq!(failure(reply(&sender_heard, 1)), SystemErrorKind::Other);
    }

    /// A reloaded page listens again while the desktop is locked, so commands
    /// still reach it once it unlocks.
    #[test]
    fn listening_is_its_own_reach_and_sending_acts() {
        assert_eq!(reach(&SystemRequest::ShellCommands), Reach::Listens);
        assert_eq!(
            reach(&SystemRequest::SendShell {
                command: focus_right()
            }),
            Reach::Acts
        );
    }
}

/// Warnings that the screens are about to blank, set by the compositor and
/// heard on every connection listening.
mod idle_warnings {
    use domicile_host::idle_warnings::IdleWarnings;

    use super::*;

    const WARNING: Duration = Duration::from_secs(30);

    /// A system sharing `warnings`, as a chrome connection does.
    fn page(warnings: &IdleWarnings) -> (System, Receiver<HostMessage>) {
        let (system, heard) = system_in(&std::env::temp_dir());
        (system.sharing_idle_warnings(warnings.clone()), heard)
    }

    /// How long the warning `heard` says is left, or `None` for no warning.
    fn left(heard: &Receiver<HostMessage>, id: u32) -> Option<Duration> {
        match next(heard) {
            HostMessage::SystemEvent {
                id: from,
                event: SystemEvent::IdleWarning { blanks_in_ms },
            } if from == id => blanks_in_ms.map(Duration::from_millis),
            other => panic!("expected an idle warning for {id}, heard {other:?}"),
        }
    }

    #[test]
    fn a_page_listening_hears_the_warning_and_when_it_is_called_off() {
        let warnings = IdleWarnings::default();
        let (page, heard) = page(&warnings);
        page.handle(7, SystemRequest::IdleWarnings);
        assert_eq!(reply(&heard, 7), SystemReply::Started);

        warnings.warn(Some(Instant::now() + WARNING));
        let warned = left(&heard, 7).expect("a warning");
        assert!(
            warned <= WARNING && warned > WARNING - PATIENCE,
            "{warned:?}"
        );

        warnings.warn(None);
        assert_eq!(left(&heard, 7), None);
    }

    #[test]
    fn a_page_that_listens_during_a_warning_hears_it_at_once() {
        // A page reloaded during a warning missed its start.
        let warnings = IdleWarnings::default();
        warnings.warn(Some(Instant::now() + WARNING));
        let (page, heard) = page(&warnings);

        page.handle(7, SystemRequest::IdleWarnings);

        assert_eq!(reply(&heard, 7), SystemReply::Started);
        assert!(left(&heard, 7).is_some());
    }

    #[test]
    fn a_warning_that_did_not_change_is_not_told_again() {
        let warnings = IdleWarnings::default();
        let (page, heard) = page(&warnings);
        page.handle(7, SystemRequest::IdleWarnings);
        reply(&heard, 7);

        warnings.warn(None);
        page.handle(7, SystemRequest::Unwatch);

        assert_eq!(
            next(&heard),
            HostMessage::SystemEnd {
                id: 7,
                end: SystemEnd::Stopped,
            },
            "no warning was running, so calling it off says nothing"
        );
    }

    #[test]
    fn a_page_that_stopped_listening_hears_no_more() {
        let warnings = IdleWarnings::default();
        let (page, heard) = page(&warnings);
        page.handle(7, SystemRequest::IdleWarnings);
        reply(&heard, 7);

        page.handle(7, SystemRequest::Unwatch);
        warnings.warn(Some(Instant::now() + WARNING));

        assert_eq!(
            next(&heard),
            HostMessage::SystemEnd {
                id: 7,
                end: SystemEnd::Stopped,
            }
        );
        assert!(heard.try_recv().is_err());
    }

    /// A lock screen may dim too.
    #[test]
    fn listening_is_its_own_reach() {
        assert_eq!(reach(&SystemRequest::IdleWarnings), Reach::Listens);
    }
}

/// Passphrases the lock did not take, sent by the compositor and heard on
/// every connection listening.
mod unlock_refusals {
    use std::time::Duration;

    use domicile_host::unlock_refusals::{Refused, UnlockRefusals};
    use domicile_protocol::UnlockRefusal;

    use super::*;

    #[test]
    fn a_refusal_is_heard_on_every_page_listening() {
        let refusals = UnlockRefusals::default();
        let home = std::env::temp_dir();
        let pages: Vec<_> = (0..2)
            .map(|_| {
                let (page, heard) = system_in(&home);
                let page = page.sharing_unlock_refusals(refusals.clone());
                page.handle(4, SystemRequest::UnlockRefusals);
                assert_eq!(reply(&heard, 4), SystemReply::Started);
                (page, heard)
            })
            .collect();

        refusals.send(&Refused {
            refusal: UnlockRefusal::WrongPassphrase,
            failures: 3,
            retry_in: Duration::from_secs(5),
        });

        for (_, heard) in &pages {
            assert_eq!(
                next(heard),
                HostMessage::SystemEvent {
                    id: 4,
                    event: SystemEvent::UnlockRefused {
                        refusal: UnlockRefusal::WrongPassphrase,
                        failures: 3,
                        retry_in_ms: 5000,
                    },
                }
            );
        }
    }

    /// A lock screen listens while the desktop is locked; that is when it
    /// hears anything.
    #[test]
    fn listening_is_its_own_reach() {
        assert_eq!(reach(&SystemRequest::UnlockRefusals), Reach::Listens);
    }
}

/// Window states the shell sets, and the maximize and fullscreen requests it
/// hears from clients.
mod window_states {
    use domicile_host::window_requests::WindowRequests;
    use domicile_protocol::{SystemError, WindowRequest, WindowState};

    use super::*;

    fn tile_left_and_right() -> SystemRequest {
        SystemRequest::SetWindowStates {
            app_id: "app-1".into(),
            states: vec![WindowState::TiledLeft, WindowState::TiledRight],
        }
    }

    #[test]
    fn setting_states_hands_them_to_the_compositor() {
        let (told, asked) = channel();
        let (system, heard) = system_in(&std::env::temp_dir());
        let system = system.setting_window_states_with(move |app_id, states| {
            told.send((app_id, states)).unwrap();
            Ok(())
        });

        system.handle(1, tile_left_and_right());

        assert_eq!(reply(&heard, 1), SystemReply::Set);
        assert_eq!(
            asked.recv().unwrap(),
            (
                "app-1".to_string(),
                vec![WindowState::TiledLeft, WindowState::TiledRight]
            )
        );
    }

    #[test]
    fn states_the_compositor_refused_say_why() {
        let (system, heard) = system_in(&std::env::temp_dir());
        let system = system.setting_window_states_with(|_, _| {
            Err(SystemError {
                kind: SystemErrorKind::NotFound,
                message: "no window app-1".into(),
            })
        });

        system.handle(1, tile_left_and_right());

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::NotFound);
    }

    #[test]
    fn a_system_that_sets_no_states_says_so() {
        let (system, heard) = system_in(&std::env::temp_dir());

        system.handle(1, tile_left_and_right());

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::Other);
    }

    #[test]
    fn a_page_listening_hears_each_request_until_it_stops() {
        let requests = WindowRequests::default();
        let (system, heard) = system_in(&std::env::temp_dir());
        let page = system.sharing_window_requests(requests.clone());
        page.handle(7, SystemRequest::WindowRequests);
        assert_eq!(reply(&heard, 7), SystemReply::Started);

        requests.send(&("app-1".into(), WindowRequest::Maximize));
        assert_eq!(
            next(&heard),
            HostMessage::SystemEvent {
                id: 7,
                event: SystemEvent::WindowRequest {
                    app_id: "app-1".into(),
                    request: WindowRequest::Maximize,
                },
            }
        );

        page.handle(7, SystemRequest::Unwatch);
        requests.send(&("app-1".into(), WindowRequest::Unmaximize));
        assert_eq!(
            next(&heard),
            HostMessage::SystemEnd {
                id: 7,
                end: SystemEnd::Stopped,
            }
        );
        assert!(heard.recv_timeout(Duration::from_millis(100)).is_err());
    }

    /// Both arrange windows or listen, as `setAppBounds` does, so a lock
    /// screen's layout stays right.
    #[test]
    fn setting_states_arranges_and_hearing_requests_listens() {
        assert_eq!(reach(&tile_left_and_right()), Reach::Arranges);
        assert_eq!(reach(&SystemRequest::WindowRequests), Reach::Listens);
    }
}

/// The keymaps, which the compositor lists and switches between.
mod keymaps {
    use domicile_host::keymaps::{Keymaps, Listed};
    use domicile_protocol::{KeymapChoice, ListedKeymap, SystemError};

    use super::*;

    fn listed(names: &[&str], active: &str) -> Listed {
        Listed {
            keymaps: names
                .iter()
                .map(|name| ListedKeymap {
                    name: name.to_string(),
                    description: None,
                })
                .collect(),
            active: active.into(),
        }
    }

    fn heard_keymaps(heard: &Receiver<HostMessage>, id: u32) -> Listed {
        match next(heard) {
            HostMessage::SystemEvent {
                id: from,
                event: SystemEvent::Keymaps { keymaps, active },
            } if from == id => Listed { keymaps, active },
            other => panic!("expected keymaps for {id}, heard {other:?}"),
        }
    }

    #[test]
    fn a_page_listening_hears_the_keymaps_at_once_and_each_change() {
        let keymaps = Keymaps::default();
        keymaps.list(listed(&["dvp", "us"], "dvp"));
        let (system, heard) = system_in(&std::env::temp_dir());
        let page = system.sharing_keymaps(keymaps.clone());

        page.handle(7, SystemRequest::Keymaps);
        assert_eq!(reply(&heard, 7), SystemReply::Started);
        assert_eq!(heard_keymaps(&heard, 7), listed(&["dvp", "us"], "dvp"));

        keymaps.list(listed(&["dvp", "us"], "us"));
        assert_eq!(heard_keymaps(&heard, 7), listed(&["dvp", "us"], "us"));

        keymaps.list(listed(&["dvp", "us"], "us"));
        page.handle(7, SystemRequest::Unwatch);
        assert_eq!(
            next(&heard),
            HostMessage::SystemEnd {
                id: 7,
                end: SystemEnd::Stopped,
            },
            "an unchanged list is not told again"
        );
        keymaps.list(listed(&["dvp", "us"], "dvp"));
        assert!(heard.recv_timeout(Duration::from_millis(100)).is_err());
    }

    #[test]
    fn selecting_a_keymap_hands_the_choice_to_the_compositor() {
        let (told, asked) = channel();
        let (system, heard) = system_in(&std::env::temp_dir());
        let system = system.selecting_keymaps_with(move |choice| {
            told.send(choice).unwrap();
            Ok(())
        });

        system.handle(
            1,
            SystemRequest::SelectKeymap {
                keymap: KeymapChoice::Next,
            },
        );

        assert_eq!(reply(&heard, 1), SystemReply::Set);
        assert_eq!(asked.recv().unwrap(), KeymapChoice::Next);
    }

    #[test]
    fn a_keymap_the_compositor_refused_says_why() {
        let (system, heard) = system_in(&std::env::temp_dir());
        let system = system.selecting_keymaps_with(|_| {
            Err(SystemError {
                kind: SystemErrorKind::NotFound,
                message: "no keymap de".into(),
            })
        });

        system.handle(
            1,
            SystemRequest::SelectKeymap {
                keymap: KeymapChoice::Named { name: "de".into() },
            },
        );

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::NotFound);
    }

    #[test]
    fn a_system_that_selects_no_keymaps_says_so() {
        let (system, heard) = system_in(&std::env::temp_dir());

        system.handle(
            1,
            SystemRequest::SelectKeymap {
                keymap: KeymapChoice::Next,
            },
        );

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::Other);
    }
}

/// The color temperature the shell sets every monitor to, as a night light
/// does.
mod color_temperature {
    use domicile_host::white_point::{white_point, WhitePoint};

    use super::*;

    #[test]
    fn setting_a_temperature_hands_its_white_point_to_the_compositor() {
        let (told, asked) = channel();
        let (system, heard) = system_in(&std::env::temp_dir());
        let system = system.setting_white_points_with(move |point| {
            told.send(point).unwrap();
            Ok(())
        });

        system.handle(1, SystemRequest::SetColorTemperature { kelvin: 3400 });

        assert_eq!(reply(&heard, 1), SystemReply::Set);
        assert_eq!(asked.recv().unwrap(), white_point(3400));
    }

    #[test]
    fn a_temperature_out_of_range_is_refused() {
        let (told, asked) = channel::<WhitePoint>();
        let (system, heard) = system_in(&std::env::temp_dir());
        let system = system.setting_white_points_with(move |point| {
            told.send(point).unwrap();
            Ok(())
        });

        system.handle(1, SystemRequest::SetColorTemperature { kelvin: 999 });
        system.handle(2, SystemRequest::SetColorTemperature { kelvin: 6501 });

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::InvalidInput);
        assert_eq!(failure(reply(&heard, 2)), SystemErrorKind::InvalidInput);
        assert!(asked.try_recv().is_err());
    }

    #[test]
    fn a_system_that_sets_no_white_point_says_so() {
        let (system, heard) = system_in(&std::env::temp_dir());

        system.handle(1, SystemRequest::SetColorTemperature { kelvin: 3400 });

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::Other);
    }

    /// A lock screen shows the keymap and switches it, so the passphrase is
    /// typed on the right one.
    #[test]
    fn listing_listens_and_selecting_retypes() {
        assert_eq!(reach(&SystemRequest::Keymaps), Reach::Listens);
        assert_eq!(
            reach(&SystemRequest::SelectKeymap {
                keymap: domicile_protocol::KeymapChoice::Next
            }),
            Reach::Retypes
        );
    }

    /// A night light turns on at sunset whether or not the desktop is locked.
    #[test]
    fn setting_a_temperature_tints() {
        assert_eq!(
            reach(&SystemRequest::SetColorTemperature { kelvin: 3400 }),
            Reach::Tints
        );
    }

    #[test]
    fn an_app_may_not_set_a_temperature() {
        let Some(HostMessage::SystemReply {
            id: 4,
            reply: SystemReply::Failed { error },
        }) = refused_to_an_app(4, &SystemRequest::SetColorTemperature { kelvin: 3400 })
        else {
            panic!("expected a failure");
        };
        assert_eq!(error.kind, SystemErrorKind::PermissionDenied);
    }
}

/// What a refused request gets while the desktop is locked.
mod locked {
    use super::*;

    #[test]
    fn a_call_that_would_start_something_is_told_it_is_locked() {
        for starts in [
            spawn(&["true"]),
            SystemRequest::Screenshot { file: None },
            SystemRequest::ScreenRecord,
            SystemRequest::PreviewWindow {
                window: PreviewedWindow::App { id: "app-1".into() },
            },
            SystemRequest::SendShell {
                command: vec!["focus".into(), "right".into()],
            },
        ] {
            let Some(HostMessage::SystemReply {
                id: 4,
                reply: SystemReply::Failed { error },
            }) = locked_out(4, &starts)
            else {
                panic!("expected a failure for 4");
            };
            assert_eq!(error.kind, SystemErrorKind::Locked);
        }
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

/// What an app connection may call. See `docs/architecture/APP-MODULES.md`.
mod apps {
    use super::*;

    #[test]
    fn an_app_may_use_files_processes_and_d_bus() {
        for allowed in [
            SystemRequest::ReadFile {
                path: "notes.txt".into(),
                offset: 0,
                length: None,
            },
            SystemRequest::Watch {
                path: "notes.txt".into(),
            },
            spawn(&["true"]),
            SystemRequest::Stdin { data: "".into() },
            SystemRequest::Kill {
                signal: Signal::Term,
            },
        ] {
            assert_eq!(refused_to_an_app(4, &allowed), None, "{allowed:?}");
        }
    }

    /// These belong to the window manager, which a Wayland client cannot
    /// reach either.
    #[test]
    fn an_app_may_not_reach_the_desktop() {
        for refused in [
            SystemRequest::Screenshot { file: None },
            SystemRequest::ScreenRecord,
            SystemRequest::PreviewWindow {
                window: PreviewedWindow::App { id: "app-1".into() },
            },
            SystemRequest::ShellCommands,
            SystemRequest::SendShell {
                command: vec!["focus".into(), "right".into()],
            },
            SystemRequest::IdleWarnings,
            SystemRequest::UnlockRefusals,
            SystemRequest::WindowRequests,
            SystemRequest::SetWindowStates {
                app_id: "app-1".into(),
                states: Vec::new(),
            },
            SystemRequest::Keymaps,
            SystemRequest::SelectKeymap {
                keymap: domicile_protocol::KeymapChoice::Next,
            },
        ] {
            let Some(HostMessage::SystemReply {
                id: 4,
                reply: SystemReply::Failed { error },
            }) = refused_to_an_app(4, &refused)
            else {
                panic!("expected a failure for {refused:?}");
            };
            assert_eq!(error.kind, SystemErrorKind::PermissionDenied);
        }
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
        let system = System::new(home.to_path_buf(), Vec::new(), ours(), move |message| {
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

/// Virtual monitors a page adds to cast the desk to a TV.
mod virtual_monitors {
    use std::sync::mpsc::Sender;

    use domicile_host::system::{AddedMonitor, VirtualMonitor};
    use domicile_protocol::SystemEnd;

    use super::*;

    fn a_tv() -> SystemRequest {
        SystemRequest::VirtualMonitor {
            name: "Living Room TV".into(),
            width: 1920,
            height: 1080,
            refresh_mhz: 60_000,
        }
    }

    /// Says on `gone` when it drops, as the compositor removes the monitor.
    struct Lease(Sender<()>);

    impl Drop for Lease {
        fn drop(&mut self) {
            self.0.send(()).unwrap();
        }
    }

    /// A system that adds each monitor as `virtual-1`, and the monitors it
    /// was asked for and removed.
    fn adding(system: System) -> (System, Receiver<VirtualMonitor>, Receiver<()>) {
        let (asked_for, asked) = channel();
        let (removed, gone) = channel();
        let system = system.adding_virtual_monitors_with(move |wanted| {
            asked_for.send(wanted).unwrap();
            Ok(AddedMonitor {
                output: "virtual-1".into(),
                lease: Box::new(Lease(removed.clone())),
            })
        });
        (system, asked, gone)
    }

    #[test]
    fn a_page_adds_a_monitor_until_it_stops() {
        let (system, heard) = system_in(&std::env::temp_dir());
        let (system, asked, gone) = adding(system);

        system.handle(1, a_tv());

        assert_eq!(
            reply(&heard, 1),
            SystemReply::VirtualMonitor {
                output: "virtual-1".into()
            }
        );
        assert_eq!(
            asked.recv().unwrap(),
            VirtualMonitor {
                name: "Living Room TV".into(),
                size: (1920, 1080),
                refresh_mhz: 60_000,
            }
        );
        assert!(gone.try_recv().is_err(), "the monitor stays while it runs");

        system.handle(1, SystemRequest::Unwatch);

        assert_eq!(
            next(&heard),
            HostMessage::SystemEnd {
                id: 1,
                end: SystemEnd::Stopped,
            }
        );
        gone.recv().unwrap();
    }

    #[test]
    fn a_page_that_goes_away_takes_its_monitor_with_it() {
        let (system, heard) = system_in(&std::env::temp_dir());
        let (system, _asked, gone) = adding(system);
        system.handle(1, a_tv());
        reply(&heard, 1);

        drop(system);

        gone.recv().unwrap();
    }

    #[test]
    fn a_name_with_a_nul_is_refused() {
        // The engine takes the name as a C string.
        let (system, heard) = system_in(&std::env::temp_dir());
        let (system, asked, _gone) = adding(system);

        system.handle(
            1,
            SystemRequest::VirtualMonitor {
                name: "TV\0".into(),
                width: 1920,
                height: 1080,
                refresh_mhz: 60_000,
            },
        );

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::InvalidInput);
        assert!(asked.try_recv().is_err());
    }

    #[test]
    fn a_system_that_adds_no_monitors_says_so() {
        let (system, heard) = system_in(&std::env::temp_dir());

        system.handle(1, a_tv());

        assert_eq!(failure(reply(&heard, 1)), SystemErrorKind::Other);
    }
}
