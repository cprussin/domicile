//! Domicile's own apps: unpacked Chrome extensions installed beside
//! `domicile`, such as History and Settings. The compositor adds each to the
//! config's `extensions.unpacked`. See `docs/HISTORY.md` and
//! `docs/SETTINGS.md`.

use std::path::{Path, PathBuf};

/// Each app in `apps`, one directory per app, sorted.
pub fn apps_in(apps: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut found = std::fs::read_dir(apps)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<std::io::Result<Vec<_>>>()?
        .into_iter()
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    found.sort();
    Ok(found)
}

/// The History app's page. The id is fixed by the `key` in
/// `packages/app-history`'s manifest.
pub const HISTORY: &str = "chrome-extension://dimbckmbklbplcobppahmnepgiponamj/history.html";

/// The Settings app's page. The id is fixed by the `key` in
/// `packages/app-settings`'s manifest.
pub const SETTINGS: &str = "chrome-extension://acpgnhiblklkgbkcjgbabkcmdmchdphk/settings.html";

/// The native messaging host the Settings app connects to. See
/// [`crate::settings`].
const SETTINGS_HOST: &str = "domicile.settings";

/// Where Chrome looks for the Settings host's manifest in `profile`, the
/// engine's `--user-data-dir`.
pub fn settings_host_manifest_path(profile: &Path) -> PathBuf {
    profile
        .join("NativeMessagingHosts")
        .join(format!("{SETTINGS_HOST}.json"))
}

/// The manifest that lets the Settings app, and only it, start `host`.
pub fn settings_host_manifest(host: &Path) -> String {
    let origin = SETTINGS
        .strip_suffix("settings.html")
        .expect("SETTINGS is the app's settings.html");
    serde_json::json!({
        "name": SETTINGS_HOST,
        "description": "Reads and writes the desktop's config for the Settings app",
        "path": host,
        "type": "stdio",
        "allowed_origins": [origin],
    })
    .to_string()
}

/// Writes the Settings host's manifest into `profile`, replacing any from an
/// earlier install.
pub fn list_the_settings_host(profile: &Path, host: &Path) -> std::io::Result<()> {
    let place = settings_host_manifest_path(profile);
    std::fs::create_dir_all(place.parent().expect("the manifest is in a directory"))?;
    std::fs::write(place, settings_host_manifest(host))
}
