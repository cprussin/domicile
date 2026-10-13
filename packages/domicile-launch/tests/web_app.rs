//! Tests for reading a site's web app manifest for `domicile install-app`.

use domicile_launch::web_app::{manifest_link, web_app, Icon, IconKind, WebApp, WebAppError};

const PAGE: &str = "https://music.example/app/";
const MANIFEST: &str = "https://music.example/app/manifest.json";

#[test]
fn a_page_names_its_manifest_in_a_link() {
    let page = r#"<!doctype html><html><head>
        <link rel="icon" href="/favicon.png">
        <LINK REL='Preload Manifest' HREF='manifest.json'>
        </head></html>"#;
    assert_eq!(manifest_link(page, PAGE), Ok(MANIFEST.to_string()));
}

#[test]
fn a_page_without_a_manifest_is_not_an_app() {
    assert_eq!(
        manifest_link(r#"<link rel="icon" href="/favicon.png">"#, PAGE),
        Err(WebAppError::NoManifest {
            page: PAGE.to_string()
        })
    );
}

#[test]
fn a_manifest_names_the_app_where_it_starts_and_its_icon() {
    let manifest = r#"{
        "name": "Music",
        "short_name": "M",
        "start_url": "../?source=app",
        "icons": [{ "src": "icon.svg", "type": "image/svg+xml", "sizes": "any" }]
    }"#;
    assert_eq!(
        web_app(manifest, MANIFEST, PAGE),
        Ok(WebApp {
            name: "Music".to_string(),
            start_url: "https://music.example/?source=app".to_string(),
            icon: Some(Icon {
                url: "https://music.example/app/icon.svg".to_string(),
                kind: IconKind::Svg,
            }),
        })
    );
}

#[test]
fn an_app_without_a_name_goes_by_its_short_name() {
    assert_eq!(
        web_app(r#"{ "short_name": "M" }"#, MANIFEST, PAGE).map(|app| app.name),
        Ok("M".to_string())
    );
    assert_eq!(
        web_app("{}", MANIFEST, PAGE),
        Err(WebAppError::Unnamed {
            manifest: MANIFEST.to_string()
        })
    );
}

#[test]
fn an_app_without_a_start_url_starts_on_the_page_that_linked_it() {
    assert_eq!(
        web_app(r#"{ "name": "Music" }"#, MANIFEST, PAGE).map(|app| app.start_url),
        Ok(PAGE.to_string())
    );
}

#[test]
fn an_app_starts_on_its_own_site() {
    assert_eq!(
        web_app(
            r#"{ "name": "Music", "start_url": "https://elsewhere.example/" }"#,
            MANIFEST,
            PAGE
        ),
        Err(WebAppError::OtherOrigin {
            start_url: "https://elsewhere.example/".to_string(),
            page: PAGE.to_string(),
        })
    );
}

#[test]
fn the_icon_is_an_svg_or_else_the_largest_png() {
    let icon = |icons: &str| {
        web_app(
            &format!(r#"{{ "name": "M", "icons": {icons} }}"#),
            MANIFEST,
            PAGE,
        )
        .map(|app| app.icon.map(|icon| icon.url))
    };
    let at = |file: &str| Ok(Some(format!("https://music.example/app/{file}")));
    assert_eq!(
        icon(
            r#"[
                { "src": "small.png", "sizes": "48x48" },
                { "src": "large.png", "sizes": "96x96 512x512", "type": "image/png" },
                { "src": "middle.png", "sizes": "192x192" }
            ]"#
        ),
        at("large.png")
    );
    assert_eq!(
        icon(
            r#"[
                { "src": "large.png", "sizes": "512x512" },
                { "src": "icon.svg" }
            ]"#
        ),
        at("icon.svg")
    );
    // The launcher draws only PNG and SVG, and a maskable icon is cropped.
    assert_eq!(
        icon(
            r#"[
                { "src": "icon.webp", "sizes": "512x512" },
                { "src": "photo", "type": "image/jpeg", "sizes": "512x512" },
                { "src": "mask.png", "sizes": "512x512", "purpose": "maskable" },
                { "src": "both.png", "sizes": "48x48", "purpose": "maskable any" }
            ]"#
        ),
        at("both.png")
    );
    assert_eq!(icon(r#"[{ "src": "icon.webp" }]"#), Ok(None));
}

#[test]
fn a_manifest_that_is_not_json_is_refused() {
    assert!(matches!(
        web_app("<html>", MANIFEST, PAGE),
        Err(WebAppError::Unreadable { manifest, .. }) if manifest == MANIFEST
    ));
}
