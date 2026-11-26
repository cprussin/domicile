//! D-Bus bodies as JSON text, read against their signature.
//!
//! A body is a JSON array with one element per complete type in its
//! signature:
//!
//! | D-Bus | JSON |
//! |---|---|
//! | `y n q i u x t` | an integer in the type's range |
//! | `d` | a number |
//! | `b` | a boolean |
//! | `s o g` | a string; `o` must be an object path and `g` a signature |
//! | `v` | `{"signature": "<one type>", "value": <that type>}` |
//! | `a{KV}` | an object; keys that are not strings are their JSON text |
//! | `aT` | an array |
//! | `(…)` | an array of the fields |
//! | `h` | refused when read; written as `null`, since a page cannot hold one |
//!
//! The SDK's `system` module writes and reads these. See
//! `docs/SHELL-SYSTEM-ACCESS.md`.

use serde_json::{Map, Number, Value as Json};
use zbus::{Array, Dict, ObjectPath, Signature, Str, Structure, Variant};

/// JSON text that does not fit its signature.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("a D-Bus body that does not fit its signature: {0}")]
pub struct NotABody(String);

/// The values `body` holds, one per complete type in `signature`.
pub fn read(signature: &str, body: &str) -> Result<Vec<Variant<'static>>, NotABody> {
    let types = types(signature)?;
    let Json::Array(elements) =
        serde_json::from_str(body).map_err(|err| NotABody(err.to_string()))?
    else {
        return Err(NotABody("the body is not a JSON array".into()));
    };
    if elements.len() != types.len() {
        return Err(NotABody(format!(
            "{} values for {} types",
            elements.len(),
            types.len()
        )));
    }
    types
        .iter()
        .zip(&elements)
        .map(|(of, json)| value(of, json))
        .collect()
}

/// `values` as a body's JSON text.
pub fn written(values: &[Variant<'_>]) -> String {
    Json::Array(values.iter().map(json).collect()).to_string()
}

/// The complete types in `signature`, in order.
fn types(signature: &str) -> Result<Vec<Signature>, NotABody> {
    if signature.is_empty() {
        return Ok(Vec::new());
    }
    match format!("({signature})").parse::<Signature>() {
        Ok(Signature::Structure(fields)) => Ok(fields.iter().cloned().collect()),
        _ => Err(NotABody(format!("{signature} is not a body signature"))),
    }
}

fn value(of: &Signature, json: &Json) -> Result<Variant<'static>, NotABody> {
    let wrong = || NotABody(format!("{json} is not a {of}"));
    Ok(match of {
        Signature::U8 => Variant::U8(integer(json).ok_or_else(wrong)?),
        Signature::I16 => Variant::I16(integer(json).ok_or_else(wrong)?),
        Signature::U16 => Variant::U16(integer(json).ok_or_else(wrong)?),
        Signature::I32 => Variant::I32(integer(json).ok_or_else(wrong)?),
        Signature::U32 => Variant::U32(integer(json).ok_or_else(wrong)?),
        Signature::I64 => Variant::I64(json.as_i64().ok_or_else(wrong)?),
        Signature::U64 => Variant::U64(json.as_u64().ok_or_else(wrong)?),
        Signature::F64 => Variant::F64(json.as_f64().ok_or_else(wrong)?),
        Signature::Bool => Variant::Bool(json.as_bool().ok_or_else(wrong)?),
        Signature::Str => Variant::Str(Str::from(json.as_str().ok_or_else(wrong)?.to_string())),
        Signature::ObjectPath => Variant::ObjectPath(
            ObjectPath::try_from(json.as_str().ok_or_else(wrong)?.to_string())
                .map_err(|_| wrong())?,
        ),
        Signature::Signature => Variant::Signature(
            json.as_str()
                .ok_or_else(wrong)?
                .parse()
                .map_err(|_| wrong())?,
        ),
        Signature::Variant => {
            let inner = json.as_object().ok_or_else(wrong)?;
            let of: Signature = inner
                .get("signature")
                .and_then(Json::as_str)
                .ok_or_else(wrong)?
                .parse()
                .map_err(|_| wrong())?;
            let held = inner.get("value").ok_or_else(wrong)?;
            Variant::Variant(Box::new(value(&of, held)?))
        }
        Signature::Array(element) => {
            let mut array = Array::new(element);
            for item in json.as_array().ok_or_else(wrong)? {
                array
                    .append(value(element, item)?)
                    .map_err(|err| NotABody(err.to_string()))?;
            }
            Variant::Array(array)
        }
        Signature::Dict { key, value: held } => {
            let mut dict = Dict::new(key, held);
            for (name, item) in json.as_object().ok_or_else(wrong)? {
                dict.append(self::key(key, name)?, value(held, item)?)
                    .map_err(|err| NotABody(err.to_string()))?;
            }
            Variant::Dict(dict)
        }
        Signature::Structure(fields) => {
            let items = json.as_array().ok_or_else(wrong)?;
            if items.len() != fields.len() {
                return Err(wrong());
            }
            fields
                .iter()
                .zip(items)
                .try_fold(Structure::builder(), |built, (field, item)| {
                    Ok::<_, NotABody>(built.append_field(value(field, item)?))
                })?
                .build()
                .map(Variant::Structure)
                .map_err(|err| NotABody(err.to_string()))?
        }
        Signature::Unit | Signature::Fd => return Err(wrong()),
    })
}

/// A dictionary key, from the JSON object key that names it.
fn key(of: &Signature, name: &str) -> Result<Variant<'static>, NotABody> {
    match of {
        Signature::Str | Signature::ObjectPath | Signature::Signature => {
            value(of, &Json::String(name.to_string()))
        }
        _ => value(
            of,
            &serde_json::from_str(name).map_err(|_| NotABody(format!("{name} is not a {of}")))?,
        ),
    }
}

/// A JSON integer that fits `T`.
fn integer<T: TryFrom<i64>>(json: &Json) -> Option<T> {
    json.as_i64().and_then(|whole| T::try_from(whole).ok())
}

fn json(value: &Variant<'_>) -> Json {
    match value {
        Variant::U8(number) => Json::from(*number),
        Variant::Bool(truth) => Json::from(*truth),
        Variant::I16(number) => Json::from(*number),
        Variant::U16(number) => Json::from(*number),
        Variant::I32(number) => Json::from(*number),
        Variant::U32(number) => Json::from(*number),
        Variant::I64(number) => Json::from(*number),
        Variant::U64(number) => Json::from(*number),
        // NaN and the infinities have no JSON; D-Bus services do not send them.
        Variant::F64(number) => Number::from_f64(*number).map_or(Json::Null, Json::Number),
        Variant::Str(text) => Json::from(text.as_str()),
        Variant::Signature(signature) => Json::from(signature.to_string()),
        Variant::ObjectPath(path) => Json::from(path.as_str()),
        Variant::Variant(held) => Json::Object(Map::from_iter([
            (
                "signature".to_string(),
                Json::from(held.value_signature().to_string()),
            ),
            ("value".to_string(), json(held)),
        ])),
        Variant::Array(array) => Json::Array(array.inner().iter().map(json).collect()),
        Variant::Dict(dict) => Json::Object(
            dict.iter()
                .map(|(key, held)| (key_text(key), json(held)))
                .collect(),
        ),
        Variant::Structure(structure) => Json::Array(structure.fields().iter().map(json).collect()),
        Variant::Fd(_) => Json::Null,
    }
}

/// A dictionary key as a JSON object key: a string as is, anything else as
/// its JSON text.
fn key_text(key: &Variant<'_>) -> String {
    match json(key) {
        Json::String(text) => text,
        other => other.to_string(),
    }
}
