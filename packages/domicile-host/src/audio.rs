//! Parses `pactl -f json` output into mixer state and builds `pactl`
//! commands for mixer requests. The compositor's `audio` module runs them.
//!
//! - `pactl` avoids linking libpulse, and works with both PulseAudio and
//!   `pipewire-pulse`.
//! - Run `pactl` under `LC_ALL=C`: it translates some JSON values, such as a
//!   port's availability, that this module matches as words.
//! - Ids are opaque to a chrome. A device id is `output:` or `input:` plus the
//!   device name, which survives a server restart. A stream id is `playback:`
//!   or `recording:` plus the stream index, which lasts as long as the stream.
//!
//! See `packages/shell-manganese/docs/HOST-READOUTS.md`.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::time::{Duration, Instant};

use domicile_protocol::{AudioCard, AudioChoice, AudioDevice, AudioStream, HostMessage};
use serde::Deserialize;
use serde_json::Value;

/// The raw volume `pactl` reports for 100%.
const NORMAL: f64 = 65536.0;

/// Maximum volume a mixer may set: 150%, matching pavucontrol.
const CEILING: f64 = 1.5;

/// `pactl subscribe` facilities that change mixer state. Client events are
/// excluded: `pactl list` is itself a client, so re-reading on them would
/// loop forever.
const NEWS: &[&str] = &[
    "sink",
    "source",
    "sink-input",
    "source-output",
    "card",
    "server",
];

/// Application id of this compositor's level meters, so they are hidden like
/// other mixers' meters.
const METER: &str = "org.domicile.meter";

/// PipeWire property shared by a filter's device and its stream.
const LINK_GROUP: &str = "node.link-group";

/// Meter sample rate. High enough to catch transients, low enough to run one
/// per device cheaply.
const METER_RATE: u32 = 1000;

/// Applications whose streams are level meters and are hidden. Matches
/// pavucontrol's list.
const MIXERS: &[&str] = &[
    METER,
    "org.PulseAudio.pavucontrol",
    "org.gnome.VolumeControl",
    "org.kde.kmixd",
];

/// Mixer state sent to every chrome. See [`HostMessage::Audio`].
#[derive(Debug, Clone, PartialEq)]
pub struct Audio {
    pub outputs: Vec<AudioDevice>,
    pub inputs: Vec<AudioDevice>,
    pub playback: Vec<AudioStream>,
    pub recording: Vec<AudioStream>,
    pub cards: Vec<AudioCard>,
    /// Meter source for each meterable id. Not sent to chromes: they request
    /// meters by id and only the compositor records.
    pub meters: BTreeMap<String, Meter>,
}

/// Where a meter records from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Meter {
    /// A source by name: an input, or an output's monitor.
    Source(String),
    /// A playback stream by index, as pavucontrol meters one.
    Stream(u32),
}

impl Meter {
    /// `parec` arguments to record this meter as mono floats. The application
    /// id tag keeps the meter out of the recording list.
    pub fn argv(&self) -> Vec<String> {
        let what = match self {
            Meter::Source(name) => format!("--device={name}"),
            Meter::Stream(index) => format!("--monitor-stream={index}"),
        };
        vec![
            what,
            "--raw".into(),
            "--format=float32le".into(),
            "--channels=1".into(),
            format!("--rate={METER_RATE}"),
            "--latency-msec=30".into(),
            format!("--property=application.id={METER}"),
        ]
    }
}

/// Peak of little-endian `f32` `samples`, clipped to 1.0. Ignores a trailing
/// partial sample.
pub fn peak(samples: &[u8]) -> f64 {
    samples
        .as_chunks::<4>()
        .0
        .iter()
        .map(|bytes| f64::from(f32::from_le_bytes(*bytes).abs()))
        .fold(0.0, f64::max)
        .min(1.0)
}

/// Meter leases per chrome. See
/// [`domicile_protocol::ChromeMessage::WatchAudioLevels`].
#[derive(Debug, Default)]
pub struct LevelWatches {
    by_chrome: HashMap<usize, (Instant, BTreeSet<String>)>,
}

impl LevelWatches {
    /// How long a watch lasts without renewal. A mixer renews every second.
    pub const LEASE: Duration = Duration::from_secs(3);

    /// Replaces `chrome`'s watched ids with `ids`.
    pub fn watch(&mut self, chrome: usize, ids: Vec<String>, now: Instant) {
        if ids.is_empty() {
            self.by_chrome.remove(&chrome);
        } else {
            self.by_chrome
                .insert(chrome, (now, ids.into_iter().collect()));
        }
    }

    /// Drops expired leases and returns every id still watched at `now`.
    pub fn watched(&mut self, now: Instant) -> BTreeSet<String> {
        self.by_chrome
            .retain(|_, (since, _)| now.duration_since(*since) <= Self::LEASE);
        self.by_chrome
            .values()
            .flat_map(|(_, ids)| ids.iter().cloned())
            .collect()
    }
}

impl Audio {
    pub fn message(self) -> HostMessage {
        HostMessage::Audio {
            outputs: self.outputs,
            inputs: self.inputs,
            playback: self.playback,
            recording: self.recording,
            cards: self.cards,
        }
    }
}

/// An audio request with an invalid id or value.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum AudioError {
    #[error("a volume that is not a number")]
    NotANumber,
    #[error("{0} is not a device")]
    NotADevice(String),
    #[error("{stream} cannot move to {device}, which goes the other way")]
    Mismatched { stream: String, device: String },
    #[error("{0} is no id this desk gave out")]
    UnknownId(String),
}

/// An audio request from a chrome. Mirrors the audio variants of
/// [`domicile_protocol::ChromeMessage`].
#[derive(Debug, Clone, PartialEq)]
pub enum Request {
    Volume { id: String, volume: f64 },
    Muted { id: String, muted: bool },
    Default { id: String },
    Move { id: String, device: String },
    Port { id: String, port: String },
    Profile { card: String, profile: String },
}

impl Request {
    /// `pactl` arguments for this request. They start with `--` so a name
    /// cannot be read as an option.
    pub fn argv(&self) -> Result<Vec<String>, AudioError> {
        let words: Vec<String> = match self {
            Request::Volume { id, volume } => {
                let raw = raw_volume(*volume)?;
                let (target, key) = Target::parse(id)?;
                vec![
                    format!("set-{}-volume", target.noun()),
                    key.to_string(),
                    raw.to_string(),
                ]
            }
            Request::Muted { id, muted } => {
                let (target, key) = Target::parse(id)?;
                vec![
                    format!("set-{}-mute", target.noun()),
                    key.to_string(),
                    if *muted { "1" } else { "0" }.to_string(),
                ]
            }
            Request::Default { id } => {
                let (target, key) = device(id)?;
                vec![format!("set-default-{}", target.noun()), key.to_string()]
            }
            Request::Move { id, device: to } => {
                let (stream, index) = Target::parse(id)?;
                let (target, name) = device(to)?;
                let verb = match (stream, target) {
                    (Target::Playback, Target::Output) => "move-sink-input",
                    (Target::Recording, Target::Input) => "move-source-output",
                    _ => {
                        return Err(AudioError::Mismatched {
                            stream: id.clone(),
                            device: to.clone(),
                        })
                    }
                };
                vec![verb.to_string(), index.to_string(), name.to_string()]
            }
            Request::Port { id, port } => {
                let (target, key) = device(id)?;
                vec![
                    format!("set-{}-port", target.noun()),
                    key.to_string(),
                    port.clone(),
                ]
            }
            Request::Profile { card, profile } => {
                vec!["set-card-profile".into(), card.clone(), profile.clone()]
            }
        };
        Ok(std::iter::once("--".to_string()).chain(words).collect())
    }

    /// The id or card this request targets, for [`coalesce`].
    fn subject(&self) -> &str {
        match self {
            Request::Volume { id, .. }
            | Request::Muted { id, .. }
            | Request::Default { id }
            | Request::Move { id, .. }
            | Request::Port { id, .. } => id,
            Request::Profile { card, .. } => card,
        }
    }
}

/// Drops each volume request whose next request for the same target is also
/// a volume. A dragged slider sends many requests a second; only the last
/// matters.
pub fn coalesce(requests: Vec<Request>) -> Vec<Request> {
    let overtaken: Vec<bool> = requests
        .iter()
        .enumerate()
        .map(|(at, request)| {
            matches!(request, Request::Volume { .. })
                && matches!(
                    requests[at + 1..]
                        .iter()
                        .find(|later| later.subject() == request.subject()),
                    Some(Request::Volume { .. })
                )
        })
        .collect();
    requests
        .into_iter()
        .zip(overtaken)
        .filter_map(|(request, overtaken)| (!overtaken).then_some(request))
        .collect()
}

/// Whether a `pactl -f json subscribe` line means mixer state changed and the
/// server should be read again.
pub fn announces_a_change(line: &str) -> bool {
    serde_json::from_str::<Subscription>(line).is_ok_and(|event| NEWS.contains(&event.on.as_str()))
}

/// Parses `pactl -f json info` and `pactl -f json list` into [`Audio`].
pub fn reading(info: &str, list: &str) -> Result<Audio, serde_json::Error> {
    let info: Info = serde_json::from_str(info)?;
    let list: List = serde_json::from_str(list)?;
    let outputs_by_index: BTreeMap<u32, String> = list
        .sinks
        .iter()
        .map(|sink| (sink.index, Target::Output.id(&sink.name)))
        .collect();
    let inputs_by_index: BTreeMap<u32, String> = list
        .sources
        .iter()
        .map(|source| (source.index, Target::Input.id(&source.name)))
        .collect();
    let plumbing = plumbing(&list);
    Ok(Audio {
        outputs: list
            .sinks
            .iter()
            .map(|sink| sink.device(Target::Output, info.default_sink_name.as_deref()))
            .collect(),
        inputs: list
            .sources
            .iter()
            .map(|source| source.device(Target::Input, info.default_source_name.as_deref()))
            .collect(),
        playback: list
            .sink_inputs
            .iter()
            .filter(|stream| !stream.is_a_mixers() && !stream.is_plumbing(&plumbing))
            .map(|stream| stream.stream(Target::Playback, stream.sink, &outputs_by_index))
            .collect(),
        recording: list
            .source_outputs
            .iter()
            .filter(|stream| !stream.is_a_mixers() && !stream.is_plumbing(&plumbing))
            .map(|stream| stream.stream(Target::Recording, stream.source, &inputs_by_index))
            .collect(),
        cards: list.cards.iter().map(Card::card).collect(),
        meters: meters(&list),
    })
}

/// Link groups of filter devices, such as PipeWire filter-chains for speaker
/// correction or noise canceling.
///
/// A filter is a device plus a stream that carries its audio to the hardware.
/// The stream shares the device's link group and is hidden from the stream
/// lists.
fn plumbing(list: &List) -> BTreeSet<String> {
    list.sinks
        .iter()
        .chain(&list.sources)
        .filter_map(|device| device.properties.get(LINK_GROUP).cloned())
        .collect()
}

/// Meter source per id: an output's monitor source (if any), an input
/// itself, or a playback stream.
fn meters(list: &List) -> BTreeMap<String, Meter> {
    let outputs = list.sinks.iter().filter_map(|sink| {
        let monitor = sink.monitor_source.clone()?;
        Some((Target::Output.id(&sink.name), Meter::Source(monitor)))
    });
    let inputs = list.sources.iter().map(|source| {
        (
            Target::Input.id(&source.name),
            Meter::Source(source.name.clone()),
        )
    });
    let playback = list.sink_inputs.iter().map(|stream| {
        (
            Target::Playback.id(&stream.index.to_string()),
            Meter::Stream(stream.index),
        )
    });
    outputs.chain(inputs).chain(playback).collect()
}

/// The kinds of object an id can name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Target {
    Output,
    Input,
    Playback,
    Recording,
}

impl Target {
    const ALL: [Target; 4] = [
        Target::Output,
        Target::Input,
        Target::Playback,
        Target::Recording,
    ];

    fn prefix(self) -> &'static str {
        match self {
            Target::Output => "output",
            Target::Input => "input",
            Target::Playback => "playback",
            Target::Recording => "recording",
        }
    }

    /// The `pactl` name for this kind.
    fn noun(self) -> &'static str {
        match self {
            Target::Output => "sink",
            Target::Input => "source",
            Target::Playback => "sink-input",
            Target::Recording => "source-output",
        }
    }

    fn id(self, key: &str) -> String {
        format!("{}:{key}", self.prefix())
    }

    /// Splits an id into its kind and key. A stream key must be numeric, or
    /// `pactl` would look it up as a name.
    fn parse(id: &str) -> Result<(Target, &str), AudioError> {
        let unknown = || AudioError::UnknownId(id.to_string());
        let (prefix, key) = id.split_once(':').ok_or_else(unknown)?;
        let target = Target::ALL
            .into_iter()
            .find(|target| target.prefix() == prefix)
            .ok_or_else(unknown)?;
        let streamed = matches!(target, Target::Playback | Target::Recording);
        if key.is_empty() || (streamed && key.parse::<u32>().is_err()) {
            Err(unknown())
        } else {
            Ok((target, key))
        }
    }
}

/// Parses an id that must name a device.
fn device(id: &str) -> Result<(Target, &str), AudioError> {
    match Target::parse(id)? {
        found @ (Target::Output | Target::Input, _) => Ok(found),
        _ => Err(AudioError::NotADevice(id.to_string())),
    }
}

fn raw_volume(volume: f64) -> Result<u32, AudioError> {
    if volume.is_finite() {
        Ok((volume.clamp(0.0, CEILING) * NORMAL).round() as u32)
    } else {
        Err(AudioError::NotANumber)
    }
}

/// The loudest channel of a `pactl` volume as a fraction. An invalid volume,
/// reported as `{"error": ...}`, reads as 0.
fn loudest(volume: &BTreeMap<String, Value>) -> f64 {
    volume
        .values()
        .filter_map(|channel| channel.get("value")?.as_u64())
        .max()
        .map_or(0.0, |raw| raw as f64 / NORMAL)
}

#[derive(Deserialize)]
struct Subscription {
    on: String,
}

#[derive(Deserialize)]
struct Info {
    default_sink_name: Option<String>,
    default_source_name: Option<String>,
}

#[derive(Deserialize)]
struct List {
    #[serde(default)]
    sinks: Vec<Device>,
    #[serde(default)]
    sources: Vec<Device>,
    #[serde(default)]
    sink_inputs: Vec<Stream>,
    #[serde(default)]
    source_outputs: Vec<Stream>,
    #[serde(default)]
    cards: Vec<Card>,
}

#[derive(Deserialize)]
struct Device {
    index: u32,
    name: String,
    /// `null` when the server has none; the name is used instead.
    description: Option<String>,
    mute: bool,
    volume: BTreeMap<String, Value>,
    /// On a source, the sink it is the monitor of; on a sink, its monitor.
    #[serde(default)]
    monitor_source: Option<String>,
    #[serde(default)]
    ports: Vec<Port>,
    active_port: Option<String>,
    #[serde(default)]
    properties: BTreeMap<String, String>,
}

impl Device {
    /// Whether this source monitors a sink. Uses `device.class` when the
    /// server sets it, else whether `monitor_source` names a sink. Some
    /// `pactl` versions write "none" there as `""` or `"n/a"`, not `null`.
    fn is_a_monitor(&self) -> bool {
        let names_a_sink = self
            .monitor_source
            .as_deref()
            .is_some_and(|sink| !sink.is_empty() && sink != "n/a");
        match self.properties.get("device.class").map(String::as_str) {
            Some(class) => class == "monitor",
            None => names_a_sink,
        }
    }

    fn device(&self, target: Target, default: Option<&str>) -> AudioDevice {
        AudioDevice {
            id: target.id(&self.name),
            description: self.description.as_ref().unwrap_or(&self.name).clone(),
            volume: loudest(&self.volume),
            muted: self.mute,
            default: default == Some(self.name.as_str()),
            monitor: target == Target::Input && self.is_a_monitor(),
            ports: self
                .ports
                .iter()
                .map(|port| AudioChoice {
                    name: port.name.clone(),
                    description: port.description.clone(),
                    available: port.availability != "not available",
                })
                .collect(),
            port: self.active_port.clone(),
        }
    }
}

#[derive(Deserialize)]
struct Port {
    name: String,
    description: String,
    availability: String,
}

#[derive(Deserialize)]
struct Stream {
    index: u32,
    /// A sink input's device.
    #[serde(default)]
    sink: u32,
    /// A source output's device.
    #[serde(default)]
    source: u32,
    mute: bool,
    volume: BTreeMap<String, Value>,
    properties: BTreeMap<String, String>,
}

impl Stream {
    fn is_a_mixers(&self) -> bool {
        self.properties
            .get("application.id")
            .is_some_and(|id| MIXERS.contains(&id.as_str()))
    }

    /// Whether this is a filter's stream to the hardware. See [`plumbing`].
    fn is_plumbing(&self, plumbing: &BTreeSet<String>) -> bool {
        self.properties
            .get(LINK_GROUP)
            .is_some_and(|group| plumbing.contains(group))
    }

    /// Uses the application name with the media name as title. Without an
    /// application name, the media name becomes the name and there is no title.
    fn stream(&self, target: Target, on: u32, devices: &BTreeMap<u32, String>) -> AudioStream {
        let media = self.properties.get("media.name").cloned();
        let (application, title) = match self.properties.get("application.name") {
            Some(application) => (application.clone(), media),
            None => (media.unwrap_or_else(|| "Unknown".to_string()), None),
        };
        AudioStream {
            id: target.id(&self.index.to_string()),
            application,
            title,
            volume: loudest(&self.volume),
            muted: self.mute,
            device: devices.get(&on).cloned(),
        }
    }
}

#[derive(Deserialize)]
struct Card {
    name: String,
    properties: BTreeMap<String, String>,
    profiles: BTreeMap<String, Profile>,
    active_profile: Option<String>,
}

impl Card {
    fn card(&self) -> AudioCard {
        let mut profiles: Vec<(&String, &Profile)> = self.profiles.iter().collect();
        profiles.sort_by(|(a_name, a), (b_name, b)| {
            b.priority.cmp(&a.priority).then(a_name.cmp(b_name))
        });
        AudioCard {
            id: self.name.clone(),
            description: self
                .properties
                .get("device.description")
                .unwrap_or(&self.name)
                .clone(),
            profiles: profiles
                .into_iter()
                .map(|(name, profile)| AudioChoice {
                    name: name.clone(),
                    description: profile.description.clone(),
                    available: profile.available,
                })
                .collect(),
            profile: self.active_profile.clone(),
        }
    }
}

#[derive(Deserialize)]
struct Profile {
    description: String,
    #[serde(default)]
    priority: u32,
    available: bool,
}
