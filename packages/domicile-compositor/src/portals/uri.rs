//! Percent-encoding for the URIs portal backends hand out.

/// `path` as a `file://` URI.
pub fn file_uri(path: &str) -> String {
    format!("file://{}", percent_encoded(path, b"/"))
}

/// `text` with every byte but RFC 3986's unreserved characters and `keep`
/// percent-encoded.
pub fn percent_encoded(text: &str, keep: &[u8]) -> String {
    text.bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) || keep.contains(&byte) {
                char::from(byte).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
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
}
