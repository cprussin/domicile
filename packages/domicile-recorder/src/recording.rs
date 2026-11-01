//! A running recording pipeline.

use std::sync::Mutex;
use std::time::Duration;

use gstreamer as gst;
use gstreamer::prelude::*;

use crate::pipeline::{Encoder, FRAMES};
use crate::stamps::Stamps;

/// How long a pipeline may take to start, or to finish its file.
const WITHIN: Duration = Duration::from_secs(10);

/// A recording that is running or paused. Dropping it without
/// [`Recording::stop`] leaves the file unfinished.
pub struct Recording {
    pipeline: gst::Element,
}

/// Why a recording failed.
#[derive(Debug, thiserror::Error)]
pub enum Failed {
    #[error("GStreamer could not start: {0}")]
    Init(gst::glib::Error),
    #[error("the pipeline is not valid: {0}")]
    Pipeline(gst::glib::Error),
    #[error("the pipeline could not change state: {0}")]
    State(#[from] gst::StateChangeError),
    #[error("{element} failed: {message}")]
    Element { element: String, message: String },
    #[error("the pipeline did not {doing} within {WITHIN:?}")]
    TimedOut { doing: &'static str },
}

impl Recording {
    /// Runs the pipeline `description` until it plays.
    pub fn start(description: &str) -> Result<Recording, Failed> {
        gst::init().map_err(Failed::Init)?;
        let pipeline = gst::parse::launch(description).map_err(Failed::Pipeline)?;
        keep_stamps_increasing(&pipeline);
        let recording = Recording { pipeline };
        recording.pipeline.set_state(gst::State::Playing)?;
        recording.until("start", |message| match message.view() {
            gst::MessageView::StateChanged(changed) => {
                message.src() == Some(recording.pipeline.upcast_ref())
                    && changed.current() == gst::State::Playing
            }
            _ => false,
        })?;
        Ok(recording)
    }

    /// Stops taking frames and sound. The pipeline's running time stops
    /// with it, so the file has no gap.
    pub fn pause(&self) -> Result<(), Failed> {
        self.pipeline.set_state(gst::State::Paused)?;
        Ok(())
    }

    /// Takes frames and sound again.
    pub fn resume(&self) -> Result<(), Failed> {
        self.pipeline.set_state(gst::State::Playing)?;
        Ok(())
    }

    /// The error the pipeline posted since it was last asked, if any: a
    /// source that went away, a full disk.
    pub fn failure(&self) -> Option<Failed> {
        let bus = self.pipeline.bus().expect("a pipeline has a bus");
        bus.pop_filtered(&[gst::MessageType::Error])
            .map(|message| failed(&message))
    }

    /// Finishes the file and stops the pipeline.
    pub fn stop(self) -> Result<(), Failed> {
        // A paused live pipeline passes nothing on, the end of stream
        // included.
        self.pipeline.set_state(gst::State::Playing)?;
        self.pipeline.send_event(gst::event::Eos::new());
        let ended = self.until("finish its file", |message| {
            matches!(message.view(), gst::MessageView::Eos(_))
        });
        self.pipeline.set_state(gst::State::Null)?;
        ended
    }

    /// Waits for the bus message `wanted` for `doing`, failing on the first
    /// error the pipeline posts.
    fn until(
        &self,
        doing: &'static str,
        wanted: impl Fn(&gst::Message) -> bool,
    ) -> Result<(), Failed> {
        let bus = self.pipeline.bus().expect("a pipeline has a bus");
        let deadline = std::time::Instant::now() + WITHIN;
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            let Some(message) = bus.timed_pop(gst::ClockTime::from_nseconds(
                u64::try_from(left.as_nanos()).unwrap_or(u64::MAX),
            )) else {
                self.pipeline.set_state(gst::State::Null)?;
                return Err(Failed::TimedOut { doing });
            };
            if let gst::MessageView::Error(_) = message.view() {
                self.pipeline.set_state(gst::State::Null)?;
                return Err(failed(&message));
            }
            if wanted(&message) {
                return Ok(());
            }
        }
    }
}

/// Moves each video frame's timestamp after the last one's, on the way out
/// of [`FRAMES`]. See [`crate::stamps`].
fn keep_stamps_increasing(pipeline: &gst::Element) {
    let frames = pipeline
        .downcast_ref::<gst::Bin>()
        .and_then(|bin| bin.by_name(FRAMES))
        .expect("the pipeline has its frames element");
    let pad = frames.static_pad("src").expect("an identity has a src pad");
    let stamps = Mutex::new(Stamps::default());
    pad.add_probe(gst::PadProbeType::BUFFER, move |_, info| {
        let Some(gst::PadProbeData::Buffer(buffer)) = info.data.as_mut() else {
            unreachable!("a buffer probe sees buffers");
        };
        // An unstamped frame takes its place by the muxer's rules.
        let Some(pts) = buffer.pts() else {
            return gst::PadProbeReturn::Ok;
        };
        let next = stamps
            .lock()
            .expect("a probe does not panic holding the stamps")
            .next(pts.nseconds());
        if next != pts.nseconds() {
            eprintln!(
                "domicile-recorder: a frame was stamped {pts}, no later than the last; moved to {next} ns"
            );
            let buffer = buffer.make_mut();
            buffer.set_pts(gst::ClockTime::from_nseconds(next));
            buffer.set_dts(gst::ClockTime::from_nseconds(next));
        }
        gst::PadProbeReturn::Ok
    });
}

/// The best encoder this machine has.
pub fn encoder() -> Result<Encoder, Failed> {
    gst::init().map_err(Failed::Init)?;
    Ok(Encoder::first(|element| {
        gst::ElementFactory::find(element).is_some()
    }))
}

/// The failure an error message names.
fn failed(message: &gst::Message) -> Failed {
    match message.view() {
        gst::MessageView::Error(error) => Failed::Element {
            element: message.src().map_or_else(
                || "the pipeline".to_string(),
                |src| src.path_string().to_string(),
            ),
            message: match error.debug() {
                Some(debug) => format!("{} ({debug})", error.error()),
                None => error.error().to_string(),
            },
        },
        _ => unreachable!("only error messages are read as failures"),
    }
}
