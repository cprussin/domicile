//! A stream's life, from PipeWire's states and its node's links.
//!
//! - The stream is ready once PipeWire gives it a node: the caller hands that
//!   id to the consumer.
//! - Frames are filled only while PipeWire says it is streaming.
//! - The consumer has gone when the last link to the node goes. A paused
//!   consumer keeps its link.
//! - A stream ends once. Everything after that is ignored.

/// A PipeWire stream state, without its error text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Unconnected,
    Connecting,
    Paused,
    Streaming,
}

/// Why a stream ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Ended {
    /// The last consumer unlinked from the node.
    ConsumerLeft,
    /// The window closed.
    SourceGone,
    /// The caller stopped it.
    Stopped,
    /// PipeWire reported an error, or dropped the stream.
    Failed(String),
}

/// What the stream's owner must do.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    /// Tell the caller the stream's node.
    Ready { node: u32 },
    /// Start (`true`) or stop filling frames.
    Fill(bool),
    /// Tell the caller the stream ended, and tear it down.
    End(Ended),
}

/// One stream's life so far.
#[derive(Debug, Default)]
pub struct Lifecycle {
    ready: bool,
    streaming: bool,
    links: u32,
    ended: bool,
}

impl Lifecycle {
    /// PipeWire moved the stream to `phase`. `node` is its node id, valid from
    /// `Paused` on.
    pub fn moved(&mut self, phase: Phase, node: u32) -> Vec<Step> {
        if self.ended {
            return vec![];
        }
        match phase {
            Phase::Connecting => vec![],
            Phase::Unconnected if self.ready => self.end(Ended::Failed(
                "PipeWire disconnected the stream".to_string(),
            )),
            Phase::Unconnected => vec![],
            Phase::Paused if !self.ready => {
                self.ready = true;
                vec![Step::Ready { node }]
            }
            Phase::Paused => self.fill(false),
            Phase::Streaming => self.fill(true),
        }
    }

    /// PipeWire reported an error.
    pub fn failed(&mut self, why: String) -> Vec<Step> {
        self.end(Ended::Failed(why))
    }

    /// A link to the stream's node appeared.
    pub fn linked(&mut self) {
        self.links += 1;
    }

    /// A link to the stream's node went.
    pub fn unlinked(&mut self) -> Vec<Step> {
        self.links -= 1;
        if self.links == 0 {
            self.end(Ended::ConsumerLeft)
        } else {
            vec![]
        }
    }

    /// The caller ends the stream for `why`.
    pub fn end(&mut self, why: Ended) -> Vec<Step> {
        if self.ended {
            return vec![];
        }
        let mut steps = self.fill(false);
        self.ended = true;
        steps.push(Step::End(why));
        steps
    }

    /// The step that starts or stops filling, if that changes anything.
    fn fill(&mut self, streaming: bool) -> Vec<Step> {
        if self.streaming == streaming {
            vec![]
        } else {
            self.streaming = streaming;
            vec![Step::Fill(streaming)]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Ended, Lifecycle, Phase, Step};

    /// A stream with a consumer linked and streaming.
    fn streaming() -> Lifecycle {
        let mut life = Lifecycle::default();
        life.moved(Phase::Connecting, 0);
        life.moved(Phase::Paused, 42);
        life.linked();
        life.moved(Phase::Streaming, 42);
        life
    }

    #[test]
    fn a_stream_is_ready_once_it_has_a_node() {
        let mut life = Lifecycle::default();

        assert_eq!(life.moved(Phase::Connecting, 0), vec![]);
        assert_eq!(
            life.moved(Phase::Paused, 42),
            vec![Step::Ready { node: 42 }]
        );
        // A consumer pausing does not make the stream ready again.
        life.moved(Phase::Streaming, 42);
        assert_eq!(life.moved(Phase::Paused, 42), vec![Step::Fill(false)]);
    }

    #[test]
    fn frames_are_filled_only_while_streaming() {
        let mut life = Lifecycle::default();
        life.moved(Phase::Paused, 42);

        assert_eq!(life.moved(Phase::Streaming, 42), vec![Step::Fill(true)]);
        assert_eq!(life.moved(Phase::Paused, 42), vec![Step::Fill(false)]);
    }

    #[test]
    fn the_consumer_has_gone_when_its_last_link_goes() {
        let mut life = streaming();
        life.linked();

        assert_eq!(life.unlinked(), vec![]);
        assert_eq!(
            life.unlinked(),
            vec![Step::Fill(false), Step::End(Ended::ConsumerLeft)]
        );
    }

    #[test]
    fn an_error_ends_the_stream() {
        let mut life = streaming();

        assert_eq!(
            life.failed("no memory".to_string()),
            vec![
                Step::Fill(false),
                Step::End(Ended::Failed("no memory".to_string()))
            ]
        );
    }

    #[test]
    fn losing_the_connection_after_ready_ends_the_stream() {
        let mut life = Lifecycle::default();
        life.moved(Phase::Paused, 42);

        assert_eq!(
            life.moved(Phase::Unconnected, 42),
            vec![Step::End(Ended::Failed(
                "PipeWire disconnected the stream".to_string()
            ))]
        );
    }

    #[test]
    fn a_stream_ends_once() {
        let mut life = streaming();

        assert_eq!(
            life.end(Ended::SourceGone),
            vec![Step::Fill(false), Step::End(Ended::SourceGone)]
        );
        assert_eq!(life.end(Ended::Stopped), vec![]);
        assert_eq!(life.unlinked(), vec![]);
        assert_eq!(life.moved(Phase::Streaming, 42), vec![]);
    }
}
