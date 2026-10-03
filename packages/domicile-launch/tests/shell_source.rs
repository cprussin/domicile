//! What a shell argument names: a module, an entry, Domicile's own, or a
//! package.

use std::path::{Path, PathBuf};

use domicile_launch::shell_path::{Shell, ShellPathError};
use domicile_launch::shell_source::{imports_a_package, shell_source, ShellSource};

const HERE: &str = "/home/me/desk";

fn source(argument: &str, files: &[(&str, &str)]) -> Result<ShellSource, ShellPathError> {
    let files: Vec<(PathBuf, String)> = files
        .iter()
        .map(|(path, text)| (PathBuf::from(path), text.to_string()))
        .collect();
    shell_source(
        argument,
        None,
        Path::new(HERE),
        Some(Path::new("/home/me")),
        &|path| files.iter().any(|(file, _)| file == path).then_some(false),
        &|path| {
            files
                .iter()
                .find(|(file, _)| file == path)
                .map(|(_, text)| text.clone())
        },
    )
}

#[test]
fn domicile_s_own_shells_are_named_and_never_built() {
    assert_eq!(
        source("@domicile-desktop/manganese", &[]),
        Ok(ShellSource::Ours("manganese".into()))
    );
}

#[test]
fn a_bundle_is_served_as_it_is() {
    assert_eq!(
        source(
            "./dist/shell.js",
            &[(
                "/home/me/desk/dist/shell.js",
                r#"import{a}from"./chunk.js";export{a as Shell}"#
            )]
        ),
        Ok(ShellSource::Module(Shell {
            root: "/home/me/desk/dist".into(),
            module: "shell.js".into(),
        }))
    );
}

#[test]
fn typescript_is_built() {
    assert_eq!(
        source("domicile.tsx", &[("/home/me/desk/domicile.tsx", "")]),
        Ok(ShellSource::Entry("/home/me/desk/domicile.tsx".into()))
    );
}

#[test]
fn javascript_that_imports_a_package_is_built() {
    assert_eq!(
        source(
            "./entry.js",
            &[(
                "/home/me/desk/entry.js",
                r#"import { runManganese } from "@domicile-desktop/manganese";"#
            )]
        ),
        Ok(ShellSource::Entry("/home/me/desk/entry.js".into()))
    );
}

#[test]
fn a_package_or_a_repository_is_installed() {
    assert_eq!(
        source("github:cprussin/my-cool-shell", &[]),
        Ok(ShellSource::Package("github:cprussin/my-cool-shell".into()))
    );
    assert_eq!(
        source("my-cool-shell", &[]),
        Ok(ShellSource::Package("my-cool-shell".into()))
    );
    assert_eq!(
        source("@someone/shell", &[]),
        Ok(ShellSource::Package("@someone/shell".into()))
    );
}

#[test]
fn a_word_that_is_a_file_where_it_was_typed_is_the_file() {
    assert_eq!(
        source(
            "shell.js",
            &[("/home/me/desk/shell.js", "export const Shell = () => {};")]
        ),
        Ok(ShellSource::Module(Shell {
            root: "/home/me/desk".into(),
            module: "shell.js".into(),
        }))
    );
}

#[test]
fn a_packaged_desktop_s_module_is_its_own() {
    // The wrapper hands the module over and passes its name: the name is
    // never a package.
    assert_eq!(
        shell_source(
            "manganese",
            Some("/nix/store/x-page/shell.js"),
            Path::new(HERE),
            None,
            &|path| (path == Path::new("/nix/store/x-page/shell.js")).then_some(false),
            &|_| Some(String::new()),
        ),
        Ok(ShellSource::Module(Shell {
            root: "/nix/store/x-page".into(),
            module: "shell.js".into(),
        }))
    );
}

#[test]
fn only_a_bare_specifier_is_a_package_import() {
    assert!(imports_a_package(r#"import x from "zod";"#));
    assert!(imports_a_package("import 'react';"));
    assert!(imports_a_package(r#"const m = await import("date-fns");"#));
    assert!(!imports_a_package(
        r#"import x from "./x.js"; import y from "/y.js";"#
    ));
    assert!(!imports_a_package(r#"import x from "https://esm.sh/zod";"#));
    assert!(!imports_a_package("export const importance = 1;"));
}
