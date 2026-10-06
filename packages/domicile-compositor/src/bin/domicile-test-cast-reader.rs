//! A PipeWire consumer for `scripts/e2e-a-window-casts-to-pipewire.sh`.
//!
//!     domicile-test-cast-reader FRAMES
//!
//! Waits for the check to link it to a cast (the check runs no session
//! manager), takes shm frames, and prints one line per frame with its size and
//! the bytes of its center pixel:
//!
//!     frame 320x240 80 48 32 255
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
    let Some(frames) = arguments
        .first()
        .and_then(|frames| frames.parse::<u32>().ok())
    else {
        eprintln!("usage: domicile-test-cast-reader FRAMES");
        return ExitCode::from(2);
    };
    match read(frames) {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("domicile-test-cast-reader: {why}");
            ExitCode::FAILURE
        }
    }
}

fn read(frames: u32) -> Result<(), pw::Error> {
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
                println!(
                    "frame {}x{} {} {} {} {}",
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
