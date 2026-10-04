//! The desk's sound, read off `pactl -f json` and asked of it in `pactl`'s own
//! words.

use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use domicile_host::audio::{
    announces_a_change, coalesce, peak, reading, AudioError, LevelWatches, Meter, Request,
};
use domicile_protocol::{AudioCard, AudioChoice, AudioDevice, AudioStream};

/// `pactl -f json info`, cut down to what is read.
const INFO: &str = r#"{"server_name":"PulseAudio (on PipeWire 1.2.7)","default_sink_name":"alsa_output.analog-stereo","default_source_name":"alsa_input.analog-stereo"}"#;

/// `pactl -f json list`, cut down to what is read and one of everything.
const LIST: &str = r#"{
  "modules": [],
  "sinks": [
    {"index": 51, "name": "alsa_output.analog-stereo", "description": "Built-in Audio Analog Stereo",
     "mute": false, "monitor_source": "alsa_output.analog-stereo.monitor",
     "volume": {"front-left": {"value": 32768, "value_percent": "50%", "db": "-18.06 dB"},
                "front-right": {"value": 39322, "value_percent": "60%", "db": "-13.31 dB"}},
     "properties": {},
     "ports": [
       {"name": "analog-output-speaker", "description": "Speakers", "priority": 10000, "availability": "availability unknown"},
       {"name": "analog-output-headphones", "description": "Headphones", "priority": 9900, "availability": "not available"}
     ],
     "active_port": "analog-output-speaker"},
    {"index": 60, "name": "hdmi", "description": "HDMI", "mute": true,
     "volume": {"error": "(invalid)"}, "properties": {}, "ports": [], "active_port": null}
  ],
  "sources": [
    {"index": 52, "name": "alsa_output.analog-stereo.monitor", "description": "Monitor of Built-in Audio Analog Stereo",
     "mute": false, "volume": {"front-left": {"value": 65536}}, "monitor_source": "alsa_output.analog-stereo",
     "properties": {}, "ports": [], "active_port": null},
    {"index": 53, "name": "alsa_input.analog-stereo", "description": "Built-in Audio Analog Stereo",
     "mute": true, "volume": {"mono": {"value": 16384}}, "monitor_source": null,
     "properties": {}, "ports": [{"name": "analog-input-mic", "description": "Microphone", "availability": "available"}],
     "active_port": "analog-input-mic"}
  ],
  "sink_inputs": [
    {"index": 42, "sink": 51, "mute": false, "volume": {"front-left": {"value": 65536}},
     "properties": {"application.name": "Firefox", "media.name": "A song"}},
    {"index": 43, "sink": 51, "mute": false, "volume": {"mono": {"value": 65536}},
     "properties": {"media.name": "bell"}},
    {"index": 44, "sink": 99, "mute": false, "volume": {"mono": {"value": 65536}},
     "properties": {"application.name": "late"}},
    {"index": 45, "sink": 51, "mute": false, "volume": {"mono": {"value": 65536}},
     "properties": {"application.name": "Volume Control", "application.id": "org.PulseAudio.pavucontrol"}}
  ],
  "source_outputs": [
    {"index": 7, "source": 53, "mute": true, "volume": {"mono": {"value": 16384}},
     "properties": {"application.name": "Recorder"}}
  ],
  "clients": [],
  "samples": [],
  "cards": [
    {"index": 1, "name": "alsa_card.pci", "properties": {"device.description": "Built-in Audio"},
     "profiles": {
       "off": {"description": "Off", "sinks": 0, "sources": 0, "priority": 0, "available": true},
       "output:hdmi-stereo": {"description": "Digital Stereo (HDMI) Output", "priority": 5900, "available": false},
       "output:analog-stereo": {"description": "Analog Stereo Output", "priority": 6500, "available": true}
     },
     "active_profile": "output:analog-stereo"},
    {"index": 2, "name": "bluez_card.00_11", "properties": {}, "profiles": {}, "active_profile": null}
  ]
}"#;

fn choice(name: &str, description: &str, available: bool) -> AudioChoice {
    AudioChoice {
        name: name.into(),
        description: description.into(),
        available,
    }
}

mod reading_the_server {
    use super::*;

    #[test]
    fn outputs_are_the_sinks_at_their_loudest_channel() {
        let audio = reading(INFO, LIST).unwrap();

        assert_eq!(
            audio.outputs,
            vec![
                AudioDevice {
                    id: "output:alsa_output.analog-stereo".into(),
                    description: "Built-in Audio Analog Stereo".into(),
                    volume: 39322.0 / 65536.0,
                    muted: false,
                    default: true,
                    monitor: false,
                    ports: vec![
                        choice("analog-output-speaker", "Speakers", true),
                        choice("analog-output-headphones", "Headphones", false),
                    ],
                    port: Some("analog-output-speaker".into()),
                },
                // A volume the server calls invalid reads as silence.
                AudioDevice {
                    id: "output:hdmi".into(),
                    description: "HDMI".into(),
                    volume: 0.0,
                    muted: true,
                    default: false,
                    monitor: false,
                    ports: Vec::new(),
                    port: None,
                },
            ]
        );
    }

    #[test]
    fn inputs_are_the_sources_with_the_monitors_flagged() {
        let audio = reading(INFO, LIST).unwrap();

        assert_eq!(
            audio
                .inputs
                .iter()
                .map(|input| (
                    input.id.as_str(),
                    input.monitor,
                    input.default,
                    input.volume
                ))
                .collect::<Vec<_>>(),
            vec![
                ("input:alsa_output.analog-stereo.monitor", true, false, 1.0),
                ("input:alsa_input.analog-stereo", false, true, 0.25),
            ]
        );
    }

    #[test]
    fn streams_name_their_application_and_their_device() {
        let audio = reading(INFO, LIST).unwrap();

        assert_eq!(
            audio.playback,
            vec![
                AudioStream {
                    id: "playback:42".into(),
                    application: "Firefox".into(),
                    title: Some("A song".into()),
                    volume: 1.0,
                    muted: false,
                    device: Some("output:alsa_output.analog-stereo".into()),
                },
                // No application name: the media's stands in, said once.
                AudioStream {
                    id: "playback:43".into(),
                    application: "bell".into(),
                    title: None,
                    volume: 1.0,
                    muted: false,
                    device: Some("output:alsa_output.analog-stereo".into()),
                },
                // On a sink the list has not caught up with.
                AudioStream {
                    id: "playback:44".into(),
                    application: "late".into(),
                    title: None,
                    volume: 1.0,
                    muted: false,
                    device: None,
                },
            ]
        );
        assert_eq!(
            audio.recording,
            vec![AudioStream {
                id: "recording:7".into(),
                application: "Recorder".into(),
                title: None,
                volume: 0.25,
                muted: true,
                device: Some("input:alsa_input.analog-stereo".into()),
            }]
        );
    }

    #[test]
    fn cards_list_their_profiles_best_first() {
        let audio = reading(INFO, LIST).unwrap();

        assert_eq!(
            audio.cards,
            vec![
                AudioCard {
                    id: "alsa_card.pci".into(),
                    description: "Built-in Audio".into(),
                    profiles: vec![
                        choice("output:analog-stereo", "Analog Stereo Output", true),
                        choice("output:hdmi-stereo", "Digital Stereo (HDMI) Output", false),
                        choice("off", "Off", true),
                    ],
                    profile: Some("output:analog-stereo".into()),
                },
                // No description of its own: named by its name.
                AudioCard {
                    id: "bluez_card.00_11".into(),
                    description: "bluez_card.00_11".into(),
                    profiles: Vec::new(),
                    profile: None,
                },
            ]
        );
    }

    #[test]
    fn what_is_not_json_is_an_error() {
        assert!(reading(INFO, "Connection failure").is_err());
    }
}

mod asking_the_server {
    use super::*;

    fn argv(request: Request) -> Vec<String> {
        request.argv().unwrap()
    }

    #[test]
    fn a_volume_is_the_raw_value_of_every_channel() {
        assert_eq!(
            argv(Request::Volume {
                id: "output:speakers".into(),
                volume: 0.5
            }),
            ["--", "set-sink-volume", "speakers", "32768"]
        );
        assert_eq!(
            argv(Request::Volume {
                id: "input:mic".into(),
                volume: 1.0
            }),
            ["--", "set-source-volume", "mic", "65536"]
        );
        assert_eq!(
            argv(Request::Volume {
                id: "playback:42".into(),
                volume: 0.25
            }),
            ["--", "set-sink-input-volume", "42", "16384"]
        );
        assert_eq!(
            argv(Request::Volume {
                id: "recording:7".into(),
                volume: 0.0
            }),
            ["--", "set-source-output-volume", "7", "0"]
        );
    }

    /// pavucontrol's ceiling, and never below silence.
    #[test]
    fn a_volume_is_kept_between_silence_and_the_ceiling() {
        assert_eq!(
            argv(Request::Volume {
                id: "output:s".into(),
                volume: 9.0
            })[3],
            "98304"
        );
        assert_eq!(
            argv(Request::Volume {
                id: "output:s".into(),
                volume: -1.0
            })[3],
            "0"
        );
        assert_eq!(
            Request::Volume {
                id: "output:s".into(),
                volume: f64::NAN
            }
            .argv(),
            Err(AudioError::NotANumber)
        );
    }

    #[test]
    fn muting_names_the_same_things() {
        assert_eq!(
            argv(Request::Muted {
                id: "output:speakers".into(),
                muted: true
            }),
            ["--", "set-sink-mute", "speakers", "1"]
        );
        assert_eq!(
            argv(Request::Muted {
                id: "recording:7".into(),
                muted: false
            }),
            ["--", "set-source-output-mute", "7", "0"]
        );
    }

    #[test]
    fn a_default_is_a_device() {
        assert_eq!(
            argv(Request::Default {
                id: "output:speakers".into()
            }),
            ["--", "set-default-sink", "speakers"]
        );
        assert_eq!(
            argv(Request::Default {
                id: "input:mic".into()
            }),
            ["--", "set-default-source", "mic"]
        );
        assert_eq!(
            Request::Default {
                id: "playback:4".into()
            }
            .argv(),
            Err(AudioError::NotADevice("playback:4".into()))
        );
    }

    #[test]
    fn a_stream_moves_to_a_device_of_its_own_direction() {
        assert_eq!(
            argv(Request::Move {
                id: "playback:42".into(),
                device: "output:headphones".into()
            }),
            ["--", "move-sink-input", "42", "headphones"]
        );
        assert_eq!(
            argv(Request::Move {
                id: "recording:7".into(),
                device: "input:speakers.monitor".into()
            }),
            ["--", "move-source-output", "7", "speakers.monitor"]
        );
        assert_eq!(
            Request::Move {
                id: "playback:42".into(),
                device: "input:mic".into()
            }
            .argv(),
            Err(AudioError::Mismatched {
                stream: "playback:42".into(),
                device: "input:mic".into()
            })
        );
    }

    #[test]
    fn ports_and_profiles() {
        assert_eq!(
            argv(Request::Port {
                id: "output:s".into(),
                port: "analog-output-headphones".into()
            }),
            ["--", "set-sink-port", "s", "analog-output-headphones"]
        );
        assert_eq!(
            argv(Request::Port {
                id: "input:m".into(),
                port: "analog-input-mic".into()
            }),
            ["--", "set-source-port", "m", "analog-input-mic"]
        );
        assert_eq!(
            argv(Request::Profile {
                card: "alsa_card.pci".into(),
                profile: "off".into()
            }),
            ["--", "set-card-profile", "alsa_card.pci", "off"]
        );
    }

    #[test]
    fn an_id_the_desk_never_gave_is_an_error() {
        for id in ["speakers", "sink:speakers", "playback:forty-two", "output:"] {
            assert_eq!(
                Request::Muted {
                    id: id.into(),
                    muted: true
                }
                .argv(),
                Err(AudioError::UnknownId(id.into()))
            );
        }
    }
}

/// A slider being dragged asks many times a second; only where it ends up,
/// per thing dragged, is worth a `pactl`.
#[test]
fn a_drag_is_asked_for_where_it_ends_up() {
    let volume = |id: &str, volume| Request::Volume {
        id: id.into(),
        volume,
    };
    let mute = Request::Muted {
        id: "output:a".into(),
        muted: true,
    };

    assert_eq!(
        coalesce(vec![
            volume("output:a", 0.1),
            volume("input:b", 0.2),
            volume("output:a", 0.3),
            mute.clone(),
            volume("output:a", 0.4),
        ]),
        vec![
            volume("input:b", 0.2),
            volume("output:a", 0.3),
            mute,
            volume("output:a", 0.4),
        ]
    );
}

/// `pactl subscribe` reports its own `pactl list` as a client coming and
/// going: re-reading on that would be reading forever.
#[test]
fn only_the_mixers_own_things_are_news() {
    for on in [
        "sink",
        "source",
        "sink-input",
        "source-output",
        "card",
        "server",
    ] {
        assert!(announces_a_change(&format!(
            r#"{{"index":1,"event":"change","on":"{on}"}}"#
        )));
    }
    for on in ["client", "module", "sample-cache"] {
        assert!(!announces_a_change(&format!(
            r#"{{"index":1,"event":"new","on":"{on}"}}"#
        )));
    }
    assert!(!announces_a_change("not json"));
}

mod metering {
    use super::*;

    #[test]
    fn an_output_is_metered_off_its_monitor_and_an_input_off_itself() {
        let audio = reading(INFO, LIST).unwrap();

        assert_eq!(
            audio.meters.get("output:alsa_output.analog-stereo"),
            Some(&Meter::Source("alsa_output.analog-stereo.monitor".into()))
        );
        assert_eq!(
            audio.meters.get("input:alsa_input.analog-stereo"),
            Some(&Meter::Source("alsa_input.analog-stereo".into()))
        );
        // An output whose monitor the server did not name has no meter.
        assert_eq!(audio.meters.get("output:hdmi"), None);
    }

    #[test]
    fn a_playback_stream_is_metered_off_the_stream_itself() {
        let audio = reading(INFO, LIST).unwrap();

        assert_eq!(audio.meters.get("playback:42"), Some(&Meter::Stream(42)));
    }

    /// Mono floats, a few hundred a second, tagged so the mixer does not list
    /// its own meters as recordings.
    #[test]
    fn a_meter_records_mono_floats_and_names_itself() {
        let common = [
            "--raw",
            "--format=float32le",
            "--channels=1",
            "--rate=1000",
            "--latency-msec=30",
            "--property=application.id=org.domicile.meter",
        ];
        assert_eq!(
            Meter::Source("mic".into()).argv(),
            [&["--device=mic"][..], &common[..]].concat()
        );
        assert_eq!(
            Meter::Stream(42).argv(),
            [&["--monitor-stream=42"][..], &common[..]].concat()
        );
    }

    #[test]
    fn a_filters_own_stream_is_not_something_playing() {
        // A laptop's speaker correction: a sink to play to, and a stream from
        // it into the hardware, tied by their link group.
        let list = LIST
            .replace(
                r#""sinks": ["#,
                r#""sinks": [
    {"index": 76, "name": "audio_effect.laptop-convolver", "description": "Framework Speakers",
     "mute": false, "volume": {"front-left": {"value": 45875}}, "monitor_source": "audio_effect.laptop-convolver.monitor",
     "properties": {"node.link-group": "filter-chain-3901-18"}, "ports": [], "active_port": null},"#,
            )
            .replace(
                r#""sink_inputs": ["#,
                r#""sink_inputs": [
    {"index": 77, "sink": 51, "mute": false, "volume": {"mono": {"value": 65536}},
     "properties": {"media.name": "Framework Speakers", "node.link-group": "filter-chain-3901-18"}},"#,
            );

        let audio = reading(INFO, &list).unwrap();

        assert!(audio
            .playback
            .iter()
            .all(|stream| stream.id != "playback:77"));
        assert_eq!(audio.playback.len(), 3);
    }

    #[test]
    fn an_input_that_names_no_sink_is_not_a_monitor() {
        for none in [r#""""#, r#""n/a""#] {
            let list = LIST.replace(
                r#""monitor_source": null,"#,
                &format!(r#""monitor_source": {none},"#),
            );

            let audio = reading(INFO, &list).unwrap();

            assert!(
                !audio.inputs[1].monitor,
                "{none} is no sink, so the microphone is no monitor"
            );
        }
    }

    #[test]
    fn the_device_class_says_what_is_a_monitor() {
        let list = LIST.replace(
            r#""monitor_source": "alsa_output.analog-stereo",
     "properties": {}"#,
            r#""monitor_source": "",
     "properties": {"device.class": "monitor"}"#,
        );

        let audio = reading(INFO, &list).unwrap();

        assert!(audio.inputs[0].monitor);
    }

    #[test]
    fn the_filter_in_front_of_the_default_is_the_default() {
        // The speakers stay the server's default; their correction plays
        // into them, and is what is heard.
        let list = LIST
            .replace(
                r#""sinks": ["#,
                r#""sinks": [
    {"index": 76, "name": "audio_effect.laptop-convolver", "description": "Framework Speakers",
     "mute": false, "volume": {"front-left": {"value": 45875}}, "monitor_source": "audio_effect.laptop-convolver.monitor",
     "properties": {"node.link-group": "filter-chain-3901-18"}, "ports": [], "active_port": null},"#,
            )
            .replace(
                r#""sink_inputs": ["#,
                r#""sink_inputs": [
    {"index": 77, "sink": 51, "mute": false, "volume": {"mono": {"value": 65536}},
     "properties": {"media.name": "Framework Speakers", "node.link-group": "filter-chain-3901-18"}},"#,
            );

        let audio = reading(INFO, &list).unwrap();

        let defaults: Vec<_> = audio
            .outputs
            .iter()
            .filter(|output| output.default)
            .map(|output| output.id.as_str())
            .collect();
        assert_eq!(defaults, ["output:audio_effect.laptop-convolver"]);
    }

    #[test]
    fn the_meters_own_recordings_are_not_listed() {
        let list = LIST.replace(
            r#""source_outputs": ["#,
            r#""source_outputs": [
    {"index": 9, "source": 52, "mute": false, "volume": {"mono": {"value": 65536}},
     "properties": {"application.id": "org.domicile.meter"}},"#,
        );

        let audio = reading(INFO, &list).unwrap();

        assert_eq!(audio.recording.len(), 1);
    }

    #[test]
    fn the_peak_is_the_loudest_sample_either_way() {
        let samples: Vec<u8> = [0.1f32, -0.75, 0.5]
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect();

        assert_eq!(peak(&samples), 0.75);
        assert_eq!(peak(&[]), 0.0);
    }

    /// Clipped, because a float stream can carry more than full scale.
    #[test]
    fn the_peak_never_reads_past_full_scale() {
        assert_eq!(peak(&1.5f32.to_le_bytes()), 1.0);
    }
}

mod watching {
    use super::*;

    fn ids(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| (*id).to_string()).collect()
    }

    fn set(ids: &[&str]) -> BTreeSet<String> {
        ids.iter().map(|id| (*id).to_string()).collect()
    }

    #[test]
    fn what_every_chrome_asked_for_is_metered() {
        let now = Instant::now();
        let mut watches = LevelWatches::default();

        watches.watch(1, ids(&["output:a"]), now);
        watches.watch(2, ids(&["input:b", "output:a"]), now);

        assert_eq!(watches.watched(now), set(&["input:b", "output:a"]));
    }

    #[test]
    fn a_chrome_asking_again_replaces_what_it_asked_for() {
        let now = Instant::now();
        let mut watches = LevelWatches::default();

        watches.watch(1, ids(&["output:a"]), now);
        watches.watch(1, ids(&["input:b"]), now);

        assert_eq!(watches.watched(now), set(&["input:b"]));
    }

    #[test]
    fn nothing_is_an_answer() {
        let now = Instant::now();
        let mut watches = LevelWatches::default();

        watches.watch(1, ids(&["output:a"]), now);
        watches.watch(1, Vec::new(), now);

        assert_eq!(watches.watched(now), BTreeSet::new());
    }

    /// The lease: a page that went away without saying so stops being
    /// metered, rather than leaving a microphone recording.
    #[test]
    fn a_watch_nobody_renewed_lapses() {
        let then = Instant::now();
        let mut watches = LevelWatches::default();
        watches.watch(1, ids(&["input:mic"]), then);
        watches.watch(2, ids(&["output:a"]), then + Duration::from_secs(2));

        assert_eq!(
            watches.watched(then + LevelWatches::LEASE + Duration::from_millis(1)),
            set(&["output:a"])
        );
    }
}
