//! The desk's sound, read off the sound server and asked of it.
//!
//! **`pactl`, not libpulse.** The compositor links nothing it does not have to
//! (see its `Cargo.toml`), and `pactl -f json` already says everything a mixer
//! draws, in a shape PulseAudio and PipeWire's `pipewire-pulse` both answer.
//! So the sound server is read as two lines of JSON — `pactl -f json info` and
//! `pactl -f json list` — and asked with `pactl`'s own subcommands. This is
//! that reading and those subcommands, and nothing that runs a process: the
//! compositor's `audio` does that.
//!
//! **Run under `LC_ALL=C`.** `pactl` translates some of what its JSON says —
//! a port's availability, a subscription's facility — and these are read as
//! words.
//!
//! **The ids are this module's**, opaque to a chrome: `output:` or `input:`
//! and the device's name, which is stable across a restart of the server, or
//! `playback:` or `recording:` and the stream's index, which lasts as long as
//! the stream does.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::time::{Duration, Instant};

use domicile_protocol::{AudioCard, AudioChoice, AudioDevice, AudioStream, HostMessage};
use serde::Deserialize;
use serde_json::Value;

/// The server's 100%, which `pactl` reports volumes against.
const NORMAL: f64 = 65536.0;

/// The loudest a mixer may turn anything: pavucontrol's ceiling, 150%.
const CEILING: f64 = 1.5;

/// What `pactl subscribe` reports that a mixer draws. A client or a module
/// coming and going is not among them — and `pactl list` is itself a client,
/// so re-reading on that would be re-reading forever.
const NEWS: &[&str] = &[
    "sink",
    "source",
    "sink-input",
    "source-output",
    "card",
    "server",
];

/// What this desk's own meters call themselves, so that they are hidden with
/// every other mixer's.
const METER: &str = "org.domicile.meter";

/// The property PipeWire ties a filter's device and its stream together by.
const LINK_GROUP: &str = "node.link-group";

/// How many samples a second a meter records: enough to catch a transient a
/// meter would show, few enough that one per device is nothing.
const METER_RATE: u32 = 1000;

/// Applications whose streams are a mixer's own level meters, which every
/// mixer hides — pavucontrol's list.
const MIXERS: &[&str] = &[
    METER,
    "org.PulseAudio.pavucontrol",
    "org.gnome.VolumeControl",
    "org.kde.kmixd",
];

/// The desk's sound, as every chrome is told it. See [`HostMessage::Audio`].
#[derive(Debug, Clone, PartialEq)]
pub struct Audio {
    pub outputs: Vec<AudioDevice>,
    pub inputs: Vec<AudioDevice>,
    pub playback: Vec<AudioStream>,
    pub recording: Vec<AudioStream>,
    pub cards: Vec<AudioCard>,
    /// What each id is metered off, for those that can be — kept here rather
    /// than on the wire: a chrome asks for a meter by id, and only the
    /// compositor records.
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
    /// The arguments to give `parec` to record this meter's samples: mono
    /// floats, tagged so the mixer does not list them as a recording.
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

/// The loudest of `samples`, little-endian floats as a meter records them,
/// clipped to full scale. A trailing partial sample is not a sample.
pub fn peak(samples: &[u8]) -> f64 {
    samples
        .as_chunks::<4>()
        .0
        .iter()
        .map(|bytes| f64::from(f32::from_le_bytes(*bytes).abs()))
        .fold(0.0, f64::max)
        .min(1.0)
}

/// What every chrome asked to be metered, each a lease — see
/// [`domicile_protocol::ChromeMessage::WatchAudioLevels`].
#[derive(Debug, Default)]
pub struct LevelWatches {
    by_chrome: HashMap<usize, (Instant, BTreeSet<String>)>,
}

impl LevelWatches {
    /// How long a watch lasts unrenewed. A mixer renews every second.
    pub const LEASE: Duration = Duration::from_secs(3);

    /// `chrome` wants `ids` metered, and nothing else it asked for before.
    pub fn watch(&mut self, chrome: usize, ids: Vec<String>, now: Instant) {
        if ids.is_empty() {
            self.by_chrome.remove(&chrome);
        } else {
            self.by_chrome
                .insert(chrome, (now, ids.into_iter().collect()));
        }
    }

    /// Everything to meter at `now`, the lapsed leases let go of.
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

/// A request a chrome made that names nothing it could have been given.
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

/// What a chrome asked of the sound server — each of
/// [`domicile_protocol::ChromeMessage`]'s audio requests.
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
    /// The arguments to give `pactl`, after `--` so that nothing a name says
    /// is read as an option.
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

    /// What the request is about, for [`coalesce`].
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

/// `requests` without the volumes a later one overtook: a volume is dropped
/// when the next request about the same thing is a volume too. A slider being
/// dragged asks many times a second, and only where it ends up matters.
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

/// Whether a line of `pactl -f json subscribe` says something a mixer draws
/// moved. A doorbell, like the backlight's uevent: what it means is "read the
/// server again".
pub fn announces_a_change(line: &str) -> bool {
    serde_json::from_str::<Subscription>(line).is_ok_and(|event| NEWS.contains(&event.on.as_str()))
}

/// The desk's sound, out of `pactl -f json info` and `pactl -f json list`.
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
    let default_sink = info
        .default_sink_name
        .map(|name| in_front(name, &list.sinks, &list.sink_inputs, |stream| stream.sink));
    let default_source = info.default_source_name.map(|name| {
        in_front(name, &list.sources, &list.source_outputs, |stream| {
            stream.source
        })
    });
    Ok(Audio {
        outputs: list
            .sinks
            .iter()
            .map(|sink| sink.device(Target::Output, default_sink.as_deref()))
            .collect(),
        inputs: list
            .sources
            .iter()
            .map(|source| source.device(Target::Input, default_source.as_deref()))
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

/// The device to call the default: the server's, or the filter in front of
/// it. A laptop's speaker correction is a sink whose stream plays into the
/// speakers, and the session manager sends what plays on the default through
/// it while the speakers stay the server's default — so the filter is what is
/// heard, and what its volume turns. Filters in front of filters are followed
/// to the front; a loop of them stops where it started.
fn in_front(
    default: String,
    devices: &[Device],
    streams: &[Stream],
    on: impl Fn(&Stream) -> u32,
) -> String {
    let mut name = default;
    for _ in 0..devices.len() {
        let Some(device) = devices.iter().find(|device| device.name == name) else {
            break;
        };
        let filter = streams
            .iter()
            .filter(|stream| on(stream) == device.index)
            .filter_map(|stream| stream.properties.get(LINK_GROUP))
            .find_map(|group| {
                devices.iter().find(|other| {
                    other.name != device.name && other.properties.get(LINK_GROUP) == Some(group)
                })
            });
        match filter {
            Some(filter) => name.clone_from(&filter.name),
            None => break,
        }
    }
    name
}

/// The link groups of the devices that are a filter's — PipeWire's
/// filter-chains, a laptop's speaker correction or a noise canceller: a
/// device to play to or record from on one side, and a stream on the other
/// that carries it to the hardware. The stream shares the device's link group,
/// and is the filter's plumbing rather than something playing.
fn plumbing(list: &List) -> BTreeSet<String> {
    list.sinks
        .iter()
        .chain(&list.sources)
        .filter_map(|device| device.properties.get(LINK_GROUP).cloned())
        .collect()
}

/// What each device and playback stream is metered off: an output off its
/// monitor, where the server named one, an input off itself, a stream off the
/// stream.
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

/// The four kinds of thing a volume belongs to, as an id names them.
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

    /// What `pactl` calls it.
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

    /// The kind an id names and the name or index after it. A stream's must
    /// be a number: anything else would be a name `pactl` looks up.
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

/// An id that names a device, and the device's name.
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

/// The loudest channel of a `pactl` volume, as a fraction; silence for one
/// the server calls invalid, which it reports as `{"error": ...}`.
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
    /// `null` from a server that has none to give, and named by its name.
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
    /// A monitor names the sink it is the monitor of. Not every `pactl` says
    /// "none" as `null`: some say it as `""` or as `"n/a"`, as its text does.
    /// The device's class says so too, where the server gives one.
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

    /// Whether it is the far side of a filter's device: see [`plumbing`].
    fn is_plumbing(&self, plumbing: &BTreeSet<String>) -> bool {
        self.properties
            .get(LINK_GROUP)
            .is_some_and(|group| plumbing.contains(group))
    }

    /// The application's name, and the media's as its title — or the media's
    /// as the name, once, where the application gave none.
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
