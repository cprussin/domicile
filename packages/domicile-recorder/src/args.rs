//! `domicile-recorder`'s command line.

use std::path::PathBuf;

use crate::pipeline::Sources;

/// What to record, and where.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Args {
    pub sources: Sources,
    pub file: PathBuf,
}

/// A command line that does not say what to record.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "{0}\n\nusage: domicile-recorder --video <PipeWire node id> [--sound <PipeWire node name>] \
     <file.webm>"
)]
pub struct Usage(String);

/// Reads `args`, without the program's name.
pub fn parse(args: impl IntoIterator<Item = String>) -> Result<Args, Usage> {
    let mut args = args.into_iter();
    let mut video = None;
    let mut sound = None;
    let mut file = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--video" => {
                let node = args
                    .next()
                    .ok_or_else(|| Usage("--video takes a node id".into()))?;
                video = Some(
                    node.parse::<u32>()
                        .map_err(|_| Usage(format!("{node:?} is not a node id")))?,
                );
            }
            "--sound" => {
                sound = Some(
                    args.next()
                        .ok_or_else(|| Usage("--sound takes a node name".into()))?,
                );
            }
            _ if file.is_none() => file = Some(PathBuf::from(arg)),
            _ => return Err(Usage(format!("{arg:?} is one file too many"))),
        }
    }
    match (video, file) {
        (Some(video), Some(file)) => Ok(Args {
            sources: Sources::pipewire(video, sound.as_deref()),
            file,
        }),
        (None, _) => Err(Usage("there is no --video node".into())),
        (_, None) => Err(Usage("there is no file to record into".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(line: &str) -> Vec<String> {
        line.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn a_video_node_and_a_file_are_a_recording() {
        assert_eq!(
            parse(words("--video 7 /tmp/a.webm")),
            Ok(Args {
                sources: Sources::pipewire(7, None),
                file: "/tmp/a.webm".into(),
            })
        );
    }

    #[test]
    fn a_sound_node_is_recorded_too() {
        assert_eq!(
            parse(words("/tmp/a.webm --sound domicile-sound-desk --video 7"))
                .map(|args| args.sources),
            Ok(Sources::pipewire(7, Some("domicile-sound-desk")))
        );
    }

    #[test]
    fn a_recording_needs_a_video_node_and_one_file() {
        assert!(parse(words("/tmp/a.webm")).is_err());
        assert!(parse(words("--video 7")).is_err());
        assert!(parse(words("--video seven /tmp/a.webm")).is_err());
        assert!(parse(words("--video 7 /tmp/a.webm /tmp/b.webm")).is_err());
    }
}
