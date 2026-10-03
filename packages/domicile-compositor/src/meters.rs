//! The mixer's level meters: a `parec` per device or stream a chrome asked to
//! see, read for its loudest sample, and every chrome told twenty times a
//! second.
//!
//! **Only what is asked for, and only while it is.** Metering a microphone
//! records it, and a sound server shows that as a recording — so nothing is
//! metered until a chrome asks, by id, and a chrome's ask is a lease it has to
//! renew: see `domicile_host::audio::LevelWatches`. When the last lease lapses
//! every `parec` is stopped.
//!
//! **`parec`, for `pactl`'s reason**: `DOMICILE_PAREC` names it, and `parec` on
//! the `PATH` otherwise. pavucontrol meters the same way, through the server's
//! own peak detection; `parec` cannot ask for that, so it records a thousand
//! mono samples a second and the peak is taken here.
//!
//! **Nothing here can take the desktop down**: a `parec` that cannot start is
//! a meter that reads nothing, said once in the log.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use domicile_host::audio::{peak, LevelWatches, Meter};
use domicile_protocol::AudioLevel;
use tracing::warn;

/// How often the chromes are told the levels.
const TICK: Duration = Duration::from_millis(50);

/// A chrome asking for meters.
struct Watch {
    chrome: usize,
    ids: Vec<String>,
}

/// A handle on the meters. Dropping the last one ends their thread.
#[derive(Debug, Clone)]
pub struct Meters {
    told: Sender<Watch>,
    sources: Arc<Mutex<BTreeMap<String, Meter>>>,
}

impl Meters {
    /// `chrome` wants `ids` metered: a lease, renewed by asking again.
    pub fn watch(&self, chrome: usize, ids: Vec<String>) {
        // A closed channel is a thread that has stopped, which it does only
        // when the compositor has gone.
        let _ = self.told.send(Watch { chrome, ids });
    }

    /// What each id is metered off now, as the sound server was last read.
    pub fn take_up(&self, meters: BTreeMap<String, Meter>) {
        *self.sources.lock().unwrap() = meters;
    }
}

/// Start the meters, calling `publish` with the levels while anything is
/// metered.
pub fn serve(publish: impl Fn(Vec<AudioLevel>) + Send + 'static) -> Meters {
    let parec = std::env::var_os("DOMICILE_PAREC").unwrap_or_else(|| "parec".into());
    let (told, watches) = channel();
    let sources = Arc::new(Mutex::new(BTreeMap::new()));
    let reading = Arc::clone(&sources);
    thread::spawn(move || meter(&parec, &watches, &reading, &publish));
    Meters { told, sources }
}

/// One `parec`, and the loudest sample it has read since it was last asked —
/// `None` until it has read any.
struct Running {
    meter: Meter,
    child: Child,
    loudest: Arc<Mutex<Option<f64>>>,
}

impl Drop for Running {
    fn drop(&mut self) {
        // Already gone is gone; either way it is reaped.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn meter(
    parec: &OsString,
    watches: &Receiver<Watch>,
    sources: &Mutex<BTreeMap<String, Meter>>,
    publish: &impl Fn(Vec<AudioLevel>),
) {
    let mut leases = LevelWatches::default();
    let mut running: BTreeMap<String, Running> = BTreeMap::new();
    let mut said = false;
    loop {
        match watches.recv_timeout(TICK) {
            Ok(watch) => leases.watch(watch.chrome, watch.ids, Instant::now()),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        let wanted = wanted(&leases.watched(Instant::now()), &sources.lock().unwrap());
        let (stop, start) = changes(
            &running
                .iter()
                .map(|(id, meter)| (id.clone(), meter.meter.clone()))
                .collect(),
            &wanted,
        );
        for id in stop {
            running.remove(&id);
        }
        for (id, meter) in start {
            match record(parec, &meter) {
                Ok(started) => {
                    running.insert(id, started);
                }
                Err(why) if !said => {
                    said = true;
                    warn!(%why, "the mixer's meters cannot record; they will read nothing");
                }
                Err(_) => {}
            }
        }
        if !running.is_empty() {
            publish(levels(&running));
        }
    }
}

/// The ids to meter and what each is metered off: what was asked for, of
/// what can be metered.
fn wanted(
    watched: &std::collections::BTreeSet<String>,
    sources: &BTreeMap<String, Meter>,
) -> BTreeMap<String, Meter> {
    watched
        .iter()
        .filter_map(|id| Some((id.clone(), sources.get(id)?.clone())))
        .collect()
}

/// Which `parec`s to stop and which to start to go from `running` to
/// `wanted`. One whose source moved — a stream played on another device keeps
/// its id — is stopped and started again.
fn changes(
    running: &BTreeMap<String, Meter>,
    wanted: &BTreeMap<String, Meter>,
) -> (Vec<String>, Vec<(String, Meter)>) {
    let stop = running
        .iter()
        .filter(|(id, meter)| wanted.get(*id) != Some(meter))
        .map(|(id, _)| id.clone())
        .collect();
    let start = wanted
        .iter()
        .filter(|(id, meter)| running.get(*id) != Some(meter))
        .map(|(id, meter)| (id.clone(), meter.clone()))
        .collect();
    (stop, start)
}

/// Start a `parec` for `meter`, and a thread reading its samples.
fn record(parec: &OsString, meter: &Meter) -> std::io::Result<Running> {
    let mut child = Command::new(parec)
        .args(meter.argv())
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let mut stdout = child.stdout.take().expect("piped above");
    let loudest: Arc<Mutex<Option<f64>>> = Arc::new(Mutex::new(None));
    let heard = Arc::clone(&loudest);
    thread::spawn(move || {
        // Whole samples only: a read can end mid-float.
        let mut buffer = [0u8; 256];
        while let Ok(read @ 1..) = stdout.read(&mut buffer) {
            let samples = &buffer[..read - read % 4];
            let mut loudest = heard.lock().unwrap();
            *loudest = Some(loudest.unwrap_or(0.0).max(peak(samples)));
        }
    });
    Ok(Running {
        meter: meter.clone(),
        child,
        loudest,
    })
}

/// Each meter's loudest sample since the last tick, starting the next tick
/// from silence. A meter that has read nothing yet is left out.
fn levels(running: &BTreeMap<String, Running>) -> Vec<AudioLevel> {
    running
        .iter()
        .filter_map(|(id, running)| {
            let mut loudest = running.loudest.lock().unwrap();
            let peak = loudest.replace(0.0)?;
            Some(AudioLevel {
                id: id.clone(),
                peak,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(entries: &[(&str, Meter)]) -> BTreeMap<String, Meter> {
        entries
            .iter()
            .map(|(id, meter)| ((*id).to_string(), meter.clone()))
            .collect()
    }

    #[test]
    fn what_is_asked_for_and_can_be_metered_is_wanted() {
        let sources = map(&[("input:mic", Meter::Source("mic".into()))]);
        let watched = ["input:mic".to_string(), "output:hdmi".to_string()]
            .into_iter()
            .collect();

        assert_eq!(wanted(&watched, &sources), sources);
    }

    #[test]
    fn a_meter_no_longer_wanted_stops_and_a_new_one_starts() {
        let running = map(&[("input:mic", Meter::Source("mic".into()))]);
        let wanted = map(&[("output:a", Meter::Source("a.monitor".into()))]);

        assert_eq!(
            changes(&running, &wanted),
            (
                vec!["input:mic".to_string()],
                vec![("output:a".to_string(), Meter::Source("a.monitor".into()))]
            )
        );
    }

    #[test]
    fn a_meter_still_wanted_is_left_running() {
        let running = map(&[("input:mic", Meter::Source("mic".into()))]);

        assert_eq!(changes(&running, &running), (Vec::new(), Vec::new()));
    }

    #[test]
    fn a_meter_whose_source_moved_starts_again() {
        let running = map(&[("playback:4", Meter::Stream(4))]);
        let wanted = map(&[("playback:4", Meter::Stream(5))]);

        assert_eq!(
            changes(&running, &wanted),
            (
                vec!["playback:4".to_string()],
                vec![("playback:4".to_string(), Meter::Stream(5))]
            )
        );
    }
}
