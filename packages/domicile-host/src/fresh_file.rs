//! New files that never replace one already there.

use std::fs::{File, OpenOptions};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// Creates `<name>.<extension>` in `dir`, made if missing. A taken name gets
/// ` (2)`, ` (3)` and so on. Returns the path and the file, open to write.
pub fn fresh_file(dir: &Path, name: &str, extension: &str) -> std::io::Result<(PathBuf, File)> {
    std::fs::create_dir_all(dir)?;
    let mut copy = 1;
    loop {
        let path = match copy {
            1 => dir.join(format!("{name}.{extension}")),
            _ => dir.join(format!("{name} ({copy}).{extension}")),
        };
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(why) if why.kind() == ErrorKind::AlreadyExists => copy += 1,
            Err(why) => return Err(why),
        }
    }
}
