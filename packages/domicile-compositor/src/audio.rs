//! The desk's sound: this compositor reads the sound server for the shell's
//! mixer and asks it what the mixer asks.
//!
//! **`pactl`, in a process.** What it says and how it is asked are
//! `domicile_host::audio`, which is pure and tested there; this is running it.
//! Linking libpulse would break the promise in this crate's `Cargo.toml`, and
//! `pactl` speaks to PulseAudio and to PipeWire's `pipewire-pulse` alike.
//! `DOMICILE_PACTL` names it — the flake's wrapper points it at a `pactl` of
//! its own — and `pactl` on the `PATH` otherwise.
//!
//! **Two threads.** One holds `pactl -f json subscribe` open and reads the
//! server again each time it says something a mixer draws moved, waiting for a
//! burst to settle first: a slider dragged is a volume event per step. A
//! subscription that ends — the server restarted — is opened again. The other
//! runs the mixer's requests in turn, dropping the volumes a drag overtook.
//!
//! **Nothing here can take the desktop down**, for [`crate::tray`]'s reason: a
//! desk with no sound server, or no `pactl`, has no mixer, and the log says why
//! once.

use std::ffi::OsString;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;
use std::time::Duration;

use domicile_host::audio::{announces_a_change, coalesce, reading, Audio, Request};
use tracing::{debug, warn};

/// How long the server has to be quiet before it is read again.
const SETTLE: Duration = Duration::from_millis(30);

/// How long to wait before opening a subscription that ended again.
const REOPEN: Duration = Duration::from_secs(5);

/// A handle on the mixer's requests. Dropping the last one ends the thread
/// that runs them.
#[derive(Debug, Clone)]
pub struct AudioServer {
    told: Sender<Request>,
}

impl AudioServer {
    pub fn ask(&self, request: Request) {
        // A closed channel is a runner that has stopped, which it does only
        // when the compositor has gone.
        let _ = self.told.send(request);
    }
}

/// Start reading the sound server, calling `publish` with what it says
/// whenever that moves, and running what the mixer asks of it.
pub fn serve(publish: impl Fn(Audio) + Send + 'static) -> AudioServer {
    let pactl = std::env::var_os("DOMICILE_PACTL").unwrap_or_else(|| "pactl".into());
    let (told, requests) = channel();
    let asking = pactl.clone();
    thread::spawn(move || run(&asking, &requests));
    thread::spawn(move || listen(&pactl, &publish));
    AudioServer { told }
}

/// Run each request, newest volumes only, until the compositor has gone.
fn run(pactl: &OsString, requests: &Receiver<Request>) {
    while let Ok(first) = requests.recv() {
        let waiting = std::iter::once(first).chain(requests.try_iter()).collect();
        for request in coalesce(waiting) {
            match request.argv() {
                Ok(argv) => {
                    if let Err(why) = pactl_output(pactl, &argv) {
                        warn!(%why, ?argv, "the sound server refused the mixer");
                    }
                }
                Err(why) => warn!(%why, "a chrome asked the mixer for something it cannot do"),
            }
        }
    }
}

/// Hold a subscription open for as long as the compositor runs.
fn listen(pactl: &OsString, publish: &impl Fn(Audio)) {
    let mut said = false;
    loop {
        match subscribe(pactl, publish) {
            Ok(()) => debug!("the sound server's subscription ended; opening it again"),
            Err(why) if !said => {
                said = true;
                warn!(%why, "no sound server to read; the mixer will be empty until there is");
            }
            Err(why) => debug!(%why, "still no sound server"),
        }
        thread::sleep(REOPEN);
    }
}

/// One subscription: read the server, then again after every settled burst of
/// news, until `pactl` exits.
fn subscribe(pactl: &OsString, publish: &impl Fn(Audio)) -> Result<(), String> {
    let mut child = pactl_command(pactl)
        .args(["-f", "json", "subscribe"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|why| format!("cannot run {pactl:?}: {why}"))?;
    let stdout = child.stdout.take().expect("piped above");
    let (rang, doorbell) = channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if announces_a_change(&line) && rang.send(()).is_err() {
                break;
            }
        }
    });
    // Read after subscribing, so that nothing that moves in between is missed.
    let first = read(pactl, publish);
    while settled(&doorbell) {
        if let Err(why) = read(pactl, publish) {
            debug!(%why, "the sound server could not be read");
        }
    }
    child.wait().map_err(|why| why.to_string())?;
    first
}

/// Wait for news and then for quiet. `false` once the subscription is gone.
fn settled(doorbell: &Receiver<()>) -> bool {
    let rang = doorbell.recv().is_ok();
    if rang {
        while doorbell.recv_timeout(SETTLE).is_ok() {}
    }
    rang
}

fn read(pactl: &OsString, publish: &impl Fn(Audio)) -> Result<(), String> {
    let info = pactl_output(pactl, &["-f", "json", "info"])?;
    let list = pactl_output(pactl, &["-f", "json", "list"])?;
    let audio = reading(&info, &list).map_err(|why| format!("unreadable pactl JSON: {why}"))?;
    publish(audio);
    Ok(())
}

/// What `pactl args` printed, or why it failed.
fn pactl_output(pactl: &OsString, args: &[impl AsRef<std::ffi::OsStr>]) -> Result<String, String> {
    let output = pactl_command(pactl)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|why| format!("cannot run {pactl:?}: {why}"))?;
    if output.status.success() {
        String::from_utf8(output.stdout).map_err(|why| why.to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// `pactl`, untranslated: some of what its JSON says is read as words.
fn pactl_command(pactl: &OsString) -> Command {
    let mut command = Command::new(pactl);
    command.env("LC_ALL", "C");
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_burst_of_news_is_read_once() {
        let (rang, doorbell) = channel();
        rang.send(()).unwrap();
        rang.send(()).unwrap();
        rang.send(()).unwrap();

        assert!(settled(&doorbell));
        assert!(doorbell.try_recv().is_err());
    }

    #[test]
    fn a_subscription_that_ended_is_not_news() {
        let (rang, doorbell) = channel::<()>();
        drop(rang);

        assert!(!settled(&doorbell));
    }
}
