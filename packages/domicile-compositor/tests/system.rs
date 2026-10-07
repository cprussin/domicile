//! A page's system calls, end to end through the chrome socket.
//!
//! `domicile_host::system`'s tests cover the calls themselves. These check what
//! the compositor adds: the page's home, the desktop's environment, the lock,
//! and that a page's processes end with its connection.

mod running;

use std::time::{Duration, Instant};

use domicile_protocol::{
    ChromeMessage, HostMessage, Stream, SystemErrorKind, SystemEvent, SystemReply, SystemRequest,
};

use crate::running::Compositor;

const A_DESK: &str = r#"{ "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] } }"#;

/// A desktop that can lock but has no idle timeout.
const A_DESK_THAT_CAN_LOCK: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "lock": { "passphrase": "open sesame" }
}
"#;

/// The same desktop, locking after a second idle.
const A_DESK_THAT_LOCKS_IN_A_SECOND: &str = r#"
{
  "output": { "displays": [{ "name": "left", "size": [1920, 1080] }] },
  "idle": { "blank_after_seconds": 1 },
  "lock": { "passphrase": "open sesame" }
}
"#;

fn call(chrome: &mut domicile_test_chrome::Chrome, id: u32, request: SystemRequest) {
    chrome
        .say(&ChromeMessage::SystemRequest { id, request })
        .expect("the chrome socket takes a system call");
}

fn reply(chrome: &mut domicile_test_chrome::Chrome, id: u32) -> SystemReply {
    let replied = chrome
        .wait_for(|message| matches!(message, HostMessage::SystemReply { id: of, .. } if *of == id))
        .expect("a system call is answered");
    let HostMessage::SystemReply { reply, .. } = replied else {
        unreachable!("the wait matched on this variant")
    };
    reply
}

/// The first line a process prints on stdout.
fn first_line(chrome: &mut domicile_test_chrome::Chrome, id: u32) -> String {
    let printed = chrome
        .wait_for(|message| {
            matches!(
                message,
                HostMessage::SystemEvent {
                    id: of,
                    event: SystemEvent::Output {
                        stream: Stream::Stdout,
                        ..
                    },
                } if *of == id
            )
        })
        .expect("the process prints");
    let HostMessage::SystemEvent {
        event: SystemEvent::Output { data, .. },
        ..
    } = printed
    else {
        unreachable!("the wait matched on this variant")
    };
    let text =
        String::from_utf8(domicile_host::base64::decoded(&data).expect("base64")).expect("utf-8");
    text.lines().next().expect("a line").to_string()
}

fn shell(script: &str) -> SystemRequest {
    SystemRequest::Spawn {
        argv: vec!["sh".into(), "-c".into(), script.into()],
        cwd: None,
        env: Default::default(),
        stdin: false,
    }
}

#[test]
fn a_page_reads_its_home() {
    let home = tempfile::tempdir().unwrap();
    std::fs::write(home.path().join("note"), "hi").unwrap();
    let compositor = Compositor::started_in_a_home(A_DESK, Some(home.path()));
    let mut chrome = compositor.chrome();

    call(
        &mut chrome,
        1,
        SystemRequest::ReadFile {
            path: "note".into(),
            offset: 0,
            length: None,
        },
    );

    assert_eq!(
        reply(&mut chrome, 1),
        SystemReply::Read {
            data: "aGk=".into()
        }
    );
}

/// A tool the shell runs, like `wl-paste`, reaches this desktop rather than
/// the session the compositor was started from.
#[test]
fn a_page_s_process_runs_in_this_desktop() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();

    call(&mut chrome, 1, shell("echo $WAYLAND_DISPLAY"));

    assert_eq!(reply(&mut chrome, 1), SystemReply::Started);
    assert_eq!(first_line(&mut chrome, 1), compositor.wayland_display());
}

#[test]
fn a_page_s_processes_end_with_its_connection() {
    let compositor = Compositor::started_with(A_DESK);
    let mut chrome = compositor.chrome();
    call(&mut chrome, 1, shell("echo $$; exec sleep 100"));
    assert_eq!(reply(&mut chrome, 1), SystemReply::Started);
    let process = std::path::Path::new("/proc").join(first_line(&mut chrome, 1));

    drop(chrome);

    let deadline = Instant::now() + Duration::from_secs(10);
    while process.exists() {
        assert!(
            Instant::now() < deadline,
            "{} outlived its page",
            process.display()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// A locked desktop runs nothing for the page, but its lock screen can still
/// read the kernel, for the battery.
#[test]
fn a_locked_desk_runs_nothing_but_reads_the_kernel() {
    let compositor = Compositor::started_with(A_DESK_THAT_CAN_LOCK);
    let mut chrome = compositor.chrome();
    chrome
        .wait_for(|message| matches!(message, HostMessage::Locked { locked: false }))
        .expect("a desk that can lock says it is open");
    compositor.reconfigure(A_DESK_THAT_LOCKS_IN_A_SECOND);
    chrome
        .wait_for(|message| matches!(message, HostMessage::Locked { locked: true }))
        .expect("a desk nobody is at locks itself");
    compositor.reconfigure(A_DESK_THAT_CAN_LOCK);

    call(&mut chrome, 1, shell("true"));
    let SystemReply::Failed { error } = reply(&mut chrome, 1) else {
        panic!("a process started while locked");
    };
    assert_eq!(error.kind, SystemErrorKind::Locked);

    call(
        &mut chrome,
        2,
        SystemRequest::Stat {
            path: "/sys".into(),
        },
    );
    assert!(matches!(reply(&mut chrome, 2), SystemReply::Stat { .. }));
}
