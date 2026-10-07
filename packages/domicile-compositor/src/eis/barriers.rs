//! InputCapture's zones and pointer barriers.
//!
//! A zone is one display, in desktop logical units. A barrier is a line an
//! application places on an outer edge of the zones; the pointer reaching it
//! starts a capture. As the portal specifies, a zone's right and bottom edges
//! are its last column and row: a 1920x1080 display at 0,0 has its right
//! barrier at x=1919.

use domicile_scene::Point;

use crate::screens::Advertised;

/// One display.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Zone {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl From<&Advertised> for Zone {
    fn from(display: &Advertised) -> Zone {
        Zone {
            x: display.position.0,
            y: display.position.1,
            width: display.logical.0.unsigned_abs(),
            height: display.logical.1.unsigned_abs(),
        }
    }
}

/// Which edge of its zone a barrier is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Edge {
    Left,
    Right,
    Top,
    Bottom,
}

/// A barrier the zones accepted.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Barrier {
    pub id: u32,
    edge: Edge,
    /// The barrier's x for a left or right edge, its y for a top or bottom.
    at: i32,
    /// Its span along the edge, inclusive.
    from: i32,
    to: i32,
}

/// The barriers among `asked` (id and `x1, y1, x2, y2`) that lie on an outer
/// edge of `zones`, and the ids of those that do not.
pub fn placed(zones: &[Zone], asked: &[(u32, [i32; 4])]) -> (Vec<Barrier>, Vec<u32>) {
    let mut accepted = Vec::new();
    let mut failed = Vec::new();
    for (id, position) in asked {
        match barrier(zones, *id, *position) {
            Some(barrier) => accepted.push(barrier),
            None => failed.push(*id),
        }
    }
    (accepted, failed)
}

impl Barrier {
    /// Whether `point` has reached the barrier.
    pub fn reached(&self, point: Point) -> bool {
        let (across, along) = match self.edge {
            Edge::Left | Edge::Right => (point.x, point.y),
            Edge::Top | Edge::Bottom => (point.y, point.x),
        };
        let at = f64::from(self.at);
        let on_the_span = along >= f64::from(self.from) && along < f64::from(self.to) + 1.0;
        let there = match self.edge {
            Edge::Left | Edge::Top => across <= at,
            Edge::Right | Edge::Bottom => across >= at,
        };
        on_the_span && there
    }
}

fn barrier(zones: &[Zone], id: u32, [x1, y1, x2, y2]: [i32; 4]) -> Option<Barrier> {
    let line = if x1 == x2 && y1 != y2 {
        (true, x1, y1.min(y2), y1.max(y2))
    } else if y1 == y2 && x1 != x2 {
        (false, y1, x1.min(x2), x1.max(x2))
    } else {
        return None;
    };
    zones
        .iter()
        .find_map(|zone| on_an_edge(zones, zone, id, line))
}

/// The barrier, if `line` (vertical, at, from, to) lies on an edge of `zone`
/// that no other zone is beyond.
fn on_an_edge(
    zones: &[Zone],
    zone: &Zone,
    id: u32,
    (vertical, at, from, to): (bool, i32, i32, i32),
) -> Option<Barrier> {
    let right = zone.x + zone.width as i32 - 1;
    let bottom = zone.y + zone.height as i32 - 1;
    let (edge, span, beyond) = match vertical {
        true if at == zone.x => (Edge::Left, (zone.y, bottom), at - 1),
        true if at == right => (Edge::Right, (zone.y, bottom), at + 1),
        false if at == zone.y => (Edge::Top, (zone.x, right), at - 1),
        false if at == bottom => (Edge::Bottom, (zone.x, right), at + 1),
        _ => return None,
    };
    let within = from >= span.0 && to <= span.1;
    let outer = (from..=to).all(|along| {
        let (x, y) = if vertical {
            (beyond, along)
        } else {
            (along, beyond)
        };
        !zones.iter().any(|other| holds(other, x, y))
    });
    (within && outer).then_some(Barrier {
        id,
        edge,
        at,
        from,
        to,
    })
}

fn holds(zone: &Zone, x: i32, y: i32) -> bool {
    x >= zone.x && y >= zone.y && x < zone.x + zone.width as i32 && y < zone.y + zone.height as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two 1920x1080 displays side by side.
    const ZONES: [Zone; 2] = [
        Zone {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        },
        Zone {
            x: 1920,
            y: 0,
            width: 1920,
            height: 1080,
        },
    ];

    #[test]
    fn a_barrier_on_an_outer_edge_is_placed() {
        let (placed, failed) = placed(&ZONES, &[(1, [3839, 0, 3839, 1079]), (2, [0, 0, 1919, 0])]);

        assert_eq!(
            placed.iter().map(|barrier| barrier.id).collect::<Vec<_>>(),
            [1, 2]
        );
        assert!(failed.is_empty());
    }

    #[test]
    fn a_barrier_between_two_displays_or_off_every_edge_fails() {
        let (placed, failed) = placed(
            &ZONES,
            &[
                (1, [1919, 0, 1919, 1079]),
                (2, [100, 100, 100, 200]),
                (3, [0, 0, 10, 10]),
                (4, [0, 0, 0, 2000]),
            ],
        );

        assert!(placed.is_empty());
        assert_eq!(failed, [1, 2, 3, 4]);
    }

    #[test]
    fn the_pointer_reaches_a_barrier_at_its_edge_along_its_span() {
        let (placed, _) = placed(&ZONES, &[(1, [3839, 0, 3839, 539])]);
        let right = placed[0];

        assert!(right.reached(Point::new(3839.5, 100.0)));
        assert!(!right.reached(Point::new(3838.0, 100.0)), "short of it");
        assert!(!right.reached(Point::new(3839.5, 800.0)), "past its span");
    }
}
