//! Encodes bytes as `data:` URLs so a page can draw files it cannot fetch.

use crate::base64::encoded;

/// Encodes `bytes` as a `data:` URL of type `mime`.
pub fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", encoded(bytes))
}
