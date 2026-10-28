//! The GStreamer pipeline a recording runs: its sources, encoded as AV1 or
//! VP9 on the GPU or VP8 on the CPU, and Opus, muxed into WebM.

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

/// What encodes a recording's video.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoder {
    /// The GPU, through VA-API.
    Gpu(GpuEncoder),
    /// VP8 on the CPU, which falls behind on a stream near 4K.
    Cpu,
}

/// A VA-API encoder, by the codec and the GPU block that runs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuEncoder {
    Av1,
    Av1LowPower,
    Vp9,
    Vp9LowPower,
}

impl GpuEncoder {
    /// Best first: AV1 is the smaller file at the same quality.
    const ALL: [GpuEncoder; 4] = [
        GpuEncoder::Av1,
        GpuEncoder::Av1LowPower,
        GpuEncoder::Vp9,
        GpuEncoder::Vp9LowPower,
    ];

    fn element(self) -> &'static str {
        match self {
            GpuEncoder::Av1 => "vaav1enc",
            GpuEncoder::Av1LowPower => "vaav1lpenc",
            GpuEncoder::Vp9 => "vavp9enc",
            GpuEncoder::Vp9LowPower => "vavp9lpenc",
        }
    }

    fn parser(self) -> &'static str {
        match self {
            GpuEncoder::Av1 | GpuEncoder::Av1LowPower => "av1parse",
            GpuEncoder::Vp9 | GpuEncoder::Vp9LowPower => "vp9parse",
        }
    }
}

impl Encoder {
    /// The best encoder for which `has` finds an element. The VA-API plugin
    /// has an element only for what this machine's GPU encodes.
    pub fn first(has: impl Fn(&str) -> bool) -> Encoder {
        GpuEncoder::ALL
            .into_iter()
            .find(|gpu| has(gpu.element()))
            .map_or(Encoder::Cpu, Encoder::Gpu)
    }

    /// The pipeline from a source's raw frames to encoded ones.
    fn video(self) -> String {
        match self {
            // The frames come in system memory: `always-copy` copies a
            // buffer, which a dmabuf cannot be.
            Encoder::Gpu(gpu) => format!(
                "video/x-raw ! queue ! vapostproc ! \
                 video/x-raw(memory:VAMemory),format=NV12 ! queue ! \
                 {} key-int-max=240 ! {}",
                gpu.element(),
                gpu.parser(),
            ),
            Encoder::Cpu => format!(
                "queue ! videoconvert n-threads=0 ! video/x-raw,format=I420 ! queue ! \
                 vp8enc deadline=1 cpu-used=8 threads={} end-usage=cq cq-level=10 \
                 target-bitrate=16000000 keyframe-max-dist=240",
                threads(),
            ),
        }
    }
}

/// The pipeline that records `sources` into `file`, its video encoded by
/// `encoder`.
pub fn description(sources: &Sources, encoder: Encoder, file: &Path) -> String {
    let video = format!("{} ! {} ! queue ! mux.", sources.video, encoder.video());
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
    fn the_gpus_av1_encoder_comes_first() {
        assert_eq!(Encoder::first(|_| true), Encoder::Gpu(GpuEncoder::Av1));
        assert_eq!(
            Encoder::first(|element| element == "vavp9lpenc"),
            Encoder::Gpu(GpuEncoder::Vp9LowPower)
        );
    }

    #[test]
    fn without_a_gpu_encoder_the_cpu_encodes_vp8() {
        assert_eq!(Encoder::first(|_| false), Encoder::Cpu);
    }

    #[test]
    fn the_gpu_converts_and_encodes_its_frames() {
        let sources = Sources::pipewire(42, None);
        let described = description(
            &sources,
            Encoder::Gpu(GpuEncoder::Av1),
            Path::new("/tmp/a.webm"),
        );

        assert!(described.contains(
            "video/x-raw ! queue ! vapostproc ! video/x-raw(memory:VAMemory),format=NV12"
        ));
        assert!(described.contains("! vaav1enc "));
        assert!(described.contains("! av1parse ! queue ! mux."));
        assert!(!described.contains("vp8enc"));
    }

    #[test]
    fn the_cpu_converts_its_frames_on_every_core() {
        let sources = Sources::pipewire(42, None);
        let described = description(&sources, Encoder::Cpu, Path::new("/tmp/a.webm"));

        assert!(described.contains("videoconvert n-threads=0 "));
        assert!(described.contains("! vp8enc "));
    }

    #[test]
    fn a_cast_without_sound_records_video_alone() {
        let sources = Sources::pipewire(42, None);
        let described = description(&sources, Encoder::Cpu, Path::new("/tmp/a.webm"));

        assert!(described.starts_with("pipewiresrc path=42 "));
        assert!(!described.contains("opusenc"));
        assert!(described.ends_with("filesink location=\"/tmp/a.webm\""));
    }

    #[test]
    fn a_cast_with_sound_records_its_sound_node_by_name() {
        let sources = Sources::pipewire(42, Some("domicile-sound-desk"));
        let described = description(&sources, Encoder::Cpu, Path::new("/tmp/a.webm"));

        assert!(described.contains("pipewiresrc target-object=\"domicile-sound-desk\""));
        assert!(described.contains("opusenc ! queue ! mux."));
    }

    #[test]
    fn a_file_name_with_quotes_stays_one_value() {
        let sources = Sources::pipewire(1, None);
        let described = description(&sources, Encoder::Cpu, Path::new("/tmp/say \"hi\".webm"));

        assert!(described.ends_with("location=\"/tmp/say \\\"hi\\\".webm\""));
    }
}
