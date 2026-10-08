//! A DynamicLauncher icon as a picture a page can draw.
//!
//! The portal frontend accepts PNG, JPEG and SVG icons; this tells them apart
//! by their first bytes. See `docs/PORTALS.md`.

use crate::data_url::data_url;

/// `bytes` as a `data:` URL, or `None` for anything but PNG, JPEG or SVG.
pub fn icon_url(bytes: &[u8]) -> Option<String> {
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.windows(4).any(|window| window == b"<svg") {
        Some("image/svg+xml")
    } else {
        None
    };
    mime.map(|mime| data_url(mime, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_kind_the_frontend_takes_is_drawn() {
        assert_eq!(
            icon_url(b"\x89PNG\r\n\x1a\nrest"),
            Some("data:image/png;base64,iVBORw0KGgpyZXN0".into())
        );
        assert!(icon_url(b"\xff\xd8\xff\xe0")
            .expect("a JPEG")
            .starts_with("data:image/jpeg;base64,"));
        assert!(icon_url(b"<?xml version=\"1.0\"?>\n<svg xmlns=\"\"/>")
            .expect("an SVG")
            .starts_with("data:image/svg+xml;base64,"));
    }

    #[test]
    fn anything_else_is_no_picture() {
        assert_eq!(icon_url(b"GIF89a"), None);
    }
}
