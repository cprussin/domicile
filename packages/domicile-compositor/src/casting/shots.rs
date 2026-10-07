//! One frame of the whole desk, for the Screenshot portal.
//!
//! A shot draws from the same display captures as monitor streams (see
//! [`captures`](crate::casting::captures)): every monitor, at the highest
//! density on the desk. It takes each display's newest frame, starting the
//! captures it needs and stopping them once it has its frames. See
//! `docs/architecture/PORTALS.md`.

use domicile_host::screenshot::Shot;
use domicile_protocol::{ShotArea, ShotRect};
use smithay::backend::renderer::gles::GlesRenderer;

use crate::casting::gpu::{FillError, Layer};
use crate::casting::negotiation::Pixel;
use crate::casting::pacing::Rect;
use crate::casting::paint::paint;
use crate::casting::region::{intersection, Screen};

/// A frame of the whole desk, and where its monitors and windows are in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Desk {
    pub shot: Shot,
    /// Each monitor, by `wl_output` name, in the shot's pixels.
    pub monitors: Vec<ShotArea>,
    /// Each window on the desk, by title, in the shot's pixels.
    pub windows: Vec<ShotArea>,
}

/// An open window, as a shot names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Window {
    pub title: String,
    /// Where it is on the desktop, in logical pixels.
    pub desk: Rect,
}

/// Hears a shot: the desk, or why there is none. Called on the Wayland
/// thread, so it must not block.
pub type Developed = Box<dyn FnOnce(Result<Desk, String>) + Send>;

/// The rectangle every monitor fits in, in logical pixels. `None` without
/// monitors.
pub fn desk_of(screens: &[Screen]) -> Option<Rect> {
    let (left, top, right, bottom) = screens
        .iter()
        .map(|screen| {
            let (x, y, width, height) = screen.desk;
            (x, y, x + width, y + height)
        })
        .reduce(|a, b| (a.0.min(b.0), a.1.min(b.1), a.2.max(b.2), a.3.max(b.3)))?;
    Some((left, top, right - left, bottom - top))
}

/// A shot `size` pixels big of `layers`. Off every layer is transparent.
pub fn compose(
    size: (u32, u32),
    layers: &[Layer],
    renderer: Option<&mut GlesRenderer>,
) -> Result<Shot, FillError> {
    let stride = size.0 as usize * 4;
    let mut bgra = vec![0; stride * size.1 as usize];
    paint(layers, &mut bgra, stride, Pixel::Bgra, renderer)?;
    Ok(Shot {
        width: size.0,
        height: size.1,
        bgra,
    })
}

/// The monitors and windows of a shot of `desk` at `scale` shot pixels per
/// logical pixel. A window is clipped to the desk, and left out when off it.
pub fn areas(
    desk: Rect,
    scale: f64,
    screens: &[Screen],
    windows: &[Window],
) -> (Vec<ShotArea>, Vec<ShotArea>) {
    let place = |name: &str, rect: Rect| {
        let (x, y, width, height) = intersection(rect, desk)?;
        let pixels = |logical: i32| (f64::from(logical) * scale).round() as u32;
        let (left, top) = (x - desk.0, y - desk.1);
        Some(ShotArea {
            name: name.to_string(),
            area: ShotRect {
                x: pixels(left),
                y: pixels(top),
                width: pixels(left + width) - pixels(left),
                height: pixels(top + height) - pixels(top),
            },
        })
    };
    (
        screens
            .iter()
            .filter_map(|screen| place(&screen.name, screen.desk))
            .collect(),
        windows
            .iter()
            .filter_map(|window| place(&window.title, window.desk))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::casting::gpu::Snapshot;

    /// A 2x1 monitor at 1x, and a 1x1 one at 2x to its right.
    fn screens() -> [Screen; 2] {
        [
            Screen {
                name: "drm-1".into(),
                display: 1,
                desk: (0, 0, 2, 1),
                scale: 1.0,
                upright: true,
            },
            Screen {
                name: "drm-2".into(),
                display: 2,
                desk: (2, -1, 1, 1),
                scale: 2.0,
                upright: true,
            },
        ]
    }

    /// One pixel a byte: `bytes` names each pixel's blue byte.
    fn pixels(bytes: &[u8], size: (u32, u32)) -> Snapshot {
        Snapshot::Pixels {
            bytes: bytes.iter().flat_map(|&byte| [byte, 0, 0, 0]).collect(),
            stride: size.0 as usize * 4,
            alpha: false,
            size,
        }
    }

    #[test]
    fn the_desk_spans_every_monitor() {
        assert_eq!(desk_of(&screens()), Some((0, -1, 3, 2)));
        assert_eq!(desk_of(&[]), None);
    }

    #[test]
    fn a_lower_density_monitor_is_scaled_up_beside_a_higher_one() {
        let (one, two) = (pixels(&[1, 2], (2, 1)), pixels(&[3, 4, 5, 6], (2, 2)));
        let layers = [
            Layer {
                snapshot: &one,
                from: (0, 0, 2, 1),
                to: (0, 2, 4, 2),
            },
            Layer {
                snapshot: &two,
                from: (0, 0, 2, 2),
                to: (4, 0, 2, 2),
            },
        ];

        let shot = compose((6, 4), &layers, None).expect("composed on the CPU");

        let blue: Vec<u8> = shot.bgra.chunks(4).map(|pixel| pixel[0]).collect();
        assert_eq!(
            blue,
            [
                [0, 0, 0, 0, 3, 4],
                [0, 0, 0, 0, 5, 6],
                [1, 1, 2, 2, 0, 0],
                [1, 1, 2, 2, 0, 0],
            ]
            .concat()
        );
        assert_eq!((shot.width, shot.height), (6, 4));
        assert_eq!(shot.bgra[3], 0, "off every monitor is transparent");
        assert_eq!(shot.bgra[4 * 4 + 3], 255, "a frame without alpha is opaque");
    }

    #[test]
    fn monitors_and_windows_are_found_in_the_shots_pixels() {
        let windows = [
            Window {
                title: "Half off".into(),
                desk: (-1, 0, 2, 1),
            },
            Window {
                title: "Gone".into(),
                desk: (10, 10, 1, 1),
            },
        ];

        let (monitors, windows) = areas((0, -1, 3, 2), 2.0, &screens(), &windows);

        let at = |name: &str, x, y, width, height| ShotArea {
            name: name.into(),
            area: ShotRect {
                x,
                y,
                width,
                height,
            },
        };
        assert_eq!(monitors, [at("drm-1", 0, 2, 4, 2), at("drm-2", 4, 0, 2, 2)]);
        assert_eq!(windows, [at("Half off", 0, 2, 2, 2)]);
    }
}
