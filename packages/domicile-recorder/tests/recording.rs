//! A recording of live test sources, paused partway: the file is finished
//! and leaves out the time paused.

use std::path::Path;
use std::thread::sleep;
use std::time::Duration;

use domicile_recorder::pipeline::{description, Sources};
use domicile_recorder::recording::Recording;
use gstreamer as gst;
use gstreamer::prelude::*;

fn test_sources(sound: bool) -> Sources {
    Sources {
        video: "videotestsrc is-live=true ! video/x-raw,width=64,height=48,framerate=30/1"
            .to_string(),
        sound: sound.then(|| "audiotestsrc is-live=true".to_string()),
    }
}

/// The length of the WebM at `file`, read back the way a player reads it.
fn length(file: &Path) -> Duration {
    let pipeline = gst::parse::launch(&format!(
        "filesrc location={} ! matroskademux ! fakesink",
        file.display()
    ))
    .expect("the read-back pipeline parses");
    pipeline
        .set_state(gst::State::Paused)
        .expect("the file starts to play");
    let (changed, _, _) = pipeline.state(gst::ClockTime::from_seconds(5));
    changed.expect("the file prerolls");
    let length = pipeline
        .query_duration::<gst::ClockTime>()
        .expect("a finished WebM knows its length");
    pipeline
        .set_state(gst::State::Null)
        .expect("the file closes");
    Duration::from_nanos(length.nseconds())
}

#[test]
fn a_paused_recording_leaves_the_pause_out_of_the_file() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let file = dir.path().join("recording.webm");
    let recording =
        Recording::start(&description(&test_sources(true), &file)).expect("the recording starts");

    sleep(Duration::from_secs(1));
    recording.pause().expect("the recording pauses");
    sleep(Duration::from_secs(2));
    recording.resume().expect("the recording resumes");
    sleep(Duration::from_secs(1));
    recording.stop().expect("the recording finishes");

    let length = length(&file);
    assert!(
        length > Duration::from_millis(1600) && length < Duration::from_millis(2600),
        "two seconds were recorded, and the file is {length:?} long"
    );
}

#[test]
fn a_recording_without_sound_is_video_alone() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let file = dir.path().join("recording.webm");
    let recording =
        Recording::start(&description(&test_sources(false), &file)).expect("the recording starts");

    sleep(Duration::from_millis(500));
    recording.stop().expect("the recording finishes");

    assert!(length(&file) > Duration::ZERO);
}

#[test]
fn a_pipeline_that_cannot_run_fails_to_start() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let sources = Sources {
        video: "pipewiresrc path=4294967294".to_string(),
        sound: None,
    };
    let started = Recording::start(&description(&sources, &dir.path().join("none.webm")));

    assert!(started.is_err());
}
