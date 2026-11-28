//! Encodes bytes as `data:` URLs so a page can draw files it cannot fetch.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

/// Encodes `bytes` as a `data:` URL of type `mime`.
pub fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}
