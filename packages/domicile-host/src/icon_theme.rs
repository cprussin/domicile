//! Icon themes: which directories to search for an icon, in order.
//!
//! Follows the icon theme spec: the theme, its `Inherits` and then `hicolor`.
//! A theme's `index.theme` says which directory suits a size. `hicolor`
//! without one is read as `<size>/<context>`, the layout applications install
//! into. `@domicile-desktop/system-apps/app-icons` does the same for shells.
//! See https://specifications.freedesktop.org/icon-theme-spec/latest/.

use std::fs;
use std::path::{Path, PathBuf};

/// The theme every theme inherits from last.
const HICOLOR: &str = "hicolor";

/// How a directory's icons scale.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DirectoryType {
    Fixed,
    Scalable,
    Threshold,
}

/// A theme directory and the icon sizes it suits.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ThemeDirectory {
    /// Relative to the theme, such as `16x16/status`.
    path: String,
    /// As directories name it: `apps`, `status` and so on.
    context: Option<String>,
    kind: DirectoryType,
    size: i64,
    scale: i64,
    min_size: i64,
    max_size: i64,
    threshold: i64,
}

/// A theme's `index.theme`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct IndexTheme {
    /// `Inherits`, in order.
    inherits: Vec<String>,
    /// `Directories`, in order.
    directories: Vec<ThemeDirectory>,
}

/// The directories to look for an icon in, best first, for drawing at `size`
/// pixels at `scale`.
///
/// Searches the theme `theme` (or `hicolor` alone), its parents and `hicolor`
/// under each of `bases`, highest priority first, in directories of
/// `contexts`. Within a theme, the directory that suits the size best comes
/// first, then the earlier listed, then the earlier base.
pub fn directories(
    bases: &[PathBuf],
    theme: Option<&str>,
    contexts: &[&str],
    (size, scale): (i64, i64),
) -> Vec<PathBuf> {
    chain(bases, theme.unwrap_or(HICOLOR))
        .into_iter()
        .flat_map(|(theme, directories)| {
            let mut suited: Vec<&ThemeDirectory> = directories
                .iter()
                .filter(|directory| {
                    directory
                        .context
                        .as_deref()
                        .is_none_or(|context| contexts.contains(&context))
                })
                .collect();
            suited.sort_by_key(|directory| directory.distance(size, scale));
            let theme = theme.as_str();
            suited
                .into_iter()
                .flat_map(|directory| {
                    bases
                        .iter()
                        .map(move |base| base.join(theme).join(&directory.path))
                })
                .filter(|dir| dir.is_dir())
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Theme `name` and the themes it inherits, depth first and each once, then
/// `hicolor`, each with its directories. A theme installed nowhere is skipped.
fn chain(bases: &[PathBuf], name: &str) -> Vec<(String, Vec<ThemeDirectory>)> {
    let mut seen = Vec::new();
    let mut themes = visit(bases, name, &mut seen);
    themes.extend(visit(bases, HICOLOR, &mut seen));
    themes
}

/// Theme `name` and its parents not yet in `seen`.
fn visit(
    bases: &[PathBuf],
    name: &str,
    seen: &mut Vec<String>,
) -> Vec<(String, Vec<ThemeDirectory>)> {
    if seen.iter().any(|known| known == name) {
        return Vec::new();
    }
    seen.push(name.to_string());
    let Some(index) = index(bases, name) else {
        return Vec::new();
    };
    let mut themes = vec![(name.to_string(), index.directories)];
    for parent in &index.inherits {
        themes.extend(visit(bases, parent, seen));
    }
    themes
}

/// Theme `name`'s first `index.theme` under `bases`, or for `hicolor` without
/// one, its layout. `None` if the theme is not installed.
fn index(bases: &[PathBuf], name: &str) -> Option<IndexTheme> {
    let read = bases
        .iter()
        .find_map(|base| fs::read_to_string(base.join(name).join("index.theme")).ok())
        .map(|text| parse(&text));
    match read {
        None if name == HICOLOR => Some(IndexTheme {
            inherits: Vec::new(),
            directories: laid_out(bases),
        }),
        read => read,
    }
}

/// `hicolor`'s `<size>/<context>` directories under `bases`, in base order and
/// then by name.
fn laid_out(bases: &[PathBuf]) -> Vec<ThemeDirectory> {
    let mut paths: Vec<String> = Vec::new();
    for base in bases {
        let mut found: Vec<String> = listed(&base.join(HICOLOR))
            .into_iter()
            .flat_map(|size| {
                let dir = base.join(HICOLOR).join(&size);
                listed(&dir)
                    .into_iter()
                    .map(move |context| format!("{size}/{context}"))
            })
            .collect();
        found.sort();
        for path in found {
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    paths.into_iter().filter_map(|path| sized(&path)).collect()
}

/// The names of the directories in `dir`. Empty for a missing directory.
fn listed(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect()
}

/// A `hicolor` directory such as `48x48/apps` or `scalable/apps`.
fn sized(path: &str) -> Option<ThemeDirectory> {
    let (size, context) = path.split_once('/')?;
    let (kind, size, min_size, max_size) = if size == "scalable" {
        (DirectoryType::Scalable, 128, 1, 512)
    } else {
        let (width, height) = size.split_once('x')?;
        let pixels: i64 = (width == height).then(|| width.parse().ok())??;
        (DirectoryType::Threshold, pixels, pixels, pixels)
    };
    Some(ThemeDirectory {
        path: path.to_string(),
        context: Some(context.to_string()),
        kind,
        size,
        scale: 1,
        min_size,
        max_size,
        threshold: 2,
    })
}

/// `text` read as an `index.theme`. A directory with no `Size` is skipped.
fn parse(text: &str) -> IndexTheme {
    let groups = groups(text);
    let key = |group: &str, key: &str| -> Option<&str> {
        groups
            .iter()
            .find(|(name, _)| name == group)
            .and_then(|(_, keys)| keys.iter().find(|(name, _)| name == key))
            .map(|(_, value)| value.as_str())
    };
    let number = |group: &str, name: &str| key(group, name).and_then(|value| value.parse().ok());
    IndexTheme {
        inherits: list(key("Icon Theme", "Inherits")),
        directories: list(key("Icon Theme", "Directories"))
            .into_iter()
            .filter_map(|path| {
                let size = number(&path, "Size")?;
                Some(ThemeDirectory {
                    context: key(&path, "Context").map(context),
                    kind: match key(&path, "Type") {
                        Some("Fixed") => DirectoryType::Fixed,
                        Some("Scalable") => DirectoryType::Scalable,
                        _ => DirectoryType::Threshold,
                    },
                    size,
                    scale: number(&path, "Scale").unwrap_or(1),
                    min_size: number(&path, "MinSize").unwrap_or(size),
                    max_size: number(&path, "MaxSize").unwrap_or(size),
                    threshold: number(&path, "Threshold").unwrap_or(2),
                    path,
                })
            })
            .collect(),
    }
}

/// Each group's keys, in order. A repeated key's first value wins.
fn groups(text: &str) -> Vec<(String, Vec<(String, String)>)> {
    let mut groups: Vec<(String, Vec<(String, String)>)> = Vec::new();
    for line in text.lines().map(str::trim) {
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|line| line.strip_suffix(']'))
        {
            groups.push((name.to_string(), Vec::new()));
        } else if let (Some((key, value)), Some((_, keys))) =
            (line.split_once('='), groups.last_mut())
        {
            let key = key.trim();
            if !keys.iter().any(|(known, _)| known == key) {
                keys.push((key.to_string(), value.trim().to_string()));
            }
        }
    }
    groups
}

/// A comma-separated list, without empty entries.
fn list(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|each| !each.is_empty())
        .map(str::to_string)
        .collect()
}

/// The directory name themes install a `Context` under.
fn context(name: &str) -> String {
    match name {
        "Applications" => "apps".to_string(),
        "International" => "intl".to_string(),
        "MimeTypes" => "mimetypes".to_string(),
        other => other.to_lowercase(),
    }
}

impl ThemeDirectory {
    /// How far this directory's icons are from `size` pixels at `scale`: 0
    /// where they suit it. The spec's `DirectorySizeDistance`.
    fn distance(&self, size: i64, scale: i64) -> i64 {
        let wanted = size * scale;
        let (low, high) = match self.kind {
            DirectoryType::Fixed => (self.size, self.size),
            DirectoryType::Scalable => (self.min_size, self.max_size),
            DirectoryType::Threshold => (self.size - self.threshold, self.size + self.threshold),
        };
        let (min, max) = match self.kind {
            DirectoryType::Fixed => (self.size, self.size),
            _ => (self.min_size, self.max_size),
        };
        if wanted < low * self.scale {
            min * self.scale - wanted
        } else if wanted > high * self.scale {
            wanted - max * self.scale
        } else {
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (path, text) in files {
            let path = dir.path().join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        dir
    }

    fn directory(kind: DirectoryType, size: i64) -> ThemeDirectory {
        ThemeDirectory {
            path: "dir".into(),
            context: None,
            kind,
            size,
            scale: 1,
            min_size: size,
            max_size: size,
            threshold: 2,
        }
    }

    mod parse {
        use super::*;

        #[test]
        fn parents_and_directories_are_read_in_order() {
            let read = parse(
                "[Icon Theme]\n\
                 Name=Papirus\n\
                 Inherits=breeze, hicolor\n\
                 Directories=16x16/status,16@2x/status,scalable/apps,nosize\n\
                 \n\
                 [16x16/status]\n\
                 Size=16\n\
                 Context=Status\n\
                 Type=Fixed\n\
                 \n\
                 [16@2x/status]\n\
                 Size=16\n\
                 Scale=2\n\
                 Context=Status\n\
                 \n\
                 [scalable/apps]\n\
                 Size=48\n\
                 MinSize=8\n\
                 MaxSize=512\n\
                 Context=Applications\n\
                 Type=Scalable\n\
                 \n\
                 [nosize]\n\
                 Context=Status\n",
            );
            assert_eq!(read.inherits, ["breeze", "hicolor"]);
            assert_eq!(
                read.directories,
                [
                    ThemeDirectory {
                        path: "16x16/status".into(),
                        context: Some("status".into()),
                        kind: DirectoryType::Fixed,
                        size: 16,
                        scale: 1,
                        min_size: 16,
                        max_size: 16,
                        threshold: 2,
                    },
                    ThemeDirectory {
                        path: "16@2x/status".into(),
                        context: Some("status".into()),
                        kind: DirectoryType::Threshold,
                        size: 16,
                        scale: 2,
                        min_size: 16,
                        max_size: 16,
                        threshold: 2,
                    },
                    ThemeDirectory {
                        path: "scalable/apps".into(),
                        context: Some("apps".into()),
                        kind: DirectoryType::Scalable,
                        size: 48,
                        scale: 1,
                        min_size: 8,
                        max_size: 512,
                        threshold: 2,
                    },
                ]
            );
        }

        #[test]
        fn the_first_of_a_repeated_key_wins() {
            let read = parse("[Icon Theme]\nInherits=breeze\nInherits=adwaita\n");
            assert_eq!(read.inherits, ["breeze"]);
        }
    }

    mod distance {
        use super::*;

        #[test]
        fn a_fixed_directory_is_as_far_as_its_size() {
            let fixed = directory(DirectoryType::Fixed, 24);
            assert_eq!(fixed.distance(22, 1), 2);
            assert_eq!(fixed.distance(24, 1), 0);
        }

        #[test]
        fn a_scalable_directory_suits_its_range() {
            let scalable = ThemeDirectory {
                min_size: 8,
                max_size: 64,
                ..directory(DirectoryType::Scalable, 48)
            };
            assert_eq!(scalable.distance(4, 1), 4);
            assert_eq!(scalable.distance(32, 1), 0);
            assert_eq!(scalable.distance(80, 1), 16);
        }

        #[test]
        fn a_threshold_directory_suits_sizes_within_its_threshold() {
            let threshold = directory(DirectoryType::Threshold, 24);
            assert_eq!(threshold.distance(21, 1), 3);
            assert_eq!(threshold.distance(22, 1), 0);
            assert_eq!(threshold.distance(27, 1), 3);
        }

        #[test]
        fn sizes_are_compared_in_pixels() {
            let doubled = ThemeDirectory {
                scale: 2,
                ..directory(DirectoryType::Fixed, 16)
            };
            assert_eq!(doubled.distance(16, 2), 0);
            assert_eq!(doubled.distance(32, 1), 0);
            assert_eq!(doubled.distance(16, 1), 16);
        }
    }

    mod directories {
        use super::*;

        const PAPIRUS: &str = "[Icon Theme]\n\
                               Inherits=breeze\n\
                               Directories=24x24/status,32x32/status,32x32/actions\n\
                               [24x24/status]\nSize=24\nContext=Status\nType=Fixed\n\
                               [32x32/status]\nSize=32\nContext=Status\nType=Fixed\n\
                               [32x32/actions]\nSize=32\nContext=Actions\nType=Fixed\n";

        const BREEZE: &str = "[Icon Theme]\n\
                              Inherits=papirus\n\
                              Directories=22x22/status\n\
                              [22x22/status]\nSize=22\nContext=Status\nType=Fixed\n";

        fn found(bases: &[PathBuf], theme: Option<&str>) -> Vec<String> {
            directories(bases, theme, &["status"], (16, 2))
                .iter()
                .map(|path| path.strip_prefix(&bases[0]).unwrap().display().to_string())
                .collect()
        }

        #[test]
        fn a_theme_comes_before_its_parents_and_hicolor_and_suiting_the_size_first() {
            let icons = tree(&[
                ("papirus/index.theme", PAPIRUS),
                ("papirus/24x24/status/.keep", ""),
                ("papirus/32x32/status/.keep", ""),
                ("papirus/32x32/actions/.keep", ""),
                ("breeze/index.theme", BREEZE),
                ("breeze/22x22/status/.keep", ""),
                ("hicolor/16x16/status/.keep", ""),
            ]);
            assert_eq!(
                found(&[icons.path().to_path_buf()], Some("papirus")),
                [
                    "papirus/32x32/status",
                    "papirus/24x24/status",
                    "breeze/22x22/status",
                    "hicolor/16x16/status",
                ]
            );
        }

        #[test]
        fn a_theme_installed_nowhere_leaves_hicolor() {
            let icons = tree(&[("hicolor/22x22/status/.keep", "")]);
            assert_eq!(
                found(&[icons.path().to_path_buf()], Some("absent")),
                ["hicolor/22x22/status"]
            );
        }

        #[test]
        fn hicolors_index_is_followed_where_it_has_one() {
            let icons = tree(&[
                (
                    "hicolor/index.theme",
                    "[Icon Theme]\nDirectories=48x48/status\n[48x48/status]\nSize=48\nContext=Status\n",
                ),
                ("hicolor/48x48/status/.keep", ""),
                ("hicolor/22x22/status/.keep", ""),
            ]);
            assert_eq!(
                found(&[icons.path().to_path_buf()], None),
                ["hicolor/48x48/status"]
            );
        }

        #[test]
        fn among_equally_suited_directories_the_earlier_base_comes_first() {
            let own = tree(&[("hicolor/22x22/status/.keep", "")]);
            let system = own.path().join("system");
            fs::create_dir_all(system.join("hicolor/22x22/status")).unwrap();
            fs::create_dir_all(system.join("hicolor/scalable/status")).unwrap();
            assert_eq!(
                found(&[own.path().to_path_buf(), system], None),
                [
                    "system/hicolor/scalable/status",
                    "hicolor/22x22/status",
                    "system/hicolor/22x22/status",
                ]
            );
        }
    }
}
