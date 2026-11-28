//! Percent-encoding for the URIs the desktop hands out and reads.

use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};

/// Escapes every byte but RFC 3986's unreserved characters: for a query value.
pub const UNRESERVED: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

/// [`UNRESERVED`], keeping `/`: for a path.
pub const PATH: &AsciiSet = &UNRESERVED.remove(b'/');

/// [`UNRESERVED`], keeping `@`: for a `mailto:` address.
pub const ADDRESS: &AsciiSet = &UNRESERVED.remove(b'@');

/// `path` as a `file://` URI.
pub fn file_uri(path: &str) -> String {
    format!("file://{}", percent_encoded(path, PATH))
}

/// `text` with every byte in `escaped` percent-encoded.
pub fn percent_encoded(text: &str, escaped: &'static AsciiSet) -> String {
    utf8_percent_encode(text, escaped).to_string()
}

/// `text`'s bytes with each `%XX` replaced by its byte. A `%` not followed by
/// two hex digits stays as it is.
pub fn percent_decoded(text: &str) -> Vec<u8> {
    percent_decode_str(text).collect()
}

/// `text`'s bytes with each `%XX` replaced by its byte, or `None` when a `%`
/// is not followed by two hex digits.
pub fn strictly_percent_decoded(text: &str) -> Option<Vec<u8>> {
    text.match_indices('%')
        .all(|(at, _)| {
            text.get(at + 1..at + 3)
                .is_some_and(|hex| hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
        })
        .then(|| percent_decoded(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_keeps_its_slashes_and_encodes_the_rest() {
        assert_eq!(
            file_uri("/home/ada/My Picture#1.png"),
            "file:///home/ada/My%20Picture%231.png"
        );
    }

    #[test]
    fn every_byte_of_a_character_past_ascii_is_encoded() {
        assert_eq!(percent_encoded("é~", UNRESERVED), "%C3%A9~");
    }

    #[test]
    fn decoding_reads_escapes_and_leaves_a_stray_percent() {
        assert_eq!(percent_decoded("a%20b%zz%"), b"a b%zz%");
    }

    #[test]
    fn strict_decoding_refuses_a_stray_percent() {
        assert_eq!(strictly_percent_decoded("a%20b"), Some(b"a b".to_vec()));
        assert_eq!(strictly_percent_decoded("a%2"), None);
        assert_eq!(strictly_percent_decoded("a%zz"), None);
    }
}
