//! The GStreamer pipeline a recording runs: its sources, encoded as VP8 and
//! Opus, muxed into WebM.

use std::path::Path;

/// Where a recording's video and sound come from, as `gst-launch` fragments
/// that each end in a source pad.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sources {
    pub video: String,
    /// `None` for a recording without sound.
    pub sound: Option<String>,
}

impl Sources {
    /// A cast's PipeWire video node, by id, and its sound node, by name.
    pub fn pipewire(video_node: u32, sound_node: Option<&str>) -> Sources {
        Sources {
            // `do-timestamp` stamps each frame with the pipeline's running
            // time, which stops while it is paused. `path` takes the node's
            // id, which is what the cast reports; `target-object` takes a
            // serial or a name.
            video: format!("pipewiresrc path={video_node} do-timestamp=true always-copy=true"),
            sound: sound_node.map(|node| {
                format!(
                    "pipewiresrc target-object={} do-timestamp=true",
                    quoted(node)
                )
            }),
        }
    }
}

/// The pipeline that records `sources` into `file`.
pub fn description(sources: &Sources, file: &Path) -> String {
    let video = format!(
        "{} ! queue ! videoconvert ! video/x-raw,format=I420 ! queue ! \
         vp8enc deadline=1 cpu-used=8 threads={} end-usage=cq cq-level=10 \
         target-bitrate=16000000 keyframe-max-dist=240 ! queue ! mux.",
        sources.video,
        threads(),
    );
    let sound = sources.sound.as_ref().map(|sound| {
        format!(
            " {sound} ! queue ! audioconvert ! audioresample ! \
             audio/x-raw,channels=2,rate=48000 ! opusenc ! queue ! mux."
        )
    });
    format!(
        "{video}{} webmmux name=mux ! filesink location={}",
        sound.unwrap_or_default(),
        quoted(&file.to_string_lossy()),
    )
}

/// Encoder threads: the machine's cores, at most 8, past which VP8 gains
/// little. One when the count cannot be read, which still records.
fn threads() -> usize {
    std::thread::available_parallelism().map_or(1, |cores| cores.get().min(8))
}

/// `value` as one `gst-launch` property value.
fn quoted(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cast_without_sound_records_video_alone() {
        let sources = Sources::pipewire(42, None);
        let described = description(&sources, Path::new("/tmp/a.webm"));

        assert!(described.starts_with("pipewiresrc path=42 "));
        assert!(!described.contains("opusenc"));
        assert!(described.ends_with("filesink location=\"/tmp/a.webm\""));
    }

    #[test]
    fn a_cast_with_sound_records_its_sound_node_by_name() {
        let sources = Sources::pipewire(42, Some("domicile-sound-desk"));
        let described = description(&sources, Path::new("/tmp/a.webm"));

        assert!(described.contains("pipewiresrc target-object=\"domicile-sound-desk\""));
        assert!(described.contains("opusenc ! queue ! mux."));
    }

    #[test]
    fn a_file_name_with_quotes_stays_one_value() {
        let sources = Sources::pipewire(1, None);
        let described = description(&sources, Path::new("/tmp/say \"hi\".webm"));

        assert!(described.ends_with("location=\"/tmp/say \\\"hi\\\".webm\""));
    }
}
