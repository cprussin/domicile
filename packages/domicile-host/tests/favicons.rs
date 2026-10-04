//! Finding a bookmarked site's icon for the launcher.

use std::collections::HashMap;

use domicile_host::favicons::{favicon, Page};

/// A fake web of `pages` by URL, each with a final URL (after redirects), a
/// type and a body. Other URLs are missing.
fn web(pages: &[(&str, &str, &str, &[u8])]) -> impl Fn(&str) -> Option<Page> {
    let pages: HashMap<String, Page> = pages
        .iter()
        .map(|(asked, landed, kind, body)| {
            (
                (*asked).to_string(),
                Page {
                    url: (*landed).to_string(),
                    content_type: Some((*kind).to_string()),
                    body: body.to_vec(),
                },
            )
        })
        .collect();
    move |url| {
        pages.get(url).map(|page| Page {
            url: page.url.clone(),
            content_type: page.content_type.clone(),
            body: page.body.clone(),
        })
    }
}

#[test]
fn the_icon_the_page_links_is_the_one_drawn() {
    let fetch = web(&[
        (
            "https://home.example/lovelace",
            "https://home.example/lovelace",
            "text/html; charset=utf-8",
            b"<html><head><LINK rel='icon' href=\"/static/icons/favicon.png\"></head></html>",
        ),
        (
            "https://home.example/static/icons/favicon.png",
            "https://home.example/static/icons/favicon.png",
            "image/png",
            b"png",
        ),
    ]);

    assert_eq!(
        favicon("https://home.example/lovelace", fetch).as_deref(),
        Some("data:image/png;base64,cG5n")
    );
}

#[test]
fn a_link_is_read_against_the_page_it_is_in() {
    let fetch = web(&[
        (
            "https://sync.example/gui/",
            "https://sync.example/gui/",
            "text/html",
            b"<link rel=\"shortcut icon\" href=\"assets/fav.ico\">",
        ),
        (
            "https://sync.example/gui/assets/fav.ico",
            "https://sync.example/gui/assets/fav.ico",
            "image/x-icon",
            b"ico",
        ),
    ]);

    assert_eq!(
        favicon("https://sync.example/gui/", fetch).as_deref(),
        Some("data:image/x-icon;base64,aWNv")
    );
}

#[test]
fn the_biggest_icon_linked_wins_and_a_drawing_beats_them_all() {
    let page = br#"
        <link rel="icon" sizes="16x16" href="/16.png">
        <link rel="apple-touch-icon" href="/touch.png">
        <link rel="icon" sizes="32x32 48x48" href="/48.png">
    "#;
    let fetch = web(&[
        (
            "https://a.example/",
            "https://a.example/",
            "text/html",
            page,
        ),
        (
            "https://a.example/16.png",
            "https://a.example/16.png",
            "image/png",
            b"16",
        ),
        (
            "https://a.example/48.png",
            "https://a.example/48.png",
            "image/png",
            b"48",
        ),
        (
            "https://a.example/touch.png",
            "https://a.example/touch.png",
            "image/png",
            b"tt",
        ),
        (
            "https://a.example/a.svg",
            "https://a.example/a.svg",
            "image/svg+xml",
            b"svg",
        ),
    ]);
    // A touch icon without `sizes` counts as 180 pixels.
    assert_eq!(
        favicon("https://a.example/", &fetch).as_deref(),
        Some("data:image/png;base64,dHQ=")
    );

    let drawn = web(&[
        (
            "https://b.example/",
            "https://b.example/",
            "text/html",
            br#"<link rel="icon" sizes="512x512" href="/big.png"><link rel="icon" type="image/svg+xml" href="/a.svg">"#,
        ),
        ("https://b.example/big.png", "https://b.example/big.png", "image/png", b"big"),
        ("https://b.example/a.svg", "https://b.example/a.svg", "image/svg+xml", b"svg"),
    ]);
    assert_eq!(
        favicon("https://b.example/", drawn).as_deref(),
        Some("data:image/svg+xml;base64,c3Zn")
    );
}

#[test]
fn a_site_that_links_none_is_asked_for_its_favicon_ico() {
    let fetch = web(&[
        (
            "https://c.example/app",
            "https://c.example/app",
            "text/html",
            b"<p>hi</p>",
        ),
        (
            "https://c.example/favicon.ico",
            "https://c.example/favicon.ico",
            "image/vnd.microsoft.icon",
            b"ico",
        ),
    ]);

    assert_eq!(
        favicon("https://c.example/app", fetch).as_deref(),
        Some("data:image/vnd.microsoft.icon;base64,aWNv")
    );
}

#[test]
fn a_page_that_sent_it_elsewhere_is_not_where_its_icon_is() {
    // A signed-out Google app redirects to the sign-in page, whose icon is
    // Google's. The app's own host's favicon.ico is the right one.
    let fetch = web(&[
        (
            "https://mail.example/",
            "https://accounts.example/signin",
            "text/html",
            b"<link rel=icon href=/accounts.png>",
        ),
        (
            "https://accounts.example/accounts.png",
            "https://accounts.example/accounts.png",
            "image/png",
            b"no",
        ),
        (
            "https://mail.example/favicon.ico",
            "https://mail.example/favicon.ico",
            "image/x-icon",
            b"ico",
        ),
    ]);

    assert_eq!(
        favicon("https://mail.example/", fetch).as_deref(),
        Some("data:image/x-icon;base64,aWNv")
    );
}

#[test]
fn what_is_not_a_picture_is_no_icon() {
    // Many servers answer a missing favicon.ico with the app's page.
    let fetch = web(&[
        (
            "https://d.example/",
            "https://d.example/",
            "text/html",
            b"<p>",
        ),
        (
            "https://d.example/favicon.ico",
            "https://d.example/",
            "text/html",
            b"<p>",
        ),
    ]);

    assert_eq!(favicon("https://d.example/", fetch), None);
}

#[test]
fn a_site_that_cannot_be_reached_is_no_icon() {
    assert_eq!(favicon("https://e.example/", |_: &str| None), None);
}

#[test]
fn a_redirect_within_the_site_keeps_its_links() {
    // `example.com` to `www.example.com` is the same site, and its page's
    // links beat a 16-pixel favicon.ico.
    let fetch = web(&[
        (
            "https://f.example/",
            "https://www.f.example/home",
            "text/html",
            b"<link rel=icon href=/big.svg>",
        ),
        (
            "https://www.f.example/big.svg",
            "https://www.f.example/big.svg",
            "image/svg+xml",
            b"svg",
        ),
    ]);

    assert_eq!(
        favicon("https://f.example/", fetch).as_deref(),
        Some("data:image/svg+xml;base64,c3Zn")
    );
}

#[test]
fn a_page_is_read_as_html_rather_than_as_text() {
    // Entities are decoded, a quoted `>` does not end the tag, commented-out
    // links are ignored, and types are case-insensitive.
    let page = br#"
        <!-- <link rel="icon" href="/commented.png"> -->
        <link rel="icon" sizes="16x16" title="a > b" href="/i.png?a=1&amp;b=2">
        <link rel="icon" type="IMAGE/SVG+XML" href="/drawn">
    "#;
    let fetch = web(&[
        (
            "https://g.example/",
            "https://g.example/",
            "text/html",
            page,
        ),
        (
            "https://g.example/drawn",
            "https://g.example/drawn",
            "image/svg+xml",
            b"svg",
        ),
        // Would win if the SVG type were not recognized.
        (
            "https://g.example/i.png?a=1&b=2",
            "https://g.example/i.png?a=1&b=2",
            "image/png",
            b"png",
        ),
        (
            "https://g.example/commented.png",
            "https://g.example/commented.png",
            "image/png",
            b"no",
        ),
    ]);
    assert_eq!(
        favicon("https://g.example/", &fetch).as_deref(),
        Some("data:image/svg+xml;base64,c3Zn")
    );

    let unescaped = web(&[
        (
            "https://h.example/",
            "https://h.example/",
            "text/html",
            br#"<link rel="icon" title="a > b" href="/i.png?a=1&amp;b=2">"#,
        ),
        (
            "https://h.example/i.png?a=1&b=2",
            "https://h.example/i.png?a=1&b=2",
            "image/png",
            b"png",
        ),
    ]);
    assert_eq!(
        favicon("https://h.example/", unescaped).as_deref(),
        Some("data:image/png;base64,cG5n")
    );

    let commented = web(&[
        (
            "https://i.example/",
            "https://i.example/",
            "text/html",
            b"<!-- <link rel=icon href=/no.png> -->",
        ),
        (
            "https://i.example/no.png",
            "https://i.example/no.png",
            "image/png",
            b"no",
        ),
    ]);
    assert_eq!(favicon("https://i.example/", commented), None);
}

#[test]
fn an_icon_sent_as_bytes_is_known_by_what_it_starts_with() {
    let fetch = web(&[
        (
            "https://j.example/",
            "https://j.example/",
            "text/html",
            b"<p>",
        ),
        (
            "https://j.example/favicon.ico",
            "https://j.example/favicon.ico",
            "application/octet-stream",
            &[0, 0, 1, 0, 1, 0],
        ),
    ]);

    assert_eq!(
        favicon("https://j.example/", fetch).as_deref(),
        Some("data:image/x-icon;base64,AAABAAEA")
    );
}

#[test]
fn a_quote_inside_a_bare_value_is_a_character() {
    // `Bob's` does not open a quoted value, so later tags still parse, and
    // a tag that only starts like `<link` is not one.
    let fetch = web(&[
        (
            "https://k.example/",
            "https://k.example/",
            "text/html",
            br#"<linkedin x="a>"><link rel=author title=Bob's href=/bob><link rel=icon href=/k.png>"#,
        ),
        ("https://k.example/k.png", "https://k.example/k.png", "image/png", b"png"),
    ]);

    assert_eq!(
        favicon("https://k.example/", fetch).as_deref(),
        Some("data:image/png;base64,cG5n")
    );
}
