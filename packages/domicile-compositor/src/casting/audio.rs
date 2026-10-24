//! A cast's sound: which apps' audio a cast carries, and the links that carry
//! it.
//!
//! A cast that hears anything shares a sound node, a PipeWire
//! `Audio/Source/Virtual` named by its source ([`Heard::node_name`]). The
//! PipeWire thread links the output ports of the audio streams it hears into
//! it. A window's cast hears its client's process and that process's
//! children, by the process of each stream's PipeWire client; a monitor's or a
//! region's hears every app. Apps keep playing where they were: the links are
//! extra.
//!
//! The engine reads a page capture's sound from the node, by the name the
//! portal's stream `id` gives it. The capture restores the pick in a portal
//! session of its own, after the picker's session ends, so a node outlives its
//! last cast and consumer by [`GRACE`] ([`Holders`]). Other portal consumers
//! are not told of it.
//!
//! The rules are here, apart from PipeWire, so they are tested without a
//! daemon. See [`super::producer`] for the nodes and links.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use crate::casting::StreamId;

/// Whose sound a cast carries.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Heard {
    /// Every app's, for a monitor or a region.
    Everything,
    /// Window `id`'s client process's, and its children's.
    Window { id: String, process: u32 },
}

impl Heard {
    /// The sound node's name: `domicile-sound-desk`, or
    /// `domicile-sound-window-<id>` with the portal stream's `id`, each byte
    /// outside `[A-Za-z0-9._-]` an `_`.
    pub fn node_name(&self) -> String {
        match self {
            Self::Everything => "domicile-sound-desk".to_string(),
            Self::Window { id, .. } => {
                let id: String = id
                    .chars()
                    .map(|c| {
                        if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                            c
                        } else {
                            '_'
                        }
                    })
                    .collect();
                format!("domicile-sound-window-{id}")
            }
        }
    }
}

/// How long a sound node outlives its last cast and consumer.
pub const GRACE: Duration = Duration::from_secs(5);

/// What keeps a sound node: the casts that hear it and the consumers linked
/// to it.
#[derive(Default)]
pub struct Holders {
    casts: HashSet<StreamId>,
    consumers: HashSet<u32>,
    /// When the last holder let go.
    idle_since: Option<Instant>,
}

impl Holders {
    pub fn cast_started(&mut self, cast: StreamId) {
        self.casts.insert(cast);
        self.idle_since = None;
    }

    pub fn cast_ended(&mut self, cast: StreamId, now: Instant) {
        self.casts.remove(&cast);
        self.let_go(now);
    }

    /// Link `link` takes the node's sound.
    pub fn consumer_linked(&mut self, link: u32) {
        self.consumers.insert(link);
        self.idle_since = None;
    }

    /// Returns whether `link` was a consumer's.
    pub fn consumer_unlinked(&mut self, link: u32, now: Instant) -> bool {
        let was = self.consumers.remove(&link);
        self.let_go(now);
        was
    }

    /// Whether the node has gone [`GRACE`] with nothing holding it.
    pub fn expired(&self, now: Instant) -> bool {
        self.idle_since
            .is_some_and(|since| now.duration_since(since) >= GRACE)
    }

    fn let_go(&mut self, now: Instant) {
        if self.casts.is_empty() && self.consumers.is_empty() && self.idle_since.is_none() {
            self.idle_since = Some(now);
        }
    }
}

/// The audio node's channels a port of `channel` feeds. Sound in other
/// layouts folds down to stereo; the low-frequency channel is left out.
pub fn feeds(channel: &str) -> &'static [&'static str] {
    match channel {
        "FL" | "RL" | "SL" | "FLC" | "RLC" => &["FL"],
        "FR" | "RR" | "SR" | "FRC" | "RRC" => &["FR"],
        "MONO" | "FC" | "RC" => &["FL", "FR"],
        _ => &[],
    }
}

/// A node in the PipeWire graph, as far as casts care.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Node {
    /// Whether it is an app's audio stream (`Stream/Output/Audio`).
    pub plays: bool,
    /// Its PipeWire client.
    pub client: Option<u32>,
}

/// A port in the PipeWire graph.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Port {
    pub node: u32,
    pub output: bool,
    pub channel: String,
}

/// The nodes and ports casts may link, by global id.
#[derive(Default)]
pub struct Graph {
    pub nodes: HashMap<u32, Node>,
    pub ports: HashMap<u32, Port>,
    /// Each client's process: the `application.process.id` it reports, as
    /// PipeWire's PulseAudio server reports its own clients', or else the
    /// socket's peer.
    pub clients: HashMap<u32, u32>,
}

impl Graph {
    /// The links, as (output port, input port), from what `heard` hears into
    /// the audio node `node`. `parent` gives a process's parent.
    pub fn wanted(
        &self,
        node: u32,
        heard: &Heard,
        parent: impl Fn(u32) -> Option<u32>,
    ) -> HashSet<(u32, u32)> {
        let inputs: HashMap<&str, u32> = self
            .ports
            .iter()
            .filter(|(_, port)| port.node == node && !port.output)
            .map(|(id, port)| (port.channel.as_str(), *id))
            .collect();
        let heard_nodes: HashSet<u32> = self
            .nodes
            .iter()
            .filter(|(_, candidate)| {
                candidate.plays
                    && match heard {
                        Heard::Everything => true,
                        Heard::Window { process: root, .. } => candidate
                            .client
                            .and_then(|client| self.clients.get(&client))
                            .is_some_and(|process| descends(*process, *root, &parent)),
                    }
            })
            .map(|(id, _)| *id)
            .collect();
        self.ports
            .iter()
            .filter(|(_, port)| port.output && heard_nodes.contains(&port.node))
            .flat_map(|(id, port)| {
                feeds(&port.channel)
                    .iter()
                    .filter_map(|channel| inputs.get(channel))
                    .map(move |input| (*id, *input))
            })
            .collect()
    }
}

/// Whether `process` is `root` or one of its descendants.
fn descends(process: u32, root: u32, parent: impl Fn(u32) -> Option<u32>) -> bool {
    let mut at = process;
    // Bounded: a pid read while processes come and go could loop.
    for _ in 0..64 {
        if at == root {
            return true;
        }
        match parent(at) {
            Some(up) if up != at && up > 1 => at = up,
            _ => return false,
        }
    }
    false
}

/// A process's parent, from `/proc`.
pub fn parent(process: u32) -> Option<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{process}/stat")).ok()?;
    parent_in_stat(&stat)
}

/// The parent pid in a `/proc/<pid>/stat` line. The command, in parentheses,
/// may hold spaces and parentheses, so fields count from the last `)`.
fn parent_in_stat(stat: &str) -> Option<u32> {
    let (_, rest) = stat.rsplit_once(')')?;
    rest.split_whitespace().nth(1)?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIX: u32 = 100;

    fn graph() -> Graph {
        let mut graph = Graph::default();
        graph.ports.insert(
            101,
            Port {
                node: MIX,
                output: false,
                channel: "FL".into(),
            },
        );
        graph.ports.insert(
            102,
            Port {
                node: MIX,
                output: false,
                channel: "FR".into(),
            },
        );
        // The audio node's own capture ports are never linked into it.
        graph.ports.insert(
            103,
            Port {
                node: MIX,
                output: true,
                channel: "FL".into(),
            },
        );
        graph
    }

    fn app(graph: &mut Graph, node: u32, plays: bool, process: u32, channels: &[&str]) {
        graph.nodes.insert(
            node,
            Node {
                plays,
                client: Some(node + 1000),
            },
        );
        graph.clients.insert(node + 1000, process);
        for (n, channel) in channels.iter().enumerate() {
            graph.ports.insert(
                node * 10 + n as u32,
                Port {
                    node,
                    output: true,
                    channel: channel.to_string(),
                },
            );
        }
    }

    fn window(process: u32) -> Heard {
        Heard::Window {
            id: "app-1".into(),
            process,
        }
    }

    /// 7 is 5's child; 9 is no kin.
    fn family(process: u32) -> Option<u32> {
        match process {
            7 => Some(5),
            5 | 9 => Some(1),
            _ => None,
        }
    }

    #[test]
    fn a_window_hears_its_process_and_children_alone() {
        let mut graph = graph();
        app(&mut graph, 5, true, 5, &["FL", "FR"]);
        app(&mut graph, 7, true, 7, &["MONO"]);
        app(&mut graph, 9, true, 9, &["FL", "FR"]);

        assert_eq!(
            graph.wanted(MIX, &window(5), family),
            HashSet::from([(50, 101), (51, 102), (70, 101), (70, 102)])
        );
    }

    #[test]
    fn a_monitor_hears_every_app_but_no_recorder() {
        let mut graph = graph();
        app(&mut graph, 5, true, 5, &["FL"]);
        app(&mut graph, 9, true, 9, &["FR"]);
        app(&mut graph, 8, false, 5, &["FL"]);

        assert_eq!(
            graph.wanted(MIX, &Heard::Everything, family),
            HashSet::from([(50, 101), (90, 102)])
        );
    }

    #[test]
    fn nothing_is_linked_before_the_audio_node_has_ports() {
        let mut graph = Graph::default();
        app(&mut graph, 5, true, 5, &["FL"]);

        assert!(graph.wanted(MIX, &Heard::Everything, family).is_empty());
    }

    #[test]
    fn surround_folds_to_stereo_without_the_low_frequencies() {
        assert_eq!(feeds("RL"), ["FL"]);
        assert_eq!(feeds("SR"), ["FR"]);
        assert_eq!(feeds("FC"), ["FL", "FR"]);
        assert!(feeds("LFE").is_empty());
    }

    #[test]
    fn a_parent_is_read_past_a_command_with_parentheses() {
        assert_eq!(parent_in_stat("42 (a (b) c) S 7 42 42 0"), Some(7));
        assert_eq!(parent_in_stat("garbage"), None);
        assert!(parent(std::process::id()).is_some());
    }

    #[test]
    fn a_loop_of_parents_is_no_kin() {
        assert!(!descends(3, 5, |process| Some(if process == 3 {
            4
        } else {
            3
        })));
    }

    #[test]
    fn a_node_is_named_by_its_source() {
        assert_eq!(Heard::Everything.node_name(), "domicile-sound-desk");
        assert_eq!(
            Heard::Window {
                id: "app 3/x".into(),
                process: 1
            }
            .node_name(),
            "domicile-sound-window-app_3_x"
        );
    }

    #[test]
    fn a_node_outlives_its_last_holder_by_the_grace() {
        let start = Instant::now();
        let mut holders = Holders::default();
        holders.cast_started(StreamId(1));
        holders.consumer_linked(40);

        holders.cast_ended(StreamId(1), start);
        assert!(!holders.expired(start + GRACE), "a consumer still holds it");
        assert!(holders.consumer_unlinked(40, start));
        assert!(!holders.expired(start + GRACE / 2));
        assert!(holders.expired(start + GRACE));
    }

    #[test]
    fn a_cast_starting_in_the_grace_keeps_the_node() {
        let start = Instant::now();
        let mut holders = Holders::default();
        holders.cast_started(StreamId(1));
        holders.cast_ended(StreamId(1), start);

        holders.cast_started(StreamId(2));

        assert!(!holders.expired(start + GRACE * 2));
        assert!(!holders.consumer_unlinked(41, start), "not a consumer's");
    }
}
