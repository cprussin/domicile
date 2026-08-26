//! The shells in this repo are shells like any other.
//!
//! They are resolved and started by exactly the machinery an out-of-tree shell
//! goes through, so nothing here is special-cased for them — which means
//! nothing catches a manifest that has drifted out of step with the compositor
//! except a check that reads the files.
//!
//! Worth having because the drift is silent and delayed: `PROTOCOL_VERSION` is
//! bumped in Rust, both halves of the wire format are updated, every test
//! passes, and the shells stop starting the next time someone runs one.

use std::path::{Path, PathBuf};

use domicile_protocol::PROTOCOL_VERSION;
use domicile_shell::{resolve, ShellManifest, MANIFEST_NAME};

use domicile_config::ShellRef;

/// Every `packages/shell-*` in this repo.
fn shipped_shells() -> Vec<PathBuf> {
    let packages = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut found: Vec<PathBuf> = std::fs::read_dir(&packages)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("shell-"))
        })
        .collect();
    found.sort();
    found
}

#[test]
fn there_are_shells_to_check() {
    // A glob that matched nothing is how a check like this goes quietly green
    // forever after a rename.
    assert!(!shipped_shells().is_empty(), "no packages/shell-* found");
}

#[test]
fn every_shipped_shell_has_a_manifest_this_compositor_can_read() {
    for package in shipped_shells() {
        let manifest = ShellManifest::load(&package).unwrap_or_else(|err| {
            panic!("{}: {err}", package.display());
        });
        assert_eq!(
            manifest.protocol,
            PROTOCOL_VERSION,
            "{}/{MANIFEST_NAME} declares protocol {} but this compositor speaks \
             {PROTOCOL_VERSION}; bumping PROTOCOL_VERSION means bumping the shells that ship with it",
            package.display(),
            manifest.protocol
        );
    }
}

#[test]
fn every_shipped_shell_resolves_by_path() {
    // The route a checkout is run through — `package = "./packages/shell-x"` —
    // as opposed to the installed one the search path serves.
    for package in shipped_shells() {
        let resolved = resolve(&ShellRef::Path(package.clone()), &[], Path::new("/nowhere"))
            .unwrap_or_else(|err| panic!("{}: {err}", package.display()));
        assert_eq!(resolved.directory, package);
    }
}

#[test]
fn a_shipped_shell_is_named_after_its_directory_suffix() {
    // `packages/` is shared with the crates, so the shells carry a `shell-`
    // prefix that is not part of their identity. The rest of the directory name
    // is: it is what `--shell simple` means, and what the install directory is
    // called once one is installed.
    for package in shipped_shells() {
        let directory = package.file_name().unwrap().to_str().unwrap();
        let manifest = ShellManifest::load(&package).unwrap();
        assert_eq!(
            format!("shell-{}", manifest.name),
            directory,
            "{} calls itself {:?}",
            package.display(),
            manifest.name
        );
    }
}

#[test]
fn a_shipped_shell_entry_points_at_its_electron_main() {
    // The manifest's `entry` decides what runs, and the thing that must run is
    // the Electron main bundle — not the renderer HTML, which is what both of
    // these said while nothing read the field.
    for package in shipped_shells() {
        let manifest = ShellManifest::load(&package).unwrap();
        assert!(
            manifest.entry.extension().is_some_and(|ext| ext == "js"),
            "{} runs {}, which is not an Electron entry point",
            package.display(),
            manifest.entry.display()
        );
    }
}
