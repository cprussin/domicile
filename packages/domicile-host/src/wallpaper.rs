//! The pictures applications set through the Wallpaper portal.
//!
//! Each picture is copied into the state directory, so it outlives the
//! application's own file, and the choice is kept in `wallpaper.json` there,
//! so it outlives the compositor. The shell reads the copies by path. See
//! `docs/architecture/PORTALS.md`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use domicile_protocol::{PortalWallpaper, WallpaperTarget};

/// The record of what is set, in the store's directory.
const RECORD: &str = "wallpaper.json";

/// The pictures set, and where their copies live.
#[derive(Debug)]
pub struct Wallpapers {
    dir: PathBuf,
    chosen: PortalWallpaper,
}

impl Wallpapers {
    /// The store in `dir`. Nothing is set when it has no record yet.
    pub fn load(dir: PathBuf) -> io::Result<Self> {
        let chosen = match fs::read(dir.join(RECORD)) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => PortalWallpaper::default(),
            Err(error) => return Err(error),
        };
        Ok(Wallpapers { dir, chosen })
    }

    /// A store in `dir` with nothing set, whatever its record says. The next
    /// picture set replaces the record.
    pub fn empty(dir: PathBuf) -> Self {
        Wallpapers {
            dir,
            chosen: PortalWallpaper::default(),
        }
    }

    pub fn chosen(&self) -> &PortalWallpaper {
        &self.chosen
    }

    /// Copy `picture` in and set it on `target`. `stamp` names the copy, so a
    /// new picture has a new path and the shell reads it again. Copies no
    /// longer set are removed.
    pub fn set(
        &mut self,
        target: WallpaperTarget,
        picture: &Path,
        stamp: u64,
    ) -> io::Result<&PortalWallpaper> {
        fs::create_dir_all(&self.dir)?;
        let name = match picture.extension() {
            Some(extension) => format!("{}-{stamp}.{}", slot(target), extension.to_string_lossy()),
            None => format!("{}-{stamp}", slot(target)),
        };
        let copy = self.dir.join(name);
        fs::copy(picture, &copy)?;
        let copy = Some(copy.to_string_lossy().into_owned());
        let mut chosen = self.chosen.clone();
        match target {
            WallpaperTarget::Background => chosen.background = copy,
            WallpaperTarget::Lockscreen => chosen.lockscreen = copy,
            WallpaperTarget::Both => {
                chosen.background = copy.clone();
                chosen.lockscreen = copy;
            }
        }
        let record = serde_json::to_vec(&chosen)?;
        write_atomically(&self.dir.join(RECORD), &record)?;
        let replaced = [&self.chosen.background, &self.chosen.lockscreen];
        for old in replaced.into_iter().flatten() {
            let kept = [&chosen.background, &chosen.lockscreen]
                .into_iter()
                .flatten()
                .any(|kept| kept == old);
            if !kept {
                fs::remove_file(old)?;
            }
        }
        self.chosen = chosen;
        Ok(&self.chosen)
    }
}

/// The local file a `file://` URI names, or `None` for any other URI.
pub fn local_path(uri: &str) -> Option<PathBuf> {
    let path = uri.strip_prefix("file://")?;
    // `file://host/path` names another machine; only `file:///` is local.
    if !path.starts_with('/') {
        return None;
    }
    percent_decoded(path).map(PathBuf::from)
}

/// The prefix a copy for `target` is named with.
fn slot(target: WallpaperTarget) -> &'static str {
    match target {
        WallpaperTarget::Background => "background",
        WallpaperTarget::Lockscreen => "lockscreen",
        WallpaperTarget::Both => "both",
    }
}

/// Write beside `path` and rename over it, so a crash never leaves half a
/// record.
fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let partial = path.with_extension("json.partial");
    fs::write(&partial, bytes)?;
    fs::rename(partial, path)
}

/// `text` with its `%XX` escapes decoded, or `None` when one is malformed or
/// the result is not UTF-8.
fn percent_decoded(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let hex = std::str::from_utf8(bytes.get(at + 1..at + 3)?).ok()?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            at += 3;
        } else {
            decoded.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, bytes).expect("the picture is written");
        path
    }

    #[test]
    fn a_store_never_written_has_nothing_set() {
        let state = tempfile::tempdir().expect("a directory");

        let store = Wallpapers::load(state.path().join("wallpaper")).expect("it loads");

        assert_eq!(store.chosen(), &PortalWallpaper::default());
    }

    #[test]
    fn a_picture_is_copied_in_and_remembered() {
        let state = tempfile::tempdir().expect("a directory");
        let dir = state.path().join("wallpaper");
        let sky = picture(state.path(), "sky.jpg", b"sky");
        let mut store = Wallpapers::load(dir.clone()).expect("it loads");

        let chosen = store
            .set(WallpaperTarget::Background, &sky, 7)
            .expect("it is set")
            .clone();
        fs::remove_file(&sky).expect("the application's file goes");

        let copy = dir.join("background-7.jpg");
        assert_eq!(
            chosen,
            PortalWallpaper {
                background: Some(copy.to_string_lossy().into_owned()),
                lockscreen: None,
            }
        );
        assert_eq!(fs::read(&copy).expect("the copy stays"), b"sky");
        assert_eq!(
            Wallpapers::load(dir).expect("it loads").chosen(),
            &chosen,
            "the choice outlives the compositor"
        );
    }

    #[test]
    fn a_copy_goes_once_nothing_shows_it() {
        let state = tempfile::tempdir().expect("a directory");
        let dir = state.path().join("wallpaper");
        let mut store = Wallpapers::load(dir.clone()).expect("it loads");
        let sky = picture(state.path(), "sky.jpg", b"sky");
        let sea = picture(state.path(), "sea.png", b"sea");
        let moon = picture(state.path(), "moon.png", b"moon");

        store
            .set(WallpaperTarget::Both, &sky, 1)
            .expect("it is set");
        store
            .set(WallpaperTarget::Background, &sea, 2)
            .expect("it is set");
        assert!(
            dir.join("both-1.jpg").exists(),
            "the lock screen still shows it"
        );

        store
            .set(WallpaperTarget::Lockscreen, &moon, 3)
            .expect("it is set");
        assert!(!dir.join("both-1.jpg").exists());
        assert!(dir.join("background-2.png").exists());
    }

    #[test]
    fn only_a_local_file_uri_is_a_path() {
        assert_eq!(
            local_path("file:///home/u/My%20Pictures/sky.jpg"),
            Some(PathBuf::from("/home/u/My Pictures/sky.jpg"))
        );
        assert_eq!(local_path("file://elsewhere/sky.jpg"), None);
        assert_eq!(local_path("https://example.com/sky.jpg"), None);
        assert_eq!(local_path("file:///bad%2"), None);
    }
}
