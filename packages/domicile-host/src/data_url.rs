//! Bytes a page may draw but cannot fetch, written into the URL itself.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// `bytes` as a `data:` URL of type `mime`.
pub fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", base64(bytes))
}

/// Standard base64, padded. Written out rather than taken as a dependency: it
/// is this function, and one caller.
fn base64(bytes: &[u8]) -> String {
    bytes
        .chunks(3)
        .flat_map(|chunk| {
            let word = chunk.iter().enumerate().fold(0u32, |word, (at, byte)| {
                word | u32::from(*byte) << (16 - 8 * at)
            });
            (0..4).map(move |at| {
                if at <= chunk.len() {
                    char::from(ALPHABET[(word >> (18 - 6 * at) & 0x3f) as usize])
                } else {
                    '='
                }
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_last_group_is_padded() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xff, 0xfe]), "//4=");
    }
}
