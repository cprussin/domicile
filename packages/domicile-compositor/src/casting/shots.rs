//! One frame of the whole desk, for the Screenshot portal.
//!
//! A shot draws from the same display captures as monitor streams (see
//! [`captures`](crate::casting::captures)): every monitor, at the highest
//! density on the desk. It takes each display's newest frame, starting the
//! captures it needs and stopping them once it has its frames. See
//! `docs/PORTALS.md`.

use std::collections::HashMap;

use domicile_host::screenshot::Shot;
use domicile_protocol::{ShotArea, ShotRect, ShotWindow};
use smithay::backend::allocator::dmabuf::Dmabuf;
use smithay::backend::allocator::Buffer as _;
use smithay::backend::renderer::gles::GlesRenderer;

use smithay::utils::Transform;

use crate::buffer_transform::Sampled;
use crate::casting::captured;
use crate::casting::gpu::{FillError, Layer, Snapshot};
use crate::casting::negotiation::Pixel;
use crate::casting::pacing::Rect;
use crate::casting::paint::paint;
use crate::casting::region::{intersection, Screen};
use crate::engine::CapturedFrame;
use crate::engine_session::Child;

/// A frame of the whole desk, and where its monitors and windows are in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Desk {
    pub shot: Shot,
    /// Each monitor, by `wl_output` name, in the shot's pixels.
    pub monitors: Vec<ShotArea>,
    /// Each open window, shown or not.
    pub windows: Vec<ShotWindow>,
    /// Where the shot is on the desktop, in logical pixels.
    pub place: Rect,
}

/// Hears a shot: the desk, or why there is none. Called on the Wayland
/// thread, so it must not block.
pub type Developed = Box<dyn FnOnce(Result<Desk, String>) + Send>;

/// Hears a shot of one window, or why there is none. Called on the Wayland
/// thread, so it must not block.
pub type DevelopedWindow = Box<dyn FnOnce(Result<Shot, String>) + Send>;

/// The last frame a surface showed, which the engine still holds.
pub struct Shown {
    pub dmabuf: Dmabuf,
    /// The part of the buffer that is the surface, in buffer pixels, with
    /// `(0, 0, 0, 0)` for all of it, and the turn that makes it upright.
    pub sampled: Sampled,
    /// How many buffer pixels span one of the surface's points across and
    /// down.
    pub pixels_a_point: (f64, f64),
}

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

/// A window `size` pixels big, read back through `renderer`: each of
/// `surfaces`, bottom first, the part of it that is the surface drawn over the
/// rectangle beside it, and cut to the window.
pub fn window(
    size: (u32, u32),
    surfaces: &[(&Snapshot, Sampled, Rect)],
    renderer: &mut GlesRenderer,
) -> Result<Shot, String> {
    let whole = (0, 0, size.0 as i32, size.1 as i32);
    let layers: Vec<Layer> = surfaces
        .iter()
        .filter_map(|(snapshot, sampled, to)| Layer::placed(snapshot, *sampled, *to).cut(whole))
        .collect();
    compose(size, &layers, Some(renderer)).map_err(|why| why.to_string())
}

/// The part of `shown`'s buffer that is the surface, with the whole buffer
/// spelled out.
pub fn sampled(shown: &Shown) -> Sampled {
    shown
        .sampled
        .of((shown.dmabuf.width(), shown.dmabuf.height()))
}

/// `app_id` and its subsurfaces, nested ones too.
pub fn surfaces(app_id: &str, children: &HashMap<String, Vec<Child>>) -> Vec<String> {
    let mut found = vec![app_id.to_string()];
    let mut next = 0;
    while let Some(surface) = found.get(next) {
        let own = children.get(surface).map_or(&[][..], Vec::as_slice);
        found.extend(own.iter().map(|child| child.app_id.clone()));
        next += 1;
    }
    found
}

/// Where each surface of window `app_id` goes in a shot of it, bottom first:
/// the window over all of the shot, `size` pixels big with `pixels_a_point`
/// of them a logical pixel, and its subsurfaces, nested ones too, as
/// `children` stacks them. A subsurface that has not `drawn` a frame shows
/// nothing, nor do its own, as on screen.
pub fn stack(
    app_id: &str,
    size: (u32, u32),
    pixels_a_point: (f64, f64),
    children: &HashMap<String, Vec<Child>>,
    drawn: impl Fn(&str) -> bool,
) -> Vec<(String, Rect)> {
    let mut stacked = Vec::new();
    stack_onto(
        &mut stacked,
        app_id,
        (0.0, 0.0),
        (0, 0, size.0 as i32, size.1 as i32),
        pixels_a_point,
        children,
        &drawn,
    );
    stacked
}

/// Pushes `app_id`, at `to` in the shot and `at` in the window's logical
/// pixels, onto `stacked` between its subsurfaces under and over it.
fn stack_onto(
    stacked: &mut Vec<(String, Rect)>,
    app_id: &str,
    at: (f64, f64),
    to: Rect,
    pixels_a_point: (f64, f64),
    children: &HashMap<String, Vec<Child>>,
    drawn: &impl Fn(&str) -> bool,
) {
    let (over, under): (Vec<&Child>, Vec<&Child>) = children
        .get(app_id)
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .filter(|child| drawn(&child.app_id))
        .partition(|child| child.above);
    let child_onto = |stacked: &mut Vec<(String, Rect)>, child: &Child| {
        let at = (at.0 + child.position.0, at.1 + child.position.1);
        let (across, down) = pixels_a_point;
        let left = (at.0 * across).round() as i32;
        let top = (at.1 * down).round() as i32;
        let to = (
            left,
            top,
            (((at.0 + child.size.0) * across).round() as i32).saturating_sub(left),
            (((at.1 + child.size.1) * down).round() as i32).saturating_sub(top),
        );
        stack_onto(
            stacked,
            &child.app_id,
            at,
            to,
            pixels_a_point,
            children,
            drawn,
        );
    };
    for child in under {
        child_onto(stacked, child);
    }
    stacked.push((app_id.to_string(), to));
    for child in over {
        child_onto(stacked, child);
    }
}

/// The page in a browser window capture's `frame`, read back through
/// `renderer` when the frame is a dmabuf.
pub fn browser_window(
    frame: &CapturedFrame,
    mut renderer: Option<&mut GlesRenderer>,
) -> Result<Shot, String> {
    let (snapshot, _) =
        captured::snapshot(frame, renderer.as_deref_mut()).map_err(|why| why.to_string())?;
    let (_, _, width, height) = frame.content;
    compose(
        (width as u32, height as u32),
        &[Layer {
            snapshot: &snapshot,
            from: frame.content,
            to: (0, 0, width, height),
            transform: Transform::Normal,
        }],
        renderer,
    )
    .map_err(|why| why.to_string())
}

/// `page` with `views` drawn over it, bottom first: an Electron app's window
/// with the `WebContentsView`s it holds. Each view is a shot of its own page
/// and the rectangle the app placed it at in the window's page, in that
/// page's CSS pixels; it is drawn at its own density, which its shot's width
/// over its rectangle's says. What falls off the page is cut.
pub fn with_views(mut page: Shot, views: &[(Shot, Rect)]) -> Shot {
    for (view, (x, y, width, _)) in views {
        let scale = f64::from(view.width) / f64::from(*width);
        let left = (f64::from(*x) * scale).round() as i64;
        let top = (f64::from(*y) * scale).round() as i64;
        for row in 0..i64::from(view.height) {
            let to_row = top + row;
            if to_row < 0 || to_row >= i64::from(page.height) {
                continue;
            }
            for column in 0..i64::from(view.width) {
                let to_column = left + column;
                if to_column < 0 || to_column >= i64::from(page.width) {
                    continue;
                }
                let from = ((row * i64::from(view.width) + column) * 4) as usize;
                let to = ((to_row * i64::from(page.width) + to_column) * 4) as usize;
                over(&view.bgra[from..from + 4], &mut page.bgra[to..to + 4]);
            }
        }
    }
    page
}

/// `pixel` drawn over `under`, both premultiplied BGRA.
fn over(pixel: &[u8], under: &mut [u8]) {
    let clear = 255 - u32::from(pixel[3]);
    for (to, &from) in under.iter_mut().zip(pixel) {
        *to = (u32::from(from) + (u32::from(*to) * clear + 127) / 255) as u8;
    }
}

/// The monitors of a shot of `desk` at `scale` shot pixels per logical
/// pixel, each with what `describe` says of it by name.
pub fn monitors(
    desk: Rect,
    scale: f64,
    screens: &[Screen],
    describe: impl Fn(&str) -> Option<String>,
) -> Vec<ShotArea> {
    screens
        .iter()
        .filter_map(|screen| {
            let (x, y, width, height) = intersection(screen.desk, desk)?;
            let pixels = |logical: i32| (f64::from(logical) * scale).round() as u32;
            let (left, top) = (x - desk.0, y - desk.1);
            Some(ShotArea {
                name: screen.name.clone(),
                description: describe(&screen.name).unwrap_or_default(),
                area: ShotRect {
                    x: pixels(left),
                    y: pixels(top),
                    width: pixels(left + width) - pixels(left),
                    height: pixels(top + height) - pixels(top),
                },
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use smithay::utils::Transform;

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
            },
            Screen {
                name: "drm-2".into(),
                display: 2,
                desk: (2, -1, 1, 1),
                scale: 2.0,
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
                transform: Transform::Normal,
            },
            Layer {
                snapshot: &two,
                from: (0, 0, 2, 2),
                to: (4, 0, 2, 2),
                transform: Transform::Normal,
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

    /// A shot of `size` whose pixels' blue bytes are `blues`, row by row,
    /// opaque but where `blues` is 0.
    fn shot(size: (u32, u32), blues: &[u8]) -> Shot {
        Shot {
            width: size.0,
            height: size.1,
            bgra: blues
                .iter()
                .flat_map(|&blue| [blue, 0, 0, if blue == 0 { 0 } else { 255 }])
                .collect(),
        }
    }

    #[test]
    fn views_are_drawn_over_the_page_where_the_app_placed_them_bottom_first() {
        // A 4x3 page at 2x: 2x1.5 CSS pixels.
        let page = shot((4, 3), &[1; 12]);
        let sidebar = (shot((2, 2), &[2; 4]), (0, 0, 1, 1));
        // Over the sidebar, and off the page's right edge.
        let chat = (shot((4, 2), &[3; 8]), (1, 0, 2, 1));
        // Clear but for one pixel.
        let badge = (shot((2, 2), &[0, 0, 0, 4]), (0, 0, 1, 1));

        let drawn = with_views(page, &[sidebar, chat, badge]);

        let blue: Vec<u8> = drawn.bgra.chunks(4).map(|pixel| pixel[0]).collect();
        assert_eq!(blue, [[2, 2, 3, 3], [2, 4, 3, 3], [1, 1, 1, 1]].concat());
        assert_eq!((drawn.width, drawn.height), (4, 3));
    }

    #[test]
    fn a_windows_subsurfaces_are_stacked_where_its_frames_draw_them() {
        let child = |app_id: &str, position, size, above| Child {
            app_id: app_id.into(),
            position,
            size,
            above,
        };
        let children = HashMap::from([
            (
                "app".to_string(),
                vec![
                    child("under", (-2.0, 0.0), (4.0, 4.0), false),
                    child("unshown", (0.0, 0.0), (5.0, 5.0), true),
                    child("over", (5.0, 2.0), (10.0, 4.0), true),
                ],
            ),
            (
                "over".to_string(),
                vec![
                    child("behind", (1.0, 1.0), (2.0, 2.0), false),
                    child("past-the-edge", (12.0, 0.0), (4.0, 4.0), true),
                ],
            ),
            (
                "unshown".to_string(),
                vec![child("in-unshown", (0.0, 0.0), (1.0, 1.0), true)],
            ),
        ]);

        let stacked = stack("app", (40, 20), (2.0, 2.0), &children, |app_id| {
            app_id != "unshown"
        });

        let at = |app_id: &str, to: Rect| (app_id.to_string(), to);
        assert_eq!(
            stacked,
            [
                at("under", (-4, 0, 8, 8)),
                at("app", (0, 0, 40, 20)),
                at("behind", (12, 6, 4, 4)),
                at("over", (10, 4, 20, 8)),
                at("past-the-edge", (34, 4, 8, 8)),
            ]
        );
    }

    #[test]
    fn monitors_are_found_in_the_shots_pixels_and_described() {
        let described = |name: &str| (name == "drm-1").then(|| "Dell U3219Q".to_string());

        let monitors = monitors((0, -1, 3, 2), 2.0, &screens(), described);

        let at = |name: &str, description: &str, x, y, width, height| ShotArea {
            name: name.into(),
            description: description.into(),
            area: ShotRect {
                x,
                y,
                width,
                height,
            },
        };
        assert_eq!(
            monitors,
            [
                at("drm-1", "Dell U3219Q", 0, 2, 4, 2),
                at("drm-2", "", 4, 0, 2, 2)
            ]
        );
    }
}
