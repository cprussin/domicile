//! Reads the sound server for the shell's mixer and runs the mixer's requests.
//!
//! Runs `pactl` as a subprocess instead of linking libpulse, so the binary
//! links nothing extra; `pactl` works with PulseAudio and `pipewire-pulse`.
//! `DOMICILE_PACTL` overrides the binary. Parsing and request building live in
//! `domicile_host::audio`.
//!
//! One thread holds `pactl subscribe` open and rereads the server after each
//! burst of changes settles, reopening the subscription if it ends. Another
//! runs requests, dropping volume changes a later one supersedes. Without a
//! sound server the mixer is empty and the log says why once.

use std::ffi::OsString;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;
use std::time::Duration;

use domicile_host::audio::{announces_a_change, coalesce, reading, Audio, Request};
use tracing::{debug, warn};

/// How long the server must be quiet before it is reread.
const SETTLE: Duration = Duration::from_millis(30);

/// Delay before reopening a subscription that ended.
const REOPEN: Duration = Duration::from_secs(5);

/// Handle for sending mixer requests. Dropping the last one ends the request
/// thread.
#[derive(Debug, Clone)]
pub struct AudioServer {
    told: Sender<Request>,
}

impl AudioServer {
    pub fn ask(&self, request: Request) {
        // The runner stops only when the compositor exits.
        let _ = self.told.send(request);
    }
}

/// Starts the reader and request threads. `publish` receives each new reading.
pub fn serve(publish: impl Fn(Audio) + Send + 'static) -> AudioServer {
    let pactl = std::env::var_os("DOMICILE_PACTL").unwrap_or_else(|| "pactl".into());
    let (told, requests) = channel();
    let asking = pactl.clone();
    thread::spawn(move || run(&asking, &requests));
    thread::spawn(move || listen(&pactl, &publish));
    AudioServer { told }
}

/// Runs requests, coalescing volume changes, until every handle is dropped.
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

/// Keeps a subscription open, reopening it when it ends.
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

/// Runs one subscription: reads the server, then rereads after each settled
/// burst of events, until `pactl` exits.
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
    // Read after subscribing so no change in between is missed.
    let first = read(pactl, publish);
    while settled(&doorbell) {
        if let Err(why) = read(pactl, publish) {
            debug!(%why, "the sound server could not be read");
        }
    }
    child.wait().map_err(|why| why.to_string())?;
    first
}

/// Waits for an event, then for quiet. Returns `false` once the subscription
/// ends.
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

/// Runs `pactl args` and returns its stdout, or its stderr as the error.
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

/// A `pactl` command in the C locale, because some JSON values are parsed as
/// English words.
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
