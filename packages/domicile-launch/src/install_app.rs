//! `domicile install-app <url>`: reads the site's web app manifest and writes
//! a desktop entry that opens it with `domicile open-app`. See
//! `docs/architecture/WEB-APPS.md`.

use std::path::{Path, PathBuf};

use crate::desktop_entry::{desktop_entry, file_stem};
use crate::web_address::origin;
use crate::web_app::{manifest_link, web_app, IconKind, WebAppError};

/// Why a site was not installed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum InstallAppError {
    #[error("cannot fetch {url}: {why}")]
    Fetch { url: String, why: String },
    #[error(transparent)]
    WebApp(#[from] WebAppError),
    #[error("cannot write {}: {why}", path.display())]
    Write { path: PathBuf, why: String },
}

/// A fetched address: where it landed after redirects, and its body.
pub struct Fetched {
    pub url: String,
    pub body: Vec<u8>,
}

/// Installs the site at `url` as an app under `data_home`
/// (`$XDG_DATA_HOME`), and returns the desktop entry written.
///
/// - The entry is `applications/<stem>.desktop`, named by [`file_stem`].
/// - The icon is `domicile/app-icons/<stem>.<png|svg>`.
///
/// Installing the same app again replaces both.
pub fn install_app(
    url: &str,
    data_home: &Path,
    fetch: &dyn Fn(&str) -> Result<Fetched, String>,
) -> Result<PathBuf, InstallAppError> {
    origin(url).map_err(WebAppError::from)?;
    let page = fetched(fetch, url)?;
    let manifest_url = manifest_link(&String::from_utf8_lossy(&page.body), &page.url)?;
    let manifest = fetched(fetch, &manifest_url)?;
    let app = web_app(
        &String::from_utf8_lossy(&manifest.body),
        &manifest.url,
        &page.url,
    )?;
    let stem = file_stem(&app.start_url);
    let icon = match app.icon {
        Some(icon) => {
            let path = icon_path(data_home, &stem, icon.kind);
            written(&path, &fetched(fetch, &icon.url)?.body)?;
            Some(path)
        }
        None => None,
    };
    let entry = entry_path(data_home, &stem);
    written(
        &entry,
        desktop_entry(&app.name, &app.start_url, icon.as_deref(), url).as_bytes(),
    )?;
    Ok(entry)
}

/// Where the desktop entry for the app named `stem` goes.
pub fn entry_path(data_home: &Path, stem: &str) -> PathBuf {
    data_home
        .join("applications")
        .join(format!("{stem}.desktop"))
}

/// Where the `kind` icon for the app named `stem` goes.
pub fn icon_path(data_home: &Path, stem: &str, kind: IconKind) -> PathBuf {
    data_home
        .join("domicile/app-icons")
        .join(format!("{stem}.{}", kind.extension()))
}

/// `$XDG_DATA_HOME`, else `~/.local/share`, or `None` when neither is set.
///
/// A relative `XDG_DATA_HOME` is ignored, as the XDG spec says.
pub fn data_home(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    let absolute = |value: String| {
        let path = PathBuf::from(value);
        path.is_absolute().then_some(path)
    };
    env("XDG_DATA_HOME").and_then(absolute).or_else(|| {
        env("HOME")
            .and_then(absolute)
            .map(|home| home.join(".local/share"))
    })
}

/// `url`, fetched.
fn fetched(
    fetch: &dyn Fn(&str) -> Result<Fetched, String>,
    url: &str,
) -> Result<Fetched, InstallAppError> {
    fetch(url).map_err(|why| InstallAppError::Fetch {
        url: url.to_string(),
        why,
    })
}

/// Writes `contents` to `path`, making its directory first.
fn written(path: &Path, contents: &[u8]) -> Result<(), InstallAppError> {
    let directory = path.parent().unwrap_or(path);
    std::fs::create_dir_all(directory).map_err(|why| InstallAppError::Write {
        path: directory.to_path_buf(),
        why: why.to_string(),
    })?;
    std::fs::write(path, contents).map_err(|why| InstallAppError::Write {
        path: path.to_path_buf(),
        why: why.to_string(),
    })
}
