//! Resolves the addresses a web page and its manifest name, as RFC 3986 does
//! for `http` and `https` bases.

use crate::address::has_scheme;

/// An address that is not `http` or `https`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WebAddressError {
    #[error("{address} is not a web address: it should start with https:// or http://")]
    NotWeb { address: String },
}

/// `reference` resolved against `base`, without its fragment.
///
/// A reference with a scheme of its own is returned as it is.
pub fn resolved(base: &str, reference: &str) -> Result<String, WebAddressError> {
    let base = parts(base)?;
    let reference = reference.split('#').next().unwrap_or_default();
    let root = format!("{}://{}", base.scheme, base.authority);
    Ok(if has_scheme(reference) {
        reference.to_string()
    } else if reference.starts_with("//") {
        format!("{}:{reference}", base.scheme)
    } else if reference.is_empty() {
        format!("{root}{}{}", base.path, queried(base.query))
    } else if reference.starts_with('?') {
        format!("{root}{}{reference}", base.path)
    } else {
        let (path, query) = match reference.split_once('?') {
            Some((path, query)) => (path, Some(query)),
            None => (reference, None),
        };
        let path = match path.starts_with('/') {
            true => path.to_string(),
            false => format!("{}{path}", &base.path[..=base.path.rfind('/').unwrap_or(0)]),
        };
        format!("{root}{}{}", without_dots(&path), queried(query))
    })
}

/// The scheme and host of `address`, lowercased, with any port.
pub fn origin(address: &str) -> Result<String, WebAddressError> {
    parts(address).map(|found| {
        format!(
            "{}://{}",
            found.scheme,
            found.authority.to_ascii_lowercase()
        )
    })
}

/// A web address split for resolving against.
struct Parts<'a> {
    /// Lowercased.
    scheme: String,
    authority: &'a str,
    /// Starts with `/`.
    path: &'a str,
    query: Option<&'a str>,
}

/// Splits `address`, or refuses it if it is not `http` or `https`.
fn parts(address: &str) -> Result<Parts<'_>, WebAddressError> {
    let not_web = || WebAddressError::NotWeb {
        address: address.to_string(),
    };
    let (scheme, rest) = address.split_once("://").ok_or_else(not_web)?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(not_web());
    }
    let rest = rest.split('#').next().unwrap_or_default();
    let (authority, rest) = rest.split_at(rest.find(['/', '?']).unwrap_or(rest.len()));
    let (path, query) = match rest.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (rest, None),
    };
    Ok(Parts {
        scheme,
        authority,
        path: if path.is_empty() { "/" } else { path },
        query,
    })
}

/// `?query`, or nothing.
fn queried(query: Option<&str>) -> String {
    query.map(|query| format!("?{query}")).unwrap_or_default()
}

/// `path` with its `.` and `..` segments applied. `path` starts with `/`.
fn without_dots(path: &str) -> String {
    let segments: Vec<&str> = path[1..].split('/').collect();
    let mut kept: Vec<&str> = Vec::new();
    for segment in &segments {
        match *segment {
            "." => {}
            ".." => {
                kept.pop();
            }
            named => kept.push(named),
        }
    }
    // A path ending in a dot segment names a directory.
    let directory = matches!(segments.last(), Some(&".") | Some(&".."));
    format!("/{}{}", kept.join("/"), if directory { "/" } else { "" })
}
