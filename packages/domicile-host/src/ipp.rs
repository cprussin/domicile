//! IPP/1.1 messages (RFC 8010), as CUPS speaks them. Small enough not to need
//! a dependency.
//!
//! A message is a header, attribute groups and, for a print job, the document.
//! [`Value::Other`] keeps every value this does not read, such as a collection
//! member, so a message always decodes whole.

/// The version every request carries.
const VERSION: [u8; 2] = [1, 1];

/// Ends the attribute groups.
const END_OF_ATTRIBUTES: u8 = 0x03;

/// The `operation-attributes-tag` group.
pub const OPERATION: u8 = 0x01;
/// The `job-attributes-tag` group.
pub const JOB: u8 = 0x02;
/// The `printer-attributes-tag` group.
pub const PRINTER: u8 = 0x04;

/// An IPP request or response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    /// The operation of a request, or the status of a response.
    pub code: u16,
    pub request_id: u32,
    pub groups: Vec<Group>,
}

/// Attributes under one delimiter tag, such as [`PRINTER`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Group {
    pub tag: u8,
    pub attributes: Vec<Attribute>,
}

/// A named attribute and its values, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attribute {
    pub name: String,
    pub values: Vec<Value>,
}

/// One attribute value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Value {
    Integer(i32),
    Boolean(bool),
    Enum(i32),
    /// `rangeOfInteger`: `lower` to `upper`, both included.
    Range {
        lower: i32,
        upper: i32,
    },
    Text(String),
    Name(String),
    Keyword(String),
    Uri(String),
    Charset(String),
    Language(String),
    MimeType(String),
    /// Any other tag, with its bytes as sent.
    Other {
        tag: u8,
        bytes: Vec<u8>,
    },
}

/// Bytes that are not an IPP message.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("not an IPP message: {0}")]
pub struct Malformed(&'static str);

impl Message {
    /// The message as sent, followed by `data`.
    pub fn encoded(&self, data: &[u8]) -> Vec<u8> {
        let mut bytes = VERSION.to_vec();
        bytes.extend(self.code.to_be_bytes());
        bytes.extend(self.request_id.to_be_bytes());
        for group in &self.groups {
            bytes.push(group.tag);
            for attribute in &group.attributes {
                for (at, value) in attribute.values.iter().enumerate() {
                    let name = if at == 0 { attribute.name.as_str() } else { "" };
                    let (tag, value) = value.encoded();
                    bytes.push(tag);
                    bytes.extend(sized(name.as_bytes()));
                    bytes.extend(sized(&value));
                }
            }
        }
        bytes.push(END_OF_ATTRIBUTES);
        bytes.extend(data);
        bytes
    }

    /// The message at the start of `bytes`, and the data after it.
    pub fn decoded(bytes: &[u8]) -> Result<(Message, &[u8]), Malformed> {
        let mut reader = Reader { bytes };
        reader.take(2)?;
        let code = u16::from_be_bytes(reader.array()?);
        let request_id = u32::from_be_bytes(reader.array()?);
        let mut groups: Vec<Group> = Vec::new();
        loop {
            let tag = reader.byte()?;
            if tag == END_OF_ATTRIBUTES {
                break;
            } else if tag < 0x10 {
                groups.push(Group {
                    tag,
                    attributes: Vec::new(),
                });
            } else {
                let group = groups
                    .last_mut()
                    .ok_or(Malformed("a value before any group"))?;
                let name = reader.sized()?;
                let value = Value::decoded(tag, reader.sized()?)?;
                if name.is_empty() {
                    group
                        .attributes
                        .last_mut()
                        .ok_or(Malformed("an additional value before any attribute"))?
                        .values
                        .push(value);
                } else {
                    let name = String::from_utf8(name.to_vec())
                        .map_err(|_| Malformed("a name that is not UTF-8"))?;
                    group.attributes.push(Attribute::new(&name, vec![value]));
                }
            }
        }
        Ok((
            Message {
                code,
                request_id,
                groups,
            },
            reader.bytes,
        ))
    }

    /// The groups tagged `tag`, in order.
    pub fn groups(&self, tag: u8) -> impl Iterator<Item = &Group> {
        self.groups.iter().filter(move |group| group.tag == tag)
    }
}

impl Group {
    /// The values of the attribute named `name`, or none.
    pub fn values(&self, name: &str) -> &[Value] {
        self.attributes
            .iter()
            .find(|attribute| attribute.name == name)
            .map_or(&[], |attribute| attribute.values.as_slice())
    }
}

impl Attribute {
    pub fn new(name: &str, values: Vec<Value>) -> Attribute {
        Attribute {
            name: name.into(),
            values,
        }
    }
}

impl Value {
    /// The value's tag and bytes.
    fn encoded(&self) -> (u8, Vec<u8>) {
        match self {
            Value::Integer(number) => (0x21, number.to_be_bytes().to_vec()),
            Value::Boolean(truth) => (0x22, vec![u8::from(*truth)]),
            Value::Enum(number) => (0x23, number.to_be_bytes().to_vec()),
            Value::Range { lower, upper } => {
                (0x33, [lower.to_be_bytes(), upper.to_be_bytes()].concat())
            }
            Value::Text(text) => (0x41, text.as_bytes().to_vec()),
            Value::Name(text) => (0x42, text.as_bytes().to_vec()),
            Value::Keyword(text) => (0x44, text.as_bytes().to_vec()),
            Value::Uri(text) => (0x45, text.as_bytes().to_vec()),
            Value::Charset(text) => (0x47, text.as_bytes().to_vec()),
            Value::Language(text) => (0x48, text.as_bytes().to_vec()),
            Value::MimeType(text) => (0x49, text.as_bytes().to_vec()),
            Value::Other { tag, bytes } => (*tag, bytes.clone()),
        }
    }

    fn decoded(tag: u8, bytes: &[u8]) -> Result<Value, Malformed> {
        let number = || {
            <[u8; 4]>::try_from(bytes)
                .map(i32::from_be_bytes)
                .map_err(|_| Malformed("an integer that is not four bytes"))
        };
        let text =
            || String::from_utf8(bytes.to_vec()).map_err(|_| Malformed("text that is not UTF-8"));
        Ok(match tag {
            0x21 => Value::Integer(number()?),
            0x22 => Value::Boolean(bytes != [0]),
            0x23 => Value::Enum(number()?),
            0x33 => {
                let bounds = <[u8; 8]>::try_from(bytes)
                    .map_err(|_| Malformed("a range that is not eight bytes"))?;
                Value::Range {
                    lower: i32::from_be_bytes([bounds[0], bounds[1], bounds[2], bounds[3]]),
                    upper: i32::from_be_bytes([bounds[4], bounds[5], bounds[6], bounds[7]]),
                }
            }
            0x41 => Value::Text(text()?),
            0x42 => Value::Name(text()?),
            0x44 => Value::Keyword(text()?),
            0x45 => Value::Uri(text()?),
            0x47 => Value::Charset(text()?),
            0x48 => Value::Language(text()?),
            0x49 => Value::MimeType(text()?),
            tag => Value::Other {
                tag,
                bytes: bytes.to_vec(),
            },
        })
    }
}

/// `bytes` after their two-byte length.
fn sized(bytes: &[u8]) -> Vec<u8> {
    let length = u16::try_from(bytes.len()).expect("an IPP value is under 64 KiB");
    [&length.to_be_bytes()[..], bytes].concat()
}

/// Reads a message front to back.
struct Reader<'a> {
    bytes: &'a [u8],
}

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], Malformed> {
        if self.bytes.len() < count {
            Err(Malformed("cut short"))
        } else {
            let (taken, rest) = self.bytes.split_at(count);
            self.bytes = rest;
            Ok(taken)
        }
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N], Malformed> {
        Ok(self.take(N)?.try_into().expect("taken to length"))
    }

    fn byte(&mut self) -> Result<u8, Malformed> {
        Ok(self.array::<1>()?[0])
    }

    /// Bytes after a two-byte length.
    fn sized(&mut self) -> Result<&'a [u8], Malformed> {
        let length = u16::from_be_bytes(self.array()?);
        self.take(usize::from(length))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get_printer_attributes() -> Message {
        Message {
            code: 0x000b,
            request_id: 7,
            groups: vec![Group {
                tag: OPERATION,
                attributes: vec![
                    Attribute::new("attributes-charset", vec![Value::Charset("utf-8".into())]),
                    Attribute::new(
                        "requested-attributes",
                        vec![
                            Value::Keyword("media-supported".into()),
                            Value::Keyword("copies-supported".into()),
                        ],
                    ),
                ],
            }],
        }
    }

    #[test]
    fn a_request_is_encoded_as_rfc_8010_lays_it_out() {
        let bytes = get_printer_attributes().encoded(b"%PDF");

        let mut expected = vec![1, 1, 0x00, 0x0b, 0, 0, 0, 7, OPERATION];
        expected.extend([0x47, 0, 18]);
        expected.extend(b"attributes-charset");
        expected.extend([0, 5]);
        expected.extend(b"utf-8");
        expected.extend([0x44, 0, 20]);
        expected.extend(b"requested-attributes");
        expected.extend([0, 15]);
        expected.extend(b"media-supported");
        // An additional value has an empty name.
        expected.extend([0x44, 0, 0, 0, 16]);
        expected.extend(b"copies-supported");
        expected.push(END_OF_ATTRIBUTES);
        expected.extend(b"%PDF");
        assert_eq!(bytes, expected);
    }

    #[test]
    fn every_value_reads_back_with_the_data_after_it() {
        let message = Message {
            code: 0x0000,
            request_id: 1,
            groups: vec![
                get_printer_attributes().groups[0].clone(),
                Group {
                    tag: PRINTER,
                    attributes: vec![
                        Attribute::new(
                            "copies-supported",
                            vec![Value::Range {
                                lower: 1,
                                upper: 99,
                            }],
                        ),
                        Attribute::new("orientation-requested-default", vec![Value::Enum(3)]),
                        Attribute::new("queued-job-count", vec![Value::Integer(-2)]),
                        Attribute::new("page-ranges-supported", vec![Value::Boolean(true)]),
                        Attribute::new("printer-info", vec![Value::Text("Office laser".into())]),
                        Attribute::new("printer-name", vec![Value::Name("office".into())]),
                        Attribute::new(
                            "printer-uri-supported",
                            vec![Value::Uri("ipp://x/".into())],
                        ),
                        Attribute::new("natural", vec![Value::Language("en".into())]),
                        Attribute::new(
                            "document-format",
                            vec![Value::MimeType("application/pdf".into())],
                        ),
                        Attribute::new(
                            "media-col-default",
                            vec![Value::Other {
                                tag: 0x34,
                                bytes: Vec::new(),
                            }],
                        ),
                    ],
                },
                Group {
                    tag: PRINTER,
                    attributes: Vec::new(),
                },
            ],
        };

        assert_eq!(
            Message::decoded(&message.encoded(b"rest")),
            Ok((message, &b"rest"[..]))
        );
    }

    #[test]
    fn a_message_cut_short_is_malformed() {
        let bytes = get_printer_attributes().encoded(&[]);

        for end in [3, 12, bytes.len() - 1] {
            assert!(Message::decoded(&bytes[..end]).is_err(), "{end}");
        }
    }

    #[test]
    fn a_group_finds_an_attributes_values_by_name() {
        let group = &get_printer_attributes().groups[0];

        assert_eq!(
            group.values("attributes-charset"),
            [Value::Charset("utf-8".into())]
        );
        assert_eq!(group.values("printer-name"), []);
    }
}
