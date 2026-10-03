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

use std::collections::BTreeMap;

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

/// Applications whose streams are a mixer's own level meters, which every
/// mixer hides — pavucontrol's list.
const MIXERS: &[&str] = &[
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
            .filter(|stream| !stream.is_a_mixers())
            .map(|stream| stream.stream(Target::Playback, stream.sink, &outputs_by_index))
            .collect(),
        recording: list
            .source_outputs
            .iter()
            .filter(|stream| !stream.is_a_mixers())
            .map(|stream| stream.stream(Target::Recording, stream.source, &inputs_by_index))
            .collect(),
        cards: list.cards.iter().map(Card::card).collect(),
    })
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
    /// On a source, the sink it is the monitor of.
    #[serde(default)]
    monitor_source: Option<String>,
    #[serde(default)]
    ports: Vec<Port>,
    active_port: Option<String>,
}

impl Device {
    fn device(&self, target: Target, default: Option<&str>) -> AudioDevice {
        AudioDevice {
            id: target.id(&self.name),
            description: self.description.as_ref().unwrap_or(&self.name).clone(),
            volume: loudest(&self.volume),
            muted: self.mute,
            default: default == Some(self.name.as_str()),
            monitor: target == Target::Input && self.monitor_source.is_some(),
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
