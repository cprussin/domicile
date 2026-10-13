//! Tests for resolving the addresses a web page and its manifest name.

use domicile_launch::web_address::{origin, resolved, WebAddressError};

#[test]
fn a_reference_resolves_against_the_address_it_was_found_at() {
    let base = "https://music.example/app/index.html?x=1#top";
    for (reference, expected) in [
        ("https://cdn.example/a.png", "https://cdn.example/a.png"),
        ("//cdn.example/a.png", "https://cdn.example/a.png"),
        ("/manifest.json", "https://music.example/manifest.json"),
        ("manifest.json", "https://music.example/app/manifest.json"),
        ("./icons/a.png", "https://music.example/app/icons/a.png"),
        ("../a.png", "https://music.example/a.png"),
        ("../../a.png", "https://music.example/a.png"),
        ("?play=1", "https://music.example/app/index.html?play=1"),
        ("", "https://music.example/app/index.html?x=1"),
        (".", "https://music.example/app/"),
    ] {
        assert_eq!(
            resolved(base, reference),
            Ok(expected.to_string()),
            "{reference}"
        );
    }
}

#[test]
fn a_base_without_a_path_resolves_from_its_root() {
    assert_eq!(
        resolved("https://music.example", "manifest.json"),
        Ok("https://music.example/manifest.json".to_string())
    );
}

#[test]
fn only_a_web_address_is_a_base() {
    assert_eq!(
        resolved("file:///tmp/index.html", "manifest.json"),
        Err(WebAddressError::NotWeb {
            address: "file:///tmp/index.html".to_string()
        })
    );
}

#[test]
fn an_origin_is_the_scheme_and_host() {
    assert_eq!(
        origin("https://Music.example:8443/app?x=1"),
        Ok("https://music.example:8443".to_string())
    );
    assert_eq!(
        origin("http://music.example"),
        Ok("http://music.example".to_string())
    );
    assert_eq!(
        origin("javascript:alert(1)"),
        Err(WebAddressError::NotWeb {
            address: "javascript:alert(1)".to_string()
        })
    );
}
