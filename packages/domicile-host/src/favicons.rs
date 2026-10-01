//! The icon a bookmark's site names for itself, as a `data:` URL.
//!
//! What a browser does: the `<link rel="icon">` the page names, else
//! `/favicon.ico`. Fetching is the caller's, so this is the choosing and
//! nothing that touches a network.

use url::Url;

use crate::data_url::data_url;

/// The biggest icon sent, for `crate::app_icons`'s reason.
const LARGEST: usize = 128 * 1024;

/// The size a touch icon is when its link does not say: Apple's.
const TOUCH_ICON_SIZE: u32 = 180;

/// The size an icon is when its link does not say: a tab's.
const UNSIZED: u32 = 16;

/// What a fetch found: where it ended after redirects, what it said it is, and
/// what it is.
pub struct Page {
    pub url: String,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

/// The icon `url`'s site names for itself, or none it could be found or drawn.
///
/// The page's own links first, best first — a drawing, then the biggest — and
/// only a page that is still on `url`'s site — its host, or one above or
/// below it, `www.` say: one that redirected elsewhere, to a sign-in page say,
/// is another site's. Then `/favicon.ico` on that host.
pub fn favicon(url: &str, fetch: impl Fn(&str) -> Option<Page>) -> Option<String> {
    let asked = Url::parse(url).ok()?;
    let linked = fetch(url)
        .filter(is_html)
        .and_then(|page| {
            let landed = Url::parse(&page.url).ok()?;
            same_site(&asked, &landed)
                .then(|| icon_links(&String::from_utf8_lossy(&page.body), &landed))
        })
        .unwrap_or_default();
    linked
        .into_iter()
        .chain(asked.join("/favicon.ico").ok())
        .find_map(|icon| fetch(icon.as_str()).and_then(|found| picture(&found)))
}

/// Whether `landed` is on `asked`'s site: the same host, or one a subdomain of
/// the other.
fn same_site(asked: &Url, landed: &Url) -> bool {
    match (asked.host_str(), landed.host_str()) {
        (Some(asked), Some(landed)) => {
            asked == landed
                || asked.ends_with(&format!(".{landed}"))
                || landed.ends_with(&format!(".{asked}"))
        }
        _ => false,
    }
}

/// The icons `html` links, read against `base`, best first.
fn icon_links(html: &str, base: &Url) -> Vec<Url> {
    let mut found: Vec<(bool, u32, Url)> = tags(&without_comments(html), "link")
        .into_iter()
        .filter_map(|attributes| {
            let attribute = |name: &str| {
                attributes
                    .iter()
                    .find(|(key, _)| key.eq_ignore_ascii_case(name))
                    .map(|(_, value)| value.as_str())
            };
            let rel = attribute("rel")?.to_ascii_lowercase();
            let rels: Vec<&str> = rel.split_whitespace().collect();
            let touch = rels.contains(&"apple-touch-icon");
            if !rels.contains(&"icon") && !touch {
                return None;
            }
            let href = base.join(&unescaped(attribute("href")?)).ok()?;
            let drawn = attribute("type")
                .is_some_and(|kind| kind.eq_ignore_ascii_case("image/svg+xml"))
                || href.path().to_ascii_lowercase().ends_with(".svg");
            let size = attribute("sizes")
                .and_then(largest_size)
                .unwrap_or(if touch { TOUCH_ICON_SIZE } else { UNSIZED });
            Some((drawn, size, href))
        })
        .collect();
    // Stable, so of two alike the page's first is first.
    found.sort_by_key(|(drawn, size, _)| std::cmp::Reverse((*drawn, *size)));
    found.into_iter().map(|(_, _, href)| href).collect()
}

/// The biggest of a `sizes` attribute's `WxH`s, `any` being bigger than all.
fn largest_size(sizes: &str) -> Option<u32> {
    sizes
        .split_whitespace()
        .filter_map(|size| {
            if size.eq_ignore_ascii_case("any") {
                Some(u32::MAX)
            } else {
                let (width, height) =
                    size.to_ascii_lowercase()
                        .split_once('x')
                        .map(|(width, height)| {
                            (width.parse::<u32>().ok(), height.parse::<u32>().ok())
                        })?;
                Some(width?.max(height?))
            }
        })
        .max()
}

/// `html` with its `<!-- -->` comments taken out, so what they hold is not
/// read as markup.
fn without_comments(html: &str) -> String {
    let mut kept = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find("<!--") {
        kept.push_str(&rest[..start]);
        rest = rest[start + 4..]
            .find("-->")
            .map_or("", |end| &rest[start + 4 + end + 3..]);
    }
    kept.push_str(rest);
    kept
}

/// An attribute value with the character references a URL has in it read.
fn unescaped(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#38;", "&")
        .replace("&amp;", "&")
}

/// Every `<name ...>` tag's attributes in `html`, ignoring case. Enough HTML
/// for a `<head>`: quoted, single-quoted and bare values, a `>` in a quoted
/// one included.
fn tags(html: &str, name: &str) -> Vec<Vec<(String, String)>> {
    let lower = html.to_ascii_lowercase();
    let opening = format!("<{name}");
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(at) = lower[from..].find(&opening) {
        let start = from + at + opening.len();
        // `<linkedin` is not a `<link`, and is passed over without reading it.
        let named = html[start..]
            .chars()
            .next()
            .is_some_and(|c| c.is_whitespace() || c == '/' || c == '>');
        if named {
            let end = tag_end(&html[start..]).map_or(html.len(), |end| start + end);
            found.push(attributes(&html[start..end]));
            from = end;
        } else {
            from = start;
        }
        if from >= html.len() {
            break;
        }
    }
    found
}

/// Where the tag `inside` is the rest of ends: its first `>` outside quotes.
/// A quote opens a value only straight after its `=`: `Bob's` is a bare value
/// with an apostrophe in it.
fn tag_end(inside: &str) -> Option<usize> {
    let mut quote = None;
    let mut after_equals = false;
    inside.char_indices().find_map(|(at, c)| {
        match (quote, c) {
            (None, '"' | '\'') if after_equals => quote = Some(c),
            (Some(open), _) if c == open => quote = None,
            (None, '>') => return Some(at),
            _ => {}
        }
        if !c.is_whitespace() {
            after_equals = quote.is_none() && c == '=';
        }
        None
    })
}

/// The `key=value` pairs in the inside of a tag.
fn attributes(inside: &str) -> Vec<(String, String)> {
    let mut found = Vec::new();
    let mut rest = inside.trim_start_matches(['/', ' ', '\t', '\n', '\r']);
    while !rest.is_empty() {
        let key_end = rest
            .find(|c: char| c == '=' || c.is_whitespace() || c == '/')
            .unwrap_or(rest.len());
        let key = &rest[..key_end];
        rest = rest[key_end..].trim_start();
        let value = if let Some(after) = rest.strip_prefix('=') {
            let after = after.trim_start();
            let (value, remaining) = match after.chars().next() {
                Some(quote @ ('"' | '\'')) => {
                    let body = &after[1..];
                    let close = body.find(quote).unwrap_or(body.len());
                    (&body[..close], body.get(close + 1..).unwrap_or(""))
                }
                _ => {
                    let close = after
                        .find(|c: char| c.is_whitespace())
                        .unwrap_or(after.len());
                    (&after[..close], &after[close..])
                }
            };
            rest = remaining;
            value
        } else {
            ""
        };
        if !key.is_empty() {
            found.push((key.to_string(), value.to_string()));
        }
        rest = rest.trim_start_matches(['/', ' ', '\t', '\n', '\r']);
    }
    found
}

fn is_html(page: &Page) -> bool {
    page.content_type.as_deref().is_some_and(|kind| {
        let kind = kind.to_ascii_lowercase();
        kind.starts_with("text/html") || kind.starts_with("application/xhtml+xml")
    })
}

/// `page` as a `data:` URL, if it is a picture small enough to send: one that
/// says it is an image, or that starts the way one does — a server that does
/// not know `.ico` sends it as bytes.
fn picture(page: &Page) -> Option<String> {
    let said = page
        .content_type
        .as_deref()
        .and_then(|kind| kind.split(';').next())
        .map(str::trim)
        .filter(|kind| kind.to_ascii_lowercase().starts_with("image/"));
    let kind = said.or_else(|| sniffed(&page.body))?;
    (page.body.len() <= LARGEST).then(|| data_url(kind, &page.body))
}

/// The type of picture `body` starts like, if it starts like one.
fn sniffed(body: &[u8]) -> Option<&'static str> {
    const STARTS: &[(&[u8], &str)] = &[
        (b"\x89PNG", "image/png"),
        (&[0, 0, 1, 0], "image/x-icon"),
        (b"GIF8", "image/gif"),
        (&[0xff, 0xd8, 0xff], "image/jpeg"),
        (b"<svg", "image/svg+xml"),
    ];
    let trimmed = &body[body
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(body.len())..];
    STARTS
        .iter()
        .find(|(start, _)| trimmed.starts_with(start))
        .map(|(_, kind)| *kind)
}
