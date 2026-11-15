//! The apps' own schemes the engine registers as it starts, from the record
//! `electron-host` keeps of the schemes apps registered on earlier runs. See
//! "Requests" in `docs/architecture/ELECTRON-APPS.md`.
//!
//! Chromium registers schemes only as each process starts, so an app that
//! brings a new one runs on its own Electron until the next engine start.

use std::collections::BTreeMap;

use serde::Deserialize;

/// The record's file name in Domicile's state directory. Matches
/// `recordPath` in `packages/electron-host/src/main.ts`.
pub const RECORD: &str = "electron-schemes.json";

/// The engine switch the schemes go in.
const SWITCH: &str = "--domicile-electron-schemes=";

/// The privileges the engine grants, by Electron's names, in the order the
/// switch names them.
const GRANTED: [&str; 5] = [
    "standard",
    "secure",
    "bypassCSP",
    "corsEnabled",
    "supportFetchAPI",
];

/// Schemes the engine or the web gives a meaning. Matches
/// `IsElectronHandleableScheme` in
/// `components/domicile/common/electron_schemes.cc`, plus the schemes
/// Electron's Chromium already has.
const RESERVED: [&str; 22] = [
    "about",
    "blob",
    "chrome",
    "chrome-error",
    "chrome-extension",
    "chrome-native",
    "chrome-search",
    "chrome-untrusted",
    "data",
    "devtools",
    "domicile",
    "file",
    "filesystem",
    "googlechrome",
    "http",
    "https",
    "intent",
    "isolated-app",
    "javascript",
    "view-source",
    "ws",
    "wss",
];

#[derive(Deserialize)]
struct Kept {
    scheme: String,
    privileges: Vec<String>,
}

/// The engine switch registering every scheme in `record`, the text of the
/// record, or `None` when it names none. Two apps' copies of one scheme get
/// the privileges either asked for.
///
/// `electron-host` writes the record, so one it can't have written is
/// refused whole, as the engine refuses a wrong switch.
pub fn schemes_switch(record: &str) -> Result<Option<String>, String> {
    let apps: BTreeMap<String, Vec<Kept>> =
        serde_json::from_str(record).map_err(|why| why.to_string())?;
    let mut schemes: BTreeMap<String, Vec<&'static str>> = BTreeMap::new();
    for (app, kept) in &apps {
        for Kept { scheme, privileges } in kept {
            if !registrable(scheme) {
                return Err(format!("{app} keeps {scheme}:, which no app may register"));
            }
            let granted = schemes.entry(scheme.clone()).or_default();
            for privilege in privileges {
                let known = GRANTED
                    .iter()
                    .find(|known| **known == privilege)
                    .ok_or_else(|| {
                        format!(
                            "{app} keeps {privilege} for {scheme}:, which the engine doesn't grant"
                        )
                    })?;
                if !granted.contains(known) {
                    granted.push(known);
                }
            }
        }
    }
    if schemes.is_empty() {
        return Ok(None);
    }
    let entries: Vec<String> = schemes
        .into_iter()
        .map(|(scheme, granted)| {
            let ordered: Vec<&str> = GRANTED
                .into_iter()
                .filter(|privilege| granted.contains(privilege))
                .collect();
            format!("{scheme}:{}", ordered.join(","))
        })
        .collect();
    Ok(Some(format!("{SWITCH}{}", entries.join(";"))))
}

/// Whether the engine can register `scheme` for an app.
fn registrable(scheme: &str) -> bool {
    scheme.starts_with(|c: char| c.is_ascii_lowercase())
        && scheme
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "+-.".contains(c))
        && !RESERVED.contains(&scheme)
}
