//! D-Bus bodies as JSON text, read against their signature.

use domicile_host::dbus_json::{read, written};
use zbus::zvariant::{Array, Dict, ObjectPath, Signature, StructureBuilder, Value};

fn signature(text: &str) -> Signature {
    text.parse().expect("a signature")
}

#[test]
fn basic_types_read_from_json_by_their_signature() {
    assert_eq!(
        read(
            "ybnqiuxtdsog",
            r#"[1, true, -2, 3, -4, 5, -6, 7, 0.5, "s", "/o", "a{sv}"]"#
        ),
        Ok(vec![
            Value::U8(1),
            Value::Bool(true),
            Value::I16(-2),
            Value::U16(3),
            Value::I32(-4),
            Value::U32(5),
            Value::I64(-6),
            Value::U64(7),
            Value::F64(0.5),
            Value::from("s"),
            Value::ObjectPath(ObjectPath::try_from("/o").unwrap()),
            Value::Signature(signature("a{sv}")),
        ])
    );
}

#[test]
fn containers_read_as_arrays_and_objects() {
    let mut strings = Array::new(&Signature::Str);
    strings.append(Value::from("a")).unwrap();
    let mut properties = Dict::new(&Signature::Str, &Signature::Variant);
    properties
        .append(
            Value::from("Percentage"),
            Value::Value(Box::new(Value::F64(97.0))),
        )
        .unwrap();
    let pair = StructureBuilder::new()
        .append_field(Value::I32(1))
        .append_field(Value::from("x"))
        .build()
        .unwrap();

    assert_eq!(
        read(
            "asa{sv}(is)",
            r#"[["a"], {"Percentage": {"signature": "d", "value": 97}}, [1, "x"]]"#
        ),
        Ok(vec![
            Value::Array(strings),
            Value::Dict(properties),
            Value::Structure(pair),
        ])
    );
}

/// An empty array still knows what it holds, from the signature.
#[test]
fn an_empty_array_takes_its_type_from_the_signature() {
    let read = read("au", "[[]]").expect("it reads");
    let [Value::Array(array)] = read.as_slice() else {
        panic!("expected one array, read {read:?}");
    };
    assert_eq!(array.element_signature(), &Signature::U32);
}

/// A dictionary's keys are JSON object keys, so keys that are not strings
/// are written as their JSON text.
#[test]
fn a_dictionary_with_number_keys_is_keyed_by_their_text() {
    let mut numbered = Dict::new(&Signature::U32, &Signature::Str);
    numbered
        .append(Value::U32(7), Value::from("seven"))
        .unwrap();

    assert_eq!(
        read("a{us}", r#"[{"7": "seven"}]"#),
        Ok(vec![Value::Dict(numbered.try_clone().unwrap())])
    );
    assert_eq!(written(&[Value::Dict(numbered)]), r#"[{"7":"seven"}]"#);
}

#[test]
fn json_that_does_not_fit_the_signature_is_refused() {
    for (signature, body) in [
        ("u", r#"["1"]"#),
        ("u", "[-1]"),
        ("y", "[256]"),
        ("i", "[1.5]"),
        ("s", "[1]"),
        ("o", r#"["not a path"]"#),
        ("g", r#"["a{"]"#),
        ("su", r#"["only one"]"#),
        ("s", r#"["a", "b"]"#),
        ("v", r#"[{"value": 1}]"#),
        ("h", "[0]"),
        ("a{", "[]"),
        ("s", "not json"),
        ("s", r#"{"a": 1}"#),
    ] {
        assert!(
            read(signature, body).is_err(),
            "{signature} read {body} as {:?}",
            read(signature, body)
        );
    }
}

#[test]
fn no_signature_is_no_arguments() {
    assert_eq!(read("", "[]"), Ok(vec![]));
}

#[test]
fn values_are_written_as_they_are_read() {
    let body = r#"[1,"s","/o",[true,false],{"k":{"signature":"as","value":["x"]}},[2.5,"t"]]"#;
    let values = read("usoaba{sv}(ds)", body).unwrap();

    assert_eq!(written(&values), body);
}
