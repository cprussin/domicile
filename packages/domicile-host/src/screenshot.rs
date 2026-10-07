//! What the Screenshot portal does with a frame of the desk: crop it, read a
//! color from it, and save it as a PNG under the user's pictures.
//!
//! Frames are premultiplied `Bgra`, rows packed, as the compositor composes
//! them. See `docs/PORTALS.md`.

use std::fs::OpenOptions;
use std::io::{ErrorKind, Write as _};
use std::path::{Path, PathBuf};

use domicile_protocol::ShotRect;

/// A frame of the desk: premultiplied `Bgra`, rows packed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shot {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

/// When a screenshot was taken, in local time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Taken {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

/// `area` of `shot`. The caller keeps `area` inside the shot.
pub fn crop(shot: &Shot, area: ShotRect) -> Shot {
    let row = shot.width as usize * 4;
    let (left, width) = (area.x as usize * 4, area.width as usize * 4);
    let bgra = (area.y..area.y + area.height)
        .flat_map(|y| {
            let start = y as usize * row + left;
            &shot.bgra[start..start + width]
        })
        .copied()
        .collect();
    Shot {
        width: area.width,
        height: area.height,
        bgra,
    }
}

/// The color of pixel (`x`, `y`) as sRGB red, green and blue from 0 to 1.
/// A transparent pixel, off every monitor, is black.
pub fn color_at(shot: &Shot, x: u32, y: u32) -> (f64, f64, f64) {
    let at = (y as usize * shot.width as usize + x as usize) * 4;
    let [blue, green, red, alpha] = [0, 1, 2, 3].map(|i| f64::from(shot.bgra[at + i]));
    let straight = |channel: f64| {
        if alpha == 0.0 {
            0.0
        } else {
            (channel / alpha).min(1.0)
        }
    };
    (straight(red), straight(green), straight(blue))
}

/// `shot` as a PNG, in straight (not premultiplied) RGBA.
pub fn encode(shot: &Shot) -> Vec<u8> {
    let rgba: Vec<u8> =
        shot.bgra
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|&[blue, green, red, alpha]| {
                let straight = |channel: u8| match alpha {
                    0 => 0,
                    255 => channel,
                    _ => ((u32::from(channel) * 255 + u32::from(alpha) / 2) / u32::from(alpha))
                        .min(255) as u8,
                };
                [straight(red), straight(green), straight(blue), alpha]
            })
            .collect();
    let mut bytes = Vec::new();
    let mut encoder = ::png::Encoder::new(&mut bytes, shot.width, shot.height);
    encoder.set_color(::png::ColorType::Rgba);
    encoder.set_depth(::png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .expect("a PNG header writes to memory");
    writer
        .write_image_data(&rgba)
        .expect("a shot is as many pixels as its size");
    writer.finish().expect("a PNG finishes in memory");
    bytes
}

/// `Screenshots` in the pictures folder `user_dirs` (the contents of
/// `user-dirs.dirs`) names, else in `~/Pictures`.
pub fn screenshots_dir(user_dirs: Option<&str>, home: &Path) -> PathBuf {
    let named = user_dirs.and_then(|dirs| {
        dirs.lines().find_map(|line| {
            let value = line.trim().strip_prefix("XDG_PICTURES_DIR=")?;
            let value = value.trim_matches('"');
            Some(match value.strip_prefix("$HOME") {
                Some(rest) => home.join(rest.trim_start_matches('/')),
                None => PathBuf::from(value),
            })
        })
    });
    named
        .unwrap_or_else(|| home.join("Pictures"))
        .join("Screenshots")
}

/// A screenshot's file name, without its extension.
pub fn file_name(taken: Taken) -> String {
    format!(
        "Screenshot from {:04}-{:02}-{:02} {:02}-{:02}-{:02}",
        taken.year, taken.month, taken.day, taken.hour, taken.minute, taken.second
    )
}

/// Writes `bytes` to `<name>.png` in `dir`, made if missing. A taken name gets
/// ` (2)`, ` (3)` and so on. Returns the path written.
pub fn save(dir: &Path, name: &str, bytes: &[u8]) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let mut copy = 1;
    loop {
        let path = match copy {
            1 => dir.join(format!("{name}.png")),
            _ => dir.join(format!("{name} ({copy}).png")),
        };
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(bytes)?;
                return Ok(path);
            }
            Err(why) if why.kind() == ErrorKind::AlreadyExists => copy += 1,
            Err(why) => return Err(why),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    /// A 2x2 shot whose pixels are numbered in their blue byte.
    fn numbered() -> Shot {
        Shot {
            width: 2,
            height: 2,
            bgra: [
                [0, 0, 0, 255],
                [1, 0, 0, 255],
                [2, 0, 0, 255],
                [3, 0, 0, 255],
            ]
            .concat(),
        }
    }

    #[test]
    fn a_crop_keeps_the_rows_and_columns_inside_it() {
        let cropped = crop(
            &numbered(),
            ShotRect {
                x: 1,
                y: 0,
                width: 1,
                height: 2,
            },
        );

        assert_eq!(
            cropped,
            Shot {
                width: 1,
                height: 2,
                bgra: [[1, 0, 0, 255], [3, 0, 0, 255]].concat(),
            }
        );
    }

    #[test]
    fn a_color_is_srgb_from_zero_to_one_without_premultiplied_alpha() {
        let shot = Shot {
            width: 2,
            height: 1,
            bgra: [[0, 51, 255, 255], [0, 64, 128, 128]].concat(),
        };

        assert_eq!(color_at(&shot, 0, 0), (1.0, 0.2, 0.0));
        assert_eq!(color_at(&shot, 1, 0), (1.0, 0.5, 0.0));
    }

    #[test]
    fn a_transparent_pixel_is_black() {
        let shot = Shot {
            width: 1,
            height: 1,
            bgra: vec![0; 4],
        };

        assert_eq!(color_at(&shot, 0, 0), (0.0, 0.0, 0.0));
    }

    #[test]
    fn a_png_holds_the_shot_as_straight_rgba() {
        let shot = Shot {
            width: 2,
            height: 1,
            bgra: [[0, 51, 255, 255], [0, 64, 128, 128]].concat(),
        };

        let decoder = ::png::Decoder::new(std::io::Cursor::new(encode(&shot)));
        let mut reader = decoder.read_info().expect("a PNG");
        let mut pixels = vec![0; reader.output_buffer_size().expect("a size")];
        let info = reader.next_frame(&mut pixels).expect("a frame");

        assert_eq!((info.width, info.height), (2, 1));
        assert_eq!(info.color_type, ::png::ColorType::Rgba);
        assert_eq!(pixels, [[255, 51, 0, 255], [255, 128, 0, 128]].concat());
    }

    #[test]
    fn screenshots_go_in_the_pictures_folder_user_dirs_names() {
        let home = Path::new("/home/me");
        let dirs = "# written by xdg-user-dirs-update\nXDG_DESKTOP_DIR=\"$HOME/Desktop\"\nXDG_PICTURES_DIR=\"$HOME/Images\"\n";

        assert_eq!(
            screenshots_dir(Some(dirs), home),
            Path::new("/home/me/Images/Screenshots")
        );
        assert_eq!(
            screenshots_dir(Some("XDG_PICTURES_DIR=\"/srv/pictures\""), home),
            Path::new("/srv/pictures/Screenshots")
        );
    }

    #[test]
    fn without_user_dirs_screenshots_go_in_home_pictures() {
        let home = Path::new("/home/me");

        assert_eq!(
            screenshots_dir(None, home),
            Path::new("/home/me/Pictures/Screenshots")
        );
        assert_eq!(
            screenshots_dir(Some("XDG_MUSIC_DIR=\"$HOME/Music\""), home),
            Path::new("/home/me/Pictures/Screenshots")
        );
    }

    #[test]
    fn a_screenshot_is_named_for_when_it_was_taken() {
        assert_eq!(
            file_name(Taken {
                year: 2026,
                month: 10,
                day: 7,
                hour: 9,
                minute: 5,
                second: 3,
            }),
            "Screenshot from 2026-10-07 09-05-03"
        );
    }

    #[test]
    fn a_save_makes_the_folder_and_never_overwrites() {
        let home = tempfile::tempdir().expect("a temporary directory");
        let dir = home.path().join("Pictures/Screenshots");

        let first = save(&dir, "Shot", b"one").expect("saved");
        let second = save(&dir, "Shot", b"two").expect("saved");

        assert_eq!(first, dir.join("Shot.png"));
        assert_eq!(second, dir.join("Shot (2).png"));
        assert_eq!(std::fs::read(first).expect("written"), b"one");
        assert_eq!(std::fs::read(second).expect("written"), b"two");
    }
}
