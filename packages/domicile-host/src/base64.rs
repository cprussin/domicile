//! Standard padded base64, for bytes on the JSON wire. Small enough not to need
//! a dependency.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Text that is not standard padded base64.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("not standard padded base64")]
pub struct NotBase64;

/// Encodes `bytes`.
pub fn encoded(bytes: &[u8]) -> String {
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

/// Decodes `text`, which must be padded to a multiple of four characters.
pub fn decoded(text: &str) -> Result<Vec<u8>, NotBase64> {
    let text = text.as_bytes();
    if !text.len().is_multiple_of(4) {
        return Err(NotBase64);
    }
    let groups = text.len() / 4;
    let mut bytes = Vec::with_capacity(groups * 3);
    for (index, group) in text.chunks(4).enumerate() {
        let padding = group.iter().rev().take_while(|&&c| c == b'=').count();
        if padding > 2 || (padding > 0 && index + 1 != groups) {
            return Err(NotBase64);
        }
        let mut word = 0u32;
        for &c in &group[..4 - padding] {
            let value = ALPHABET
                .iter()
                .position(|&letter| letter == c)
                .ok_or(NotBase64)?;
            word = word << 6 | value as u32;
        }
        word <<= 6 * padding as u32;
        bytes.extend(&word.to_be_bytes()[1..4 - padding]);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_last_group_is_padded() {
        assert_eq!(encoded(b""), "");
        assert_eq!(encoded(b"f"), "Zg==");
        assert_eq!(encoded(b"fo"), "Zm8=");
        assert_eq!(encoded(b"foo"), "Zm9v");
        assert_eq!(encoded(b"foobar"), "Zm9vYmFy");
        assert_eq!(encoded(&[0xff, 0xfe]), "//4=");
    }

    #[test]
    fn decoding_undoes_encoding() {
        for bytes in [
            &b""[..],
            b"f",
            b"fo",
            b"foo",
            b"foobar",
            &[0xff, 0xfe, 0x00],
        ] {
            assert_eq!(decoded(&encoded(bytes)), Ok(bytes.to_vec()));
        }
    }

    #[test]
    fn text_that_is_not_padded_base64_is_refused() {
        for text in ["Zg", "Zg=", "Z===", "Zg==Zg==", "Zm9!", "Zm 9v"] {
            assert_eq!(decoded(text), Err(NotBase64), "{text}");
        }
    }
}
