//! The mixer's level meters: one `parec` per device or stream a chrome
//! watches, sampled for its peak and sent to every chrome 20 times a second.
//!
//! Metering a microphone records it, and the sound server shows a recording.
//! So nothing is metered until a chrome asks by id, and each ask is a lease
//! the chrome must renew (see `domicile_host::audio::LevelWatches`). When the
//! last lease lapses, every `parec` stops.
//!
//! `DOMICILE_PAREC` names the `parec` binary, falling back to `PATH`. `parec`
//! cannot use the server's own peak detection, so it records 1000 mono
//! samples a second and the peak is taken here.
//!
//! A `parec` that cannot start leaves its meter silent and is logged once.

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
    /// Meter `ids` for `chrome`. The lease lapses unless renewed by calling
    /// again.
    pub fn watch(&self, chrome: usize, ids: Vec<String>) {
        // Fails only once the meter thread has exited with the compositor.
        let _ = self.told.send(Watch { chrome, ids });
    }

    /// Set the source each id is metered from, as last read from the sound
    /// server.
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

/// A running `parec` and its peak since last read, `None` until it has read
/// a sample.
struct Running {
    meter: Meter,
    child: Child,
    loudest: Arc<Mutex<Option<f64>>>,
}

impl Drop for Running {
    fn drop(&mut self) {
        // Kill and reap; a child that already exited is fine.
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

/// The ids to meter and their sources: those watched that can be metered.
fn wanted(
    watched: &std::collections::BTreeSet<String>,
    sources: &BTreeMap<String, Meter>,
) -> BTreeMap<String, Meter> {
    watched
        .iter()
        .filter_map(|id| Some((id.clone(), sources.get(id)?.clone())))
        .collect()
}

/// The `parec`s to stop and start to go from `running` to `wanted`. A meter
/// whose source changed is restarted: a stream moved to another device keeps
/// its id.
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

/// Each meter's peak since the last tick, resetting it for the next tick.
/// Meters that have read nothing yet are omitted.
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
