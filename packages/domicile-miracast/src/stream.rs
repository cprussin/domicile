//! The picture and sound a cast sends: a GStreamer pipeline from the
//! ScreenCast portal's PipeWire stream and the speakers' monitor, encoded to
//! H.264 and AAC, muxed to MPEG-TS, and sent over RTP.
//!
//! The pipeline runs as `gst-launch-1.0`, so a broken plugin ends that
//! process and not the service.

use std::io;
use std::net::IpAddr;
use std::os::fd::{AsRawFd, OwnedFd};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};

use crate::wfd::Negotiated;

/// The descriptor the pipeline finds the PipeWire remote on.
const PIPEWIRE_FD: i32 = 3;

/// Where to send, and what.
#[derive(Debug, Clone)]
pub struct Target {
    pub address: IpAddr,
    pub negotiated: Negotiated,
    /// The portal's PipeWire node.
    pub node: u32,
}

/// The H.264 encoder: the GPU's through VA-API when there is one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoder {
    VaApi,
    X264,
}

impl Encoder {
    /// The first encoder `gst-inspect-1.0` finds.
    pub fn found() -> Self {
        let has = |element: &str| {
            Command::new("gst-inspect-1.0")
                .arg("--exists")
                .arg(element)
                .status()
                .is_ok_and(|status| status.success())
        };
        match has("vah264enc") {
            true => Encoder::VaApi,
            false => Encoder::X264,
        }
    }

    fn element(self, fps: u32) -> String {
        // A key frame a second, so a TV that drops a packet recovers quickly.
        match self {
            Encoder::VaApi => format!("vah264enc key-int-max={fps} rate-control=cbr bitrate=8000"),
            Encoder::X264 => format!(
                "x264enc tune=zerolatency speed-preset=ultrafast key-int-max={fps} bitrate=8000"
            ),
        }
    }
}

/// `gst-launch-1.0`'s arguments: one pipeline description, split on spaces
/// as the shell would.
pub fn pipeline(target: &Target, encoder: Encoder) -> Vec<String> {
    let mode = target.negotiated.mode;
    let video = format!(
        "pipewiresrc fd={PIPEWIRE_FD} path={node} do-timestamp=true keepalive-time=1000 \
         ! videoconvert ! videoscale ! videorate \
         ! video/x-raw,format=NV12,width={width},height={height},framerate={fps}/1,pixel-aspect-ratio=1/1 \
         ! {encoder} \
         ! h264parse config-interval=-1 \
         ! video/x-h264,stream-format=byte-stream,alignment=au,profile=constrained-baseline \
         ! queue ! mux.",
        node = target.node,
        width = mode.width,
        height = mode.height,
        fps = mode.fps,
        encoder = encoder.element(mode.fps),
    );
    let audio = "pulsesrc device=@DEFAULT_MONITOR@ \
         ! audioconvert ! audioresample \
         ! audio/x-raw,rate=48000,channels=2 \
         ! avenc_aac ! aacparse ! queue ! mux.";
    let out = format!(
        "mpegtsmux name=mux alignment=7 \
         ! rtpmp2tpay ! udpsink host={address} port={port} sync=false",
        address = target.address,
        port = target.negotiated.rtp_port,
    );
    let mut description = vec![video];
    if target.negotiated.aac {
        description.push(audio.to_string());
    }
    description.push(out);
    std::iter::once("-q".to_string())
        .chain(description.join(" ").split_whitespace().map(str::to_string))
        .collect()
}

/// Starts sending to `target` from the PipeWire remote `remote`.
pub fn spawn(target: &Target, remote: OwnedFd, encoder: Encoder) -> io::Result<Child> {
    let mut command = Command::new("gst-launch-1.0");
    command
        .args(pipeline(target, encoder))
        .stdin(Stdio::null())
        .stdout(Stdio::null());
    let fd = remote.as_raw_fd();
    // SAFETY: `dup2` is async-signal-safe and nothing here allocates. The
    // copy has no `FD_CLOEXEC`, so the pipeline keeps it.
    unsafe {
        command.pre_exec(move || match libc::dup2(fd, PIPEWIRE_FD) {
            -1 => Err(io::Error::last_os_error()),
            _ => Ok(()),
        });
    }
    let child = command.spawn();
    drop(remote);
    child
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wfd::VideoMode;

    fn target(aac: bool) -> Target {
        Target {
            address: "192.168.49.10".parse().unwrap(),
            negotiated: Negotiated {
                mode: VideoMode {
                    bit: 7,
                    width: 1920,
                    height: 1080,
                    fps: 30,
                    level: 4,
                },
                aac,
                rtp_port: 1028,
            },
            node: 42,
        }
    }

    #[test]
    fn sends_the_negotiated_mode_to_the_tv() {
        let arguments = pipeline(&target(true), Encoder::X264).join(" ");

        assert!(arguments.contains("pipewiresrc fd=3 path=42"));
        assert!(arguments.contains("width=1920,height=1080,framerate=30/1"));
        assert!(
            arguments.contains("x264enc tune=zerolatency speed-preset=ultrafast key-int-max=30")
        );
        assert!(arguments.contains("udpsink host=192.168.49.10 port=1028"));
        assert!(arguments.contains("avenc_aac"));
    }

    #[test]
    fn sends_no_sound_to_a_tv_without_aac() {
        let arguments = pipeline(&target(false), Encoder::VaApi).join(" ");

        assert!(!arguments.contains("pulsesrc"));
        assert!(arguments.contains("vah264enc"));
    }
}
