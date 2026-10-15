//! A PipeWire consumer for `scripts/e2e-a-window-casts-to-pipewire.sh` and
//! `guard-scrolling-bubble.sh`.
//!
//!     domicile-test-cast-reader FRAMES [RRGGBB...]
//!
//! Waits for the check to link it to a cast (the check runs no session
//! manager), takes shm frames, and prints one line per frame with its size,
//! the bytes of its center pixel, and where each color is:
//!
//!     frame 320x240 80 48 32 255 #C04020 at 200,8 80x40 #339966 nowhere
//!
//! Exits zero after `FRAMES` frames.

use std::cell::{Cell, RefCell};
use std::process::ExitCode;
use std::rc::Rc;

use pipewire as pw;
use pw::properties::properties;
use pw::spa;
use spa::param::format::{FormatProperties, MediaSubtype, MediaType};
use spa::param::video::{VideoFormat, VideoInfoRaw};
use spa::pod::serialize::PodSerializer;
use spa::pod::{ChoiceValue, Object, Pod, Property, Value};
use spa::utils::{Choice, ChoiceEnum, ChoiceFlags, Fraction, Id, Rectangle, SpaTypes};

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let (Some(frames), Some(colors)) = (
        arguments
            .first()
            .and_then(|frames| frames.parse::<u32>().ok()),
        colors(arguments.get(1..).unwrap_or_default()),
    ) else {
        eprintln!("usage: domicile-test-cast-reader FRAMES [RRGGBB...]");
        return ExitCode::from(2);
    };
    match read(frames, colors) {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("domicile-test-cast-reader: {why}");
            ExitCode::FAILURE
        }
    }
}

fn read(frames: u32, colors: Vec<u32>) -> Result<(), pw::Error> {
    pw::init();
    let main_loop = pw::main_loop::MainLoopRc::new(None)?;
    let context = pw::context::ContextRc::new(&main_loop, None)?;
    let core = context.connect_rc(None)?;
    let stream = pw::stream::StreamRc::new(
        core,
        "domicile-test-cast-reader",
        properties! {
            *pw::keys::MEDIA_TYPE => "Video",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
        },
    )?;
    let format = Rc::new(RefCell::new(VideoInfoRaw::default()));
    let seen = Rc::new(Cell::new(0));
    let _listener = stream
        .add_local_listener_with_user_data(())
        .state_changed({
            let main_loop = main_loop.clone();
            move |_, _, _, state| {
                eprintln!("reader state: {state:?}");
                if let pw::stream::StreamState::Error(_) = state {
                    main_loop.quit();
                }
            }
        })
        .param_changed({
            let format = format.clone();
            move |_, _, id, pod| {
                if let (Some(pod), true) = (pod, id == spa::param::ParamType::Format.as_raw()) {
                    format.borrow_mut().parse(pod).expect("a raw video format");
                }
            }
        })
        .process({
            let format = format.clone();
            let main_loop = main_loop.clone();
            move |stream, _| {
                let Some(mut buffer) = stream.dequeue_buffer() else {
                    return;
                };
                let size = format.borrow().size();
                let datas = buffer.datas_mut();
                let stride = datas[0].chunk().stride() as usize;
                let Some(bytes) = datas[0].data() else {
                    return;
                };
                let at = (size.height as usize / 2) * stride + (size.width as usize / 2) * 4;
                let pixel = &bytes[at..at + 4];
                let found = where_each_is(
                    bytes,
                    stride,
                    (size.width as usize, size.height as usize),
                    &colors,
                );
                println!(
                    "frame {}x{} {} {} {} {}{found}",
                    size.width, size.height, pixel[0], pixel[1], pixel[2], pixel[3]
                );
                seen.set(seen.get() + 1);
                if seen.get() >= frames {
                    main_loop.quit();
                }
            }
        })
        .register()?;
    let pod = shm_formats();
    stream.connect(
        spa::utils::Direction::Input,
        None,
        pw::stream::StreamFlags::MAP_BUFFERS,
        &mut [Pod::from_bytes(&pod).expect("a whole pod")],
    )?;
    main_loop.run();
    Ok(())
}

/// One `EnumFormat` for raw shm video of any size.
fn shm_formats() -> Vec<u8> {
    let id = |value: u32| Value::Id(Id(value));
    let object = Object {
        type_: SpaTypes::ObjectParamFormat.as_raw(),
        id: spa::param::ParamType::EnumFormat.as_raw(),
        properties: vec![
            Property::new(
                FormatProperties::MediaType.as_raw(),
                id(MediaType::Video.as_raw()),
            ),
            Property::new(
                FormatProperties::MediaSubtype.as_raw(),
                id(MediaSubtype::Raw.as_raw()),
            ),
            Property::new(
                FormatProperties::VideoFormat.as_raw(),
                Value::Choice(ChoiceValue::Id(Choice(
                    ChoiceFlags::empty(),
                    ChoiceEnum::Enum {
                        default: Id(VideoFormat::BGRx.as_raw()),
                        alternatives: vec![
                            Id(VideoFormat::BGRx.as_raw()),
                            Id(VideoFormat::BGRA.as_raw()),
                        ],
                    },
                ))),
            ),
            Property::new(
                FormatProperties::VideoSize.as_raw(),
                Value::Choice(ChoiceValue::Rectangle(Choice(
                    ChoiceFlags::empty(),
                    ChoiceEnum::Range {
                        default: Rectangle {
                            width: 320,
                            height: 240,
                        },
                        min: Rectangle {
                            width: 1,
                            height: 1,
                        },
                        max: Rectangle {
                            width: 8192,
                            height: 8192,
                        },
                    },
                ))),
            ),
            Property::new(
                FormatProperties::VideoMaxFramerate.as_raw(),
                Value::Choice(ChoiceValue::Fraction(Choice(
                    ChoiceFlags::empty(),
                    ChoiceEnum::Range {
                        default: Fraction { num: 30, denom: 1 },
                        min: Fraction { num: 1, denom: 1 },
                        max: Fraction { num: 60, denom: 1 },
                    },
                ))),
            ),
        ],
    };
    PodSerializer::serialize(std::io::Cursor::new(Vec::new()), &Value::Object(object))
        .expect("serializes")
        .0
        .into_inner()
}

/// The `RRGGBB` colors after `FRAMES`, or `None` if one is not a color.
fn colors(arguments: &[String]) -> Option<Vec<u32>> {
    arguments
        .iter()
        .map(|color| {
            if color.len() == 6 && color.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                u32::from_str_radix(color, 16).ok()
            } else {
                None
            }
        })
        .collect()
}

/// How far a channel may be from a color it is matched against: a captured
/// frame's color can be a step of rounding off what was drawn.
const ROUNDING: u8 = 2;

/// Where each of `colors` is in a `BGRx` frame of `size`, rows `stride` bytes
/// apart, as ` #RRGGBB at X,Y WxH` or ` #RRGGBB nowhere` each.
fn where_each_is(bytes: &[u8], stride: usize, size: (usize, usize), colors: &[u32]) -> String {
    let wanted: Vec<[u8; 3]> = colors
        .iter()
        .map(|rgb| {
            let [_, red, green, blue] = rgb.to_be_bytes();
            [blue, green, red]
        })
        .collect();
    // Each color's box as `(left, top, right, bottom)`, inclusive.
    let mut boxes: Vec<Option<(usize, usize, usize, usize)>> = vec![None; colors.len()];
    for y in 0..size.1 {
        for x in 0..size.0 {
            let at = y * stride + x * 4;
            let pixel = &bytes[at..at + 3];
            for (color, found) in wanted.iter().zip(boxes.iter_mut()) {
                let close = pixel
                    .iter()
                    .zip(color)
                    .all(|(drawn, want)| drawn.abs_diff(*want) <= ROUNDING);
                if close {
                    *found = Some(match *found {
                        None => (x, y, x, y),
                        Some((left, top, right, bottom)) => {
                            (left.min(x), top.min(y), right.max(x), bottom.max(y))
                        }
                    });
                }
            }
        }
    }
    colors
        .iter()
        .zip(boxes)
        .map(|(rgb, found)| match found {
            None => format!(" #{rgb:06X} nowhere"),
            Some((left, top, right, bottom)) => format!(
                " #{rgb:06X} at {left},{top} {}x{}",
                right - left + 1,
                bottom - top + 1
            ),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{colors, where_each_is};

    fn given(arguments: &[&str]) -> Option<Vec<u32>> {
        colors(
            &arguments
                .iter()
                .map(|it| it.to_string())
                .collect::<Vec<_>>(),
        )
    }

    #[test]
    fn the_colors_to_find_are_written_as_css_writes_them_without_the_hash() {
        assert_eq!(given(&[]), Some(vec![]));
        assert_eq!(given(&["C04020", "339966"]), Some(vec![0xC04020, 0x339966]));
        assert_eq!(given(&["C04020", "#339966"]), None);
        assert_eq!(given(&["C0402"]), None);
    }

    /// A 3x3 frame of `BGRx` pixels, rows padded to 16 bytes.
    fn frame(pixels: [[u32; 3]; 3]) -> Vec<u8> {
        pixels
            .iter()
            .flat_map(|row| {
                row.iter()
                    .flat_map(|rgb| {
                        let [_, red, green, blue] = rgb.to_be_bytes();
                        [blue, green, red, 0xee]
                    })
                    .chain([0, 0, 0, 0])
                    .collect::<Vec<u8>>()
            })
            .collect()
    }

    #[test]
    fn a_color_is_found_as_the_box_around_every_pixel_of_it() {
        let (a, b, z) = (0xC04020, 0x339966, 0x000000);
        let bytes = frame([[z, a, z], [z, z, a], [b, b, z]]);
        assert_eq!(
            where_each_is(&bytes, 16, (3, 3), &[a, b, 0xFFFFFF]),
            " #C04020 at 1,0 2x2 #339966 at 0,2 2x1 #FFFFFF nowhere"
        );
    }

    /// A captured frame's colors can be off by a step of rounding.
    #[test]
    fn a_color_a_rounding_step_off_is_the_color() {
        let bytes = frame([[0xC14121; 3], [0; 3], [0xC54525; 3]]);
        assert_eq!(
            where_each_is(&bytes, 16, (3, 3), &[0xC04020]),
            " #C04020 at 0,0 3x1"
        );
    }
}
