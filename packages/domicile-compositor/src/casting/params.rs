//! The SPA pods a stream announces and reads: formats, buffers and metadata.

use std::io::Cursor;

use pipewire::spa;
use spa::param::format::{FormatProperties, MediaSubtype, MediaType};
use spa::param::video::VideoFormat;
use spa::param::ParamType;
use spa::pod::serialize::PodSerializer;
use spa::pod::{ChoiceValue, Object, Pod, Property, PropertyFlags, Value};
use spa::utils::{Choice, ChoiceEnum, ChoiceFlags, Fraction, Id, Rectangle, SpaTypes};
use thiserror::Error;

use crate::casting::negotiation::{shm_layout, Offered, Picked, Pixel, BUFFERS, MAX_FRAMERATE};
use crate::casting::pacing::MOST_RECTS;

/// A format the consumer picked, and the frame rate it can take.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Format {
    pub picked: Picked,
    pub framerate: u32,
}

/// Why a format pod could not be read.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum Unreadable {
    #[error("the format is not a pod")]
    NotAPod,
    #[error("the format has no {0}")]
    Missing(&'static str),
    #[error("the format names pixel format {0}, which streams do not offer")]
    Pixel(u32),
}

/// An `EnumFormat` pod for each of `offered`, for frames of `size`.
pub fn enum_formats(offered: &[Offered], size: (u32, u32)) -> Vec<Vec<u8>> {
    offered
        .iter()
        .map(|offered| match offered {
            Offered::Dmabuf { pixel, modifiers } => format(
                *pixel,
                size,
                Some(Property {
                    key: FormatProperties::VideoModifier.as_raw(),
                    flags: PropertyFlags::MANDATORY | PropertyFlags::DONT_FIXATE,
                    value: Value::Choice(ChoiceValue::Long(Choice(
                        ChoiceFlags::empty(),
                        ChoiceEnum::Enum {
                            default: modifiers[0] as i64,
                            alternatives: modifiers.iter().map(|&m| m as i64).collect(),
                        },
                    ))),
                }),
            ),
            Offered::Shm { pixel } => format(*pixel, size, None),
        })
        .collect()
}

/// A `EnumFormat` pod naming one modifier, announced after the producer fixed
/// it.
pub fn fixated(pixel: Pixel, size: (u32, u32), modifier: u64) -> Vec<u8> {
    format(
        pixel,
        size,
        Some(Property {
            key: FormatProperties::VideoModifier.as_raw(),
            flags: PropertyFlags::MANDATORY,
            value: Value::Long(modifier as i64),
        }),
    )
}

/// Reads the `Format` pod the consumer picked.
pub fn read_format(pod: &Pod) -> Result<Format, Unreadable> {
    let object = match spa::pod::deserialize::PodDeserializer::deserialize_any_from(pod.as_bytes())
    {
        Ok((_, Value::Object(object))) => object,
        _ => return Err(Unreadable::NotAPod),
    };
    let value = |key: FormatProperties| {
        object
            .properties
            .iter()
            .find(|property| property.key == key.as_raw())
            .map(|property| fixed(&property.value))
    };
    let pixel = match value(FormatProperties::VideoFormat) {
        Some(Value::Id(Id(raw))) => pixel_of(raw)?,
        _ => return Err(Unreadable::Missing("pixel format")),
    };
    let size = match value(FormatProperties::VideoSize) {
        Some(Value::Rectangle(rectangle)) => (rectangle.width, rectangle.height),
        _ => return Err(Unreadable::Missing("size")),
    };
    let modifiers = match value(FormatProperties::VideoModifier) {
        None => None,
        Some(Value::Long(modifier)) => Some(vec![modifier as u64]),
        Some(Value::Choice(ChoiceValue::Long(Choice(
            _,
            ChoiceEnum::Enum { alternatives, .. },
        )))) => Some(alternatives.iter().map(|&m| m as u64).collect()),
        Some(_) => return Err(Unreadable::Missing("modifier")),
    };
    // A consumer that names no maximum takes what is offered.
    let framerate = match value(FormatProperties::VideoMaxFramerate) {
        Some(Value::Fraction(Fraction { num, denom })) if num > 0 && denom > 0 => {
            (num / denom).clamp(1, MAX_FRAMERATE)
        }
        _ => MAX_FRAMERATE,
    };
    Ok(Format {
        picked: Picked {
            pixel,
            size,
            modifiers,
        },
        framerate,
    })
}

/// What one stream buffer holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Memory {
    /// A `memfd` of frames of this size.
    Shm { size: (u32, u32) },
    /// A dmabuf in this many planes.
    Dmabuf { planes: u32 },
}

/// The `Buffers` pod for buffers of `memory`.
pub fn buffers(memory: Memory) -> Vec<u8> {
    let int = |key: u32, value: u32| Property::new(key, Value::Int(value as i32));
    let mut properties = vec![int(spa::sys::SPA_PARAM_BUFFERS_buffers, BUFFERS)];
    match memory {
        Memory::Shm { size } => {
            let (stride, bytes) = shm_layout(size);
            properties.extend([
                int(spa::sys::SPA_PARAM_BUFFERS_blocks, 1),
                int(spa::sys::SPA_PARAM_BUFFERS_size, bytes),
                int(spa::sys::SPA_PARAM_BUFFERS_stride, stride),
                int(
                    spa::sys::SPA_PARAM_BUFFERS_dataType,
                    1 << spa::sys::SPA_DATA_MemFd,
                ),
            ]);
        }
        Memory::Dmabuf { planes } => properties.extend([
            int(spa::sys::SPA_PARAM_BUFFERS_blocks, planes),
            int(
                spa::sys::SPA_PARAM_BUFFERS_dataType,
                1 << spa::sys::SPA_DATA_DmaBuf,
            ),
        ]),
    }
    serialize(Object {
        type_: SpaTypes::ObjectParamBuffers.as_raw(),
        id: ParamType::Buffers.as_raw(),
        properties,
    })
}

/// The `Meta` pods: a header and damage on every buffer, and room for the
/// cursor and an image of `cursor_bytes` when the cursor is sent as metadata.
pub fn metas(cursor_bytes: Option<usize>) -> Vec<Vec<u8>> {
    let header = (
        spa::sys::SPA_META_Header,
        size_of::<spa::sys::spa_meta_header>(),
    );
    let damage = (
        spa::sys::SPA_META_VideoDamage,
        size_of::<spa::sys::spa_meta_region>() * MOST_RECTS,
    );
    let cursor = cursor_bytes.map(|bytes| {
        (
            spa::sys::SPA_META_Cursor,
            size_of::<spa::sys::spa_meta_cursor>() + size_of::<spa::sys::spa_meta_bitmap>() + bytes,
        )
    });
    [header, damage]
        .into_iter()
        .chain(cursor)
        .map(|(kind, size)| {
            serialize(Object {
                type_: SpaTypes::ObjectParamMeta.as_raw(),
                id: ParamType::Meta.as_raw(),
                properties: vec![
                    Property::new(spa::sys::SPA_PARAM_META_type, Value::Id(Id(kind))),
                    Property::new(spa::sys::SPA_PARAM_META_size, Value::Int(size as i32)),
                ],
            })
        })
        .collect()
}

/// An `EnumFormat` pod for raw video of `pixel` and `size`, with `modifier`.
fn format(pixel: Pixel, size: (u32, u32), modifier: Option<Property>) -> Vec<u8> {
    let mut properties = vec![
        Property::new(
            FormatProperties::MediaType.as_raw(),
            Value::Id(Id(MediaType::Video.as_raw())),
        ),
        Property::new(
            FormatProperties::MediaSubtype.as_raw(),
            Value::Id(Id(MediaSubtype::Raw.as_raw())),
        ),
        Property::new(
            FormatProperties::VideoFormat.as_raw(),
            Value::Id(Id(video_format(pixel).as_raw())),
        ),
        Property::new(
            FormatProperties::VideoSize.as_raw(),
            Value::Rectangle(Rectangle {
                width: size.0,
                height: size.1,
            }),
        ),
        // Frames come when the window draws, not on a clock.
        Property::new(
            FormatProperties::VideoFramerate.as_raw(),
            Value::Fraction(Fraction { num: 0, denom: 1 }),
        ),
        Property::new(
            FormatProperties::VideoMaxFramerate.as_raw(),
            Value::Choice(ChoiceValue::Fraction(Choice(
                ChoiceFlags::empty(),
                ChoiceEnum::Range {
                    default: Fraction {
                        num: MAX_FRAMERATE,
                        denom: 1,
                    },
                    min: Fraction { num: 1, denom: 1 },
                    max: Fraction {
                        num: MAX_FRAMERATE,
                        denom: 1,
                    },
                },
            ))),
        ),
    ];
    properties.extend(modifier);
    serialize(Object {
        type_: SpaTypes::ObjectParamFormat.as_raw(),
        id: ParamType::EnumFormat.as_raw(),
        properties,
    })
}

/// `value`, with a fixed choice unwrapped: PipeWire sends a fixated value as
/// a choice of one.
fn fixed(value: &Value) -> Value {
    match value {
        Value::Choice(ChoiceValue::Id(Choice(_, ChoiceEnum::None(id)))) => Value::Id(*id),
        Value::Choice(ChoiceValue::Long(Choice(_, ChoiceEnum::None(long)))) => Value::Long(*long),
        Value::Choice(ChoiceValue::Rectangle(Choice(_, ChoiceEnum::None(rectangle)))) => {
            Value::Rectangle(*rectangle)
        }
        Value::Choice(ChoiceValue::Fraction(Choice(_, ChoiceEnum::None(fraction)))) => {
            Value::Fraction(*fraction)
        }
        other => other.clone(),
    }
}

/// The SPA video format of `pixel`.
pub fn video_format(pixel: Pixel) -> VideoFormat {
    match pixel {
        Pixel::Bgrx => VideoFormat::BGRx,
        Pixel::Bgra => VideoFormat::BGRA,
    }
}

/// The [`Pixel`] of an SPA video format.
fn pixel_of(raw: u32) -> Result<Pixel, Unreadable> {
    match VideoFormat::from_raw(raw) {
        VideoFormat::BGRx => Ok(Pixel::Bgrx),
        VideoFormat::BGRA => Ok(Pixel::Bgra),
        _ => Err(Unreadable::Pixel(raw)),
    }
}

/// `object` as pod bytes.
fn serialize(object: Object) -> Vec<u8> {
    PodSerializer::serialize(Cursor::new(Vec::new()), &Value::Object(object))
        .expect("an object of plain values always serializes into memory")
        .0
        .into_inner()
}

#[cfg(test)]
mod tests {
    use pipewire::spa;
    use spa::param::format::FormatProperties;
    use spa::param::video::VideoFormat;
    use spa::pod::deserialize::PodDeserializer;
    use spa::pod::serialize::PodSerializer;
    use spa::pod::{ChoiceValue, Object, Pod, Property, PropertyFlags, Value};
    use spa::utils::{Choice, ChoiceEnum, ChoiceFlags, Fraction, Id, Rectangle, SpaTypes};

    use super::{buffers, enum_formats, fixated, metas, read_format, Format, Memory, Unreadable};
    use crate::casting::negotiation::{Offered, Picked, Pixel};

    const LINEAR: u64 = 0;
    const TILED: u64 = 0x0100_0000_0000_0001;

    fn object(bytes: &[u8]) -> Object {
        match PodDeserializer::deserialize_any_from(bytes) {
            Ok((_, Value::Object(object))) => object,
            other => panic!("not an object: {other:?}"),
        }
    }

    fn property(object: &Object, key: u32) -> Option<&Property> {
        object
            .properties
            .iter()
            .find(|property| property.key == key)
    }

    fn value(object: &Object, key: FormatProperties) -> &Value {
        &property(object, key.as_raw())
            .unwrap_or_else(|| panic!("no {key:?}"))
            .value
    }

    fn int(object: &Object, key: u32) -> i32 {
        match property(object, key).map(|property| &property.value) {
            Some(Value::Int(int)) => *int,
            other => panic!("key {key} is {other:?}"),
        }
    }

    fn serialized(object: Object) -> Vec<u8> {
        PodSerializer::serialize(std::io::Cursor::new(Vec::new()), &Value::Object(object))
            .expect("serializes")
            .0
            .into_inner()
    }

    /// A `Format` pod as a consumer sends it, with `modifier` as given.
    fn consumers(format: VideoFormat, modifier: Option<Value>) -> Vec<u8> {
        let mut properties = vec![
            Property::new(
                FormatProperties::MediaType.as_raw(),
                Value::Id(Id(spa::param::format::MediaType::Video.as_raw())),
            ),
            Property::new(
                FormatProperties::MediaSubtype.as_raw(),
                Value::Id(Id(spa::param::format::MediaSubtype::Raw.as_raw())),
            ),
            Property::new(
                FormatProperties::VideoFormat.as_raw(),
                Value::Id(Id(format.as_raw())),
            ),
            Property::new(
                FormatProperties::VideoSize.as_raw(),
                Value::Rectangle(Rectangle {
                    width: 320,
                    height: 240,
                }),
            ),
            Property::new(
                FormatProperties::VideoMaxFramerate.as_raw(),
                Value::Fraction(Fraction { num: 30, denom: 1 }),
            ),
        ];
        properties.extend(modifier.map(|modifier| Property {
            key: FormatProperties::VideoModifier.as_raw(),
            flags: PropertyFlags::MANDATORY,
            value: modifier,
        }));
        serialized(Object {
            type_: SpaTypes::ObjectParamFormat.as_raw(),
            id: spa::param::ParamType::Format.as_raw(),
            properties,
        })
    }

    #[test]
    fn an_offered_dmabuf_leaves_the_modifier_to_the_producer() {
        let pods = enum_formats(
            &[Offered::Dmabuf {
                pixel: Pixel::Bgrx,
                modifiers: vec![TILED, LINEAR],
            }],
            (320, 240),
        );

        let format = object(&pods[0]);
        assert_eq!(
            value(&format, FormatProperties::VideoFormat),
            &Value::Id(Id(VideoFormat::BGRx.as_raw()))
        );
        assert_eq!(
            value(&format, FormatProperties::VideoSize),
            &Value::Rectangle(Rectangle {
                width: 320,
                height: 240,
            })
        );
        let modifier = property(&format, FormatProperties::VideoModifier.as_raw())
            .expect("a dmabuf format names its modifiers");
        assert_eq!(
            modifier.flags,
            PropertyFlags::MANDATORY | PropertyFlags::DONT_FIXATE
        );
        assert_eq!(
            modifier.value,
            Value::Choice(ChoiceValue::Long(Choice(
                ChoiceFlags::empty(),
                ChoiceEnum::Enum {
                    default: TILED as i64,
                    alternatives: vec![TILED as i64, LINEAR as i64],
                },
            )))
        );
    }

    #[test]
    fn an_offered_shm_format_names_no_modifier() {
        let pods = enum_formats(&[Offered::Shm { pixel: Pixel::Bgra }], (320, 240));

        let format = object(&pods[0]);
        assert_eq!(
            value(&format, FormatProperties::VideoFormat),
            &Value::Id(Id(VideoFormat::BGRA.as_raw()))
        );
        assert_eq!(
            property(&format, FormatProperties::VideoModifier.as_raw()),
            None
        );
    }

    #[test]
    fn a_fixated_format_names_one_modifier() {
        let format = object(&fixated(Pixel::Bgrx, (320, 240), LINEAR));

        let modifier = property(&format, FormatProperties::VideoModifier.as_raw())
            .expect("the fixed modifier");
        assert_eq!(modifier.flags, PropertyFlags::MANDATORY);
        assert_eq!(modifier.value, Value::Long(LINEAR as i64));
    }

    #[test]
    fn a_consumers_format_reads_back() {
        let shm = consumers(VideoFormat::BGRA, None);
        let fixed = consumers(VideoFormat::BGRx, Some(Value::Long(LINEAR as i64)));
        let open = consumers(
            VideoFormat::BGRx,
            Some(Value::Choice(ChoiceValue::Long(Choice(
                ChoiceFlags::empty(),
                ChoiceEnum::Enum {
                    default: TILED as i64,
                    alternatives: vec![TILED as i64, LINEAR as i64],
                },
            )))),
        );
        let read = |bytes: &[u8]| read_format(Pod::from_bytes(bytes).expect("a pod"));

        assert_eq!(
            read(&shm),
            Ok(Format {
                picked: Picked {
                    pixel: Pixel::Bgra,
                    size: (320, 240),
                    modifiers: None,
                },
                framerate: 30,
            })
        );
        assert_eq!(
            read(&fixed).map(|format| format.picked.modifiers),
            Ok(Some(vec![LINEAR]))
        );
        assert_eq!(
            read(&open).map(|format| format.picked.modifiers),
            Ok(Some(vec![TILED, LINEAR]))
        );
    }

    #[test]
    fn a_pixel_format_streams_do_not_offer_is_unreadable() {
        let rgb = consumers(VideoFormat::RGB, None);

        assert_eq!(
            read_format(Pod::from_bytes(&rgb).expect("a pod")),
            Err(Unreadable::Pixel(VideoFormat::RGB.as_raw()))
        );
    }

    #[test]
    fn shm_buffers_are_memfds_sized_for_the_frame() {
        let pod = object(&buffers(Memory::Shm { size: (320, 240) }));

        assert_eq!(int(&pod, spa::sys::SPA_PARAM_BUFFERS_size), 320 * 4 * 240);
        assert_eq!(int(&pod, spa::sys::SPA_PARAM_BUFFERS_stride), 320 * 4);
        assert_eq!(int(&pod, spa::sys::SPA_PARAM_BUFFERS_blocks), 1);
        assert_eq!(
            int(&pod, spa::sys::SPA_PARAM_BUFFERS_dataType),
            1 << spa::sys::SPA_DATA_MemFd
        );
    }

    #[test]
    fn dmabuf_buffers_have_a_block_per_plane() {
        let pod = object(&buffers(Memory::Dmabuf { planes: 2 }));

        assert_eq!(int(&pod, spa::sys::SPA_PARAM_BUFFERS_blocks), 2);
        assert_eq!(
            int(&pod, spa::sys::SPA_PARAM_BUFFERS_dataType),
            1 << spa::sys::SPA_DATA_DmaBuf
        );
    }

    #[test]
    fn cursor_metadata_is_asked_for_only_when_it_is_sent() {
        let types = |pods: Vec<Vec<u8>>| -> Vec<Value> {
            pods.iter()
                .map(|pod| {
                    property(&object(pod), spa::sys::SPA_PARAM_META_type)
                        .expect("a meta type")
                        .value
                        .clone()
                })
                .collect()
        };
        let header = Value::Id(Id(spa::sys::SPA_META_Header));
        let damage = Value::Id(Id(spa::sys::SPA_META_VideoDamage));
        let cursor = Value::Id(Id(spa::sys::SPA_META_Cursor));

        assert_eq!(types(metas(None)), vec![header.clone(), damage.clone()]);
        assert_eq!(types(metas(Some(64))), vec![header, damage, cursor]);
    }

    #[test]
    fn fixed_values_wrapped_as_choices_read_back() {
        let none = |value: ChoiceValue| Value::Choice(value);
        let bytes = serialized(Object {
            type_: SpaTypes::ObjectParamFormat.as_raw(),
            id: spa::param::ParamType::Format.as_raw(),
            properties: vec![
                Property::new(
                    FormatProperties::VideoFormat.as_raw(),
                    none(ChoiceValue::Id(Choice(
                        ChoiceFlags::empty(),
                        ChoiceEnum::None(Id(VideoFormat::BGRx.as_raw())),
                    ))),
                ),
                Property::new(
                    FormatProperties::VideoSize.as_raw(),
                    none(ChoiceValue::Rectangle(Choice(
                        ChoiceFlags::empty(),
                        ChoiceEnum::None(Rectangle {
                            width: 320,
                            height: 240,
                        }),
                    ))),
                ),
                Property::new(
                    FormatProperties::VideoMaxFramerate.as_raw(),
                    none(ChoiceValue::Fraction(Choice(
                        ChoiceFlags::empty(),
                        ChoiceEnum::None(Fraction { num: 30, denom: 1 }),
                    ))),
                ),
            ],
        });

        assert_eq!(
            read_format(Pod::from_bytes(&bytes).expect("a pod")),
            Ok(Format {
                picked: Picked {
                    pixel: Pixel::Bgrx,
                    size: (320, 240),
                    modifiers: None,
                },
                framerate: 30,
            })
        );
    }
}
