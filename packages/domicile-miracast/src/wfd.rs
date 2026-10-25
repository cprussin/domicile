//! Wi-Fi Display parameters: what a TV says it plays, and the one format of
//! each this source picks to send.

/// A video mode from the CEA table of `wfd_video_formats`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VideoMode {
    /// Its bit in the CEA mask.
    pub bit: u32,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// The lowest H.264 level bit (`wfd_video_formats`' level field) that
    /// carries it.
    pub level: u8,
}

/// The modes this source sends, best first. Progressive, since the encoder
/// sends whole frames.
const MODES: [VideoMode; 4] = [
    VideoMode {
        bit: 7,
        width: 1920,
        height: 1080,
        fps: 30,
        level: LEVEL_4,
    },
    VideoMode {
        bit: 5,
        width: 1280,
        height: 720,
        fps: 30,
        level: LEVEL_3_1,
    },
    VideoMode {
        bit: 6,
        width: 1280,
        height: 720,
        fps: 60,
        level: LEVEL_3_2,
    },
    // Every sink plays 640x480p60, so it is the last resort.
    VideoMode {
        bit: 0,
        width: 640,
        height: 480,
        fps: 60,
        level: LEVEL_3_1,
    },
];

const LEVEL_3_1: u8 = 0x01;
const LEVEL_3_2: u8 = 0x02;
const LEVEL_4: u8 = 0x04;

/// Constrained Baseline, which every sink decodes.
const PROFILE_CBP: u8 = 0x01;

/// What a TV says it plays, from its answer to `GET_PARAMETER`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SinkCapabilities {
    /// CEA modes of its Constrained Baseline codec entries.
    pub cea: u32,
    /// The highest level bit of those entries.
    pub level: u8,
    /// It plays 48 kHz stereo AAC.
    pub aac: bool,
    /// The UDP port it hears RTP on.
    pub rtp_port: u16,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CapabilityError {
    #[error("the TV named no port to send the picture to")]
    NoRtpPort,
}

/// What is sent: the mode, and whether sound goes with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Negotiated {
    pub mode: VideoMode,
    pub aac: bool,
    pub rtp_port: u16,
}

/// The parameters `M3` asks for.
pub const ASKED: &str = "wfd_video_formats\r\nwfd_audio_codecs\r\nwfd_client_rtp_ports\r\n";

/// Reads a TV's answer to `M3`.
pub fn capabilities(parameters: &[(&str, &str)]) -> Result<SinkCapabilities, CapabilityError> {
    let value = |name: &str| {
        parameters
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| *value)
    };
    let (cea, level) = value("wfd_video_formats")
        .map(video_formats)
        .unwrap_or((0, 0));
    let aac = value("wfd_audio_codecs").is_some_and(|codecs| {
        codecs.split(',').any(|codec| {
            let mut fields = codec.split_whitespace();
            fields.next() == Some("AAC")
                && fields
                    .next()
                    .and_then(|modes| u32::from_str_radix(modes, 16).ok())
                    .is_some_and(|modes| modes & 1 != 0)
        })
    });
    let rtp_port = value("wfd_client_rtp_ports")
        .and_then(|ports| ports.split_whitespace().nth(1))
        .and_then(|port| port.parse().ok())
        .filter(|port| *port != 0)
        .ok_or(CapabilityError::NoRtpPort)?;
    Ok(SinkCapabilities {
        cea,
        level,
        aac,
        rtp_port,
    })
}

/// The CEA modes and highest level of the Constrained Baseline entries of a
/// `wfd_video_formats` value: `native preferred codec[, codec…]`, each codec
/// `profile level cea vesa hh latency slice slice-params rate-control hres
/// vres`.
fn video_formats(value: &str) -> (u32, u8) {
    let mut fields = value.splitn(3, ' ');
    let codecs = fields.nth(2).unwrap_or_default();
    codecs
        .split(',')
        .filter_map(|codec| {
            let fields: Vec<&str> = codec.split_whitespace().collect();
            let profile = u8::from_str_radix(fields.first()?, 16).ok()?;
            let level = u8::from_str_radix(fields.get(1)?, 16).ok()?;
            let cea = u32::from_str_radix(fields.get(2)?, 16).ok()?;
            (profile & PROFILE_CBP != 0).then_some((cea, level))
        })
        .fold((0, 0), |(cea, level), (more, at)| {
            (cea | more, level.max(at))
        })
}

/// The best mode of [`MODES`] the TV plays: 640x480p60 when it names none,
/// since every sink must play it.
pub fn negotiate(sink: &SinkCapabilities) -> Negotiated {
    // A level bit carries the levels below it too.
    let mode = MODES
        .into_iter()
        .find(|mode| sink.cea & (1 << mode.bit) != 0 && sink.level >= mode.level)
        .unwrap_or(MODES[MODES.len() - 1]);
    Negotiated {
        mode,
        aac: sink.aac,
        rtp_port: sink.rtp_port,
    }
}

/// The `M4` body: what is sent, and where the TV asks for it.
pub fn chosen(negotiated: &Negotiated, source_address: &str) -> String {
    let mode = negotiated.mode;
    let mut body = format!(
        "wfd_video_formats: 00 00 {PROFILE_CBP:02x} {:02x} {:08x} 00000000 00000000 00 0000 0000 00 none none\r\n",
        mode.level,
        1u32 << mode.bit,
    );
    if negotiated.aac {
        body.push_str("wfd_audio_codecs: AAC 00000001 00\r\n");
    }
    body.push_str(&format!(
        "wfd_presentation_URL: rtsp://{source_address}/wfd1.0/streamid=0 none\r\n\
         wfd_client_rtp_ports: RTP/AVP/UDP;unicast {} 0 mode=play\r\n",
        negotiated.rtp_port,
    ));
    body
}

/// The port a source listens for its TV's RTSP on.
pub const RTSP_PORT: u16 = 7236;

/// This source's WFD device information subelement, for its Wi-Fi Direct
/// probes: a source, available for a session, at [`RTSP_PORT`], up to
/// 200 Mbit/s.
pub fn source_ies() -> Vec<u8> {
    let [port_high, port_low] = RTSP_PORT.to_be_bytes();
    // Subelement 0, length 6: device information bits, port, throughput.
    vec![
        0x00, 0x00, 0x06, 0x00, 0x90, port_high, port_low, 0x00, 0xc8,
    ]
}

/// Whether a peer's WFD subelements name a display: a primary or secondary
/// sink, or a device that is both.
pub fn is_sink(ies: &[u8]) -> bool {
    subelements(ies)
        .find(|(id, _)| *id == 0)
        .and_then(|(_, body)| body.get(..2))
        .is_some_and(|info| info[1] & 0b11 != 0)
}

/// `(id, body)` of each subelement of `ies`.
fn subelements(ies: &[u8]) -> impl Iterator<Item = (u8, &[u8])> {
    let mut rest = ies;
    std::iter::from_fn(move || {
        let [id, high, low, tail @ ..] = rest else {
            return None;
        };
        let length = usize::from(u16::from_be_bytes([*high, *low]));
        let body = tail.get(..length)?;
        rest = &tail[length..];
        Some((*id, body))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const LG: [(&str, &str); 3] = [
        (
            "wfd_video_formats",
            "00 00 03 10 0001ffff 1fffffff 00001fff 00 0000 0000 10 none none, 02 08 0001ffff 1fffffff 00001fff 00 0000 0000 10 none none",
        ),
        ("wfd_audio_codecs", "LPCM 00000002 00, AAC 00000007 00, AC3 00000007 00"),
        ("wfd_client_rtp_ports", "RTP/AVP/UDP;unicast 1028 0 mode=play"),
    ];

    #[test]
    fn reads_what_a_tv_plays() {
        assert_eq!(
            capabilities(&LG),
            Ok(SinkCapabilities {
                cea: 0x0001_ffff,
                level: 0x10,
                aac: true,
                rtp_port: 1028,
            })
        );
    }

    #[test]
    fn sends_1080p30_to_a_tv_that_plays_it() {
        let negotiated = negotiate(&capabilities(&LG).unwrap());

        assert_eq!((negotiated.mode.width, negotiated.mode.fps), (1920, 30));
        assert!(negotiated.aac);
    }

    #[test]
    fn sends_less_to_a_tv_whose_level_is_low() {
        let sink = SinkCapabilities {
            cea: 0x0001_ffff,
            level: LEVEL_3_1,
            aac: false,
            rtp_port: 1,
        };

        assert_eq!(negotiate(&sink).mode.height, 720);
    }

    #[test]
    fn falls_back_to_640x480() {
        let sink = SinkCapabilities {
            cea: 1,
            level: LEVEL_3_1,
            aac: false,
            rtp_port: 1,
        };

        assert_eq!(negotiate(&sink).mode.width, 640);
    }

    #[test]
    fn needs_a_port() {
        assert_eq!(capabilities(&LG[..2]), Err(CapabilityError::NoRtpPort));
    }

    #[test]
    fn hears_no_sound_without_aac() {
        let without = [LG[0], ("wfd_audio_codecs", "LPCM 00000002 00"), LG[2]];

        assert!(!capabilities(&without).unwrap().aac);
    }

    #[test]
    fn writes_the_chosen_formats() {
        let negotiated = Negotiated {
            mode: MODES[0],
            aac: true,
            rtp_port: 1028,
        };

        assert_eq!(
            chosen(&negotiated, "192.168.49.1"),
            "wfd_video_formats: 00 00 01 04 00000080 00000000 00000000 00 0000 0000 00 none none\r\n\
             wfd_audio_codecs: AAC 00000001 00\r\n\
             wfd_presentation_URL: rtsp://192.168.49.1/wfd1.0/streamid=0 none\r\n\
             wfd_client_rtp_ports: RTP/AVP/UDP;unicast 1028 0 mode=play\r\n"
        );
    }

    #[test]
    fn tells_sinks_from_sources() {
        assert!(is_sink(&[
            0x00, 0x00, 0x06, 0x01, 0x11, 0x1c, 0x44, 0x00, 0x32
        ]));
        assert!(!is_sink(&source_ies()));
        assert!(!is_sink(&[]));
    }
}
