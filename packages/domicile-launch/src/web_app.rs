//! Reads a site's web app manifest for `domicile install-app`: the page's
//! `<link rel="manifest">`, then the manifest's `name`, `start_url` and
//! `icons`. See `docs/architecture/WEB-APPS.md`.

use serde::Deserialize;

use crate::web_address::{origin, resolved, WebAddressError};

/// Why a site cannot be installed as an app.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WebAppError {
    #[error("{page} links no web app manifest, so it cannot be installed as an app")]
    NoManifest { page: String },
    #[error("{manifest} is not a web app manifest: {why}")]
    Unreadable { manifest: String, why: String },
    #[error("{manifest} has neither a name nor a short_name for the app")]
    Unnamed { manifest: String },
    #[error(
        "the manifest's start_url, {start_url}, is on another site than {page}, \
         which linked it"
    )]
    OtherOrigin { start_url: String, page: String },
    #[error(transparent)]
    Address(#[from] WebAddressError),
}

/// What a desktop entry for a site needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebApp {
    pub name: String,
    pub start_url: String,
    /// `None` when the manifest lists no icon the launcher can draw.
    pub icon: Option<Icon>,
}

/// An icon to download.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Icon {
    pub url: String,
    pub kind: IconKind,
}

/// The image formats the launcher draws (`packages/system-apps/src/app-icons.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IconKind {
    Png,
    Svg,
}

impl IconKind {
    /// Every kind.
    pub const ALL: [IconKind; 2] = [IconKind::Png, IconKind::Svg];

    /// The file extension, which tells the launcher the format.
    pub fn extension(self) -> &'static str {
        match self {
            IconKind::Png => "png",
            IconKind::Svg => "svg",
        }
    }
}

/// The address of the manifest `page`, fetched from `page_url`, links.
pub fn manifest_link(page: &str, page_url: &str) -> Result<String, WebAppError> {
    let lowered = page.to_ascii_lowercase();
    let href = lowered
        .match_indices("<link")
        .map(|(at, _)| attributes(&page[at + "<link".len()..]))
        .find(|attributes| {
            attributes.iter().any(|(name, value)| {
                name.eq_ignore_ascii_case("rel")
                    && value
                        .split_ascii_whitespace()
                        .any(|rel| rel.eq_ignore_ascii_case("manifest"))
            })
        })
        .and_then(|attributes| {
            attributes
                .into_iter()
                .find(|(name, _)| name.eq_ignore_ascii_case("href"))
                .map(|(_, value)| value)
        });
    match href {
        Some(href) => Ok(resolved(page_url, href)?),
        None => Err(WebAppError::NoManifest {
            page: page_url.to_string(),
        }),
    }
}

/// The app `manifest`, fetched from `manifest_url`, describes.
///
/// `page_url` is the page that linked the manifest. The app starts there
/// when the manifest names no `start_url`, and may start nowhere off its
/// origin, as the Web App Manifest spec requires.
pub fn web_app(manifest: &str, manifest_url: &str, page_url: &str) -> Result<WebApp, WebAppError> {
    let read: Manifest = serde_json::from_str(manifest).map_err(|why| WebAppError::Unreadable {
        manifest: manifest_url.to_string(),
        why: why.to_string(),
    })?;
    let name = read
        .name
        .or(read.short_name)
        .ok_or_else(|| WebAppError::Unnamed {
            manifest: manifest_url.to_string(),
        })?;
    let start_url = match read.start_url {
        Some(start_url) => resolved(manifest_url, &start_url)?,
        None => page_url.to_string(),
    };
    if origin(&start_url)? != origin(page_url)? {
        return Err(WebAppError::OtherOrigin {
            start_url,
            page: page_url.to_string(),
        });
    }
    let icon = read
        .icons
        .iter()
        .filter(|icon| {
            icon.purpose
                .as_deref()
                .unwrap_or("any")
                .split_ascii_whitespace()
                .any(|purpose| purpose == "any")
        })
        .filter_map(|icon| kind(icon).map(|kind| (icon, kind)))
        .max_by_key(|(icon, kind)| (*kind == IconKind::Svg, largest(icon)))
        .map(|(icon, kind)| resolved(manifest_url, &icon.src).map(|url| Icon { url, kind }))
        .transpose()?;
    Ok(WebApp {
        name,
        start_url,
        icon,
    })
}

/// The members of a web app manifest `domicile install-app` reads.
#[derive(Deserialize)]
struct Manifest {
    name: Option<String>,
    short_name: Option<String>,
    start_url: Option<String>,
    #[serde(default)]
    icons: Vec<ManifestIcon>,
}

/// A member of a manifest's `icons`.
#[derive(Deserialize)]
struct ManifestIcon {
    src: String,
    sizes: Option<String>,
    #[serde(rename = "type")]
    mime: Option<String>,
    purpose: Option<String>,
}

/// The icon's format, from its `type` or else its file extension, or `None`
/// when the launcher cannot draw it.
fn kind(icon: &ManifestIcon) -> Option<IconKind> {
    match icon.mime.as_deref() {
        Some("image/png") => Some(IconKind::Png),
        Some("image/svg+xml") => Some(IconKind::Svg),
        Some(_) => None,
        None => {
            let path = icon.src.split(['?', '#']).next().unwrap_or_default();
            let extension = path.rsplit_once('.').map(|(_, extension)| extension);
            match extension.map(str::to_ascii_lowercase).as_deref() {
                Some("png") => Some(IconKind::Png),
                Some("svg") => Some(IconKind::Svg),
                _ => None,
            }
        }
    }
}

/// The icon's largest side in its `sizes`. `any` is larger than every size.
fn largest(icon: &ManifestIcon) -> u32 {
    icon.sizes
        .as_deref()
        .unwrap_or_default()
        .split_ascii_whitespace()
        .filter_map(|size| match size.eq_ignore_ascii_case("any") {
            true => Some(u32::MAX),
            false => size
                .to_ascii_lowercase()
                .split_once('x')
                .and_then(|(width, height)| {
                    Some(width.parse::<u32>().ok()?.max(height.parse().ok()?))
                }),
        })
        .max()
        .unwrap_or(0)
}

/// The attributes of the tag whose text after its name starts `tag`.
fn attributes(tag: &str) -> Vec<(&str, &str)> {
    let tag = &tag[..tag.find('>').unwrap_or(tag.len())];
    let mut found = Vec::new();
    let mut rest = tag;
    loop {
        rest = rest.trim_start_matches(|c: char| c.is_ascii_whitespace() || c == '/');
        if rest.is_empty() {
            return found;
        }
        let name_ends = rest
            .find(|c: char| c.is_ascii_whitespace() || c == '=')
            .unwrap_or(rest.len());
        let name = &rest[..name_ends];
        rest = rest[name_ends..].trim_start();
        let value = match rest.strip_prefix('=') {
            Some(after) => {
                let after = after.trim_start();
                let (value, remaining) = match after.chars().next() {
                    Some(quote @ ('"' | '\'')) => {
                        let inner = &after[1..];
                        let ends = inner.find(quote).unwrap_or(inner.len());
                        (&inner[..ends], &inner[(ends + 1).min(inner.len())..])
                    }
                    _ => {
                        let ends = after
                            .find(|c: char| c.is_ascii_whitespace())
                            .unwrap_or(after.len());
                        (&after[..ends], &after[ends..])
                    }
                };
                rest = remaining;
                value
            }
            None => "",
        };
        found.push((name, value));
    }
}
