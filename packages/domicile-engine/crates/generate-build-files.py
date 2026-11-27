#!/usr/bin/env python3
# Copyright 2026 Connor Prussin
# SPDX-License-Identifier: MIT
"""Writes the BUILD.gn and README.chromium of each crate CRATES names.

    python3 packages/domicile-engine/crates/generate-build-files.py [--crates DIR]

Chromium builds a crate from `third_party/rust/<crate>/<epoch>/BUILD.gn`,
which its own gnrt writes from Cargo's metadata. gnrt needs a whole Chromium
checkout, so this writes the same files from the `.crate`s themselves: it
fetches each (checking its sha256, as engine-crates.sh does), reads its
Cargo.toml, and writes under `src/third_party/rust`, where the series' tree
overlays Chromium's.

What gnrt would take from Cargo's feature resolution is `FEATURES` here: the
features each crate is built with in this graph, as Cargo would turn them on
for adblock with the features we ask of it. An optional dependency is a dep
when one of those features turns it on. A crate's build script runs only when
`BUILD_SCRIPTS` names what it writes: flatbuffers' and thiserror's only probe
for a nightly compiler, and Chromium's is not one; selectors' writes a table
it includes.
"""

import argparse
import hashlib
import json
import os
import pathlib
import sys
import tarfile
import tempfile
import tomllib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "crates" / "CRATES"
OUT = ROOT / "src" / "third_party" / "rust"
VENDOR = "//third_party/rust/chromium_crates_io/vendor"

# The features each crate is built with. adblock's are the ones the engine
# asks for: no `single-thread`, so an engine built on a worker can be used on
# the UI thread; no `embedded-domain-resolver`, so domains come from
# Chromium's registry (components/domicile/ad_blocking/domains.cc), not the
# `addr` crate's copy of the public suffix list.
FEATURES = {
    # css-validation parses procedural filters (`:has-text()`), which without
    # it are left as plain selectors no page matches.
    "adblock": [
        "css-validation",
        "cssparser",
        "full-regex-handling",
        "precomputed-hash",
        "selectors",
    ],
    "arrayvec": ["default", "std"],
    "flatbuffers": ["default", "std"],
    "idna": ["alloc", "compiled_data", "default", "std"],
    "idna_adapter": ["compiled_data"],
    "percent-encoding": ["alloc", "default", "std"],
    # selectors' FxHashMap is std's.
    "rustc-hash": ["default", "std"],
    "seahash": ["default"],
    "thiserror": [],
    "thiserror-impl": [],
    "cssparser": [],
    "cssparser-macros": [],
    "derive_more": ["add", "add_assign", "default", "std"],
    "derive_more-impl": ["add", "add_assign", "default"],
    "dtoa": [],
    "dtoa-short": [],
    "new_debug_unreachable": [],
    "phf": ["default", "macros", "phf_macros", "std"],
    "phf_codegen": [],
    "phf_generator": [],
    "phf_macros": [],
    "phf_shared": ["default", "std"],
    "precomputed-hash": [],
    "rand": ["small_rng"],
    "rand_core": [],
    "selectors": [],
    "servo_arc": ["default", "track_alloc_size"],
}

# The files a crate's source includes (`include_str!`), by crate, which GN
# must list. derive_more-impl names its docs by feature, `doc/<feature>.md`.
INPUTS = {
    "derive_more": ["README.md"],
    "derive_more-impl": ["README.md", "doc/add.md", "doc/add_assign.md"],
}

# The build scripts that run, by crate: what each writes to OUT_DIR.
BUILD_SCRIPTS = {"selectors": ["ascii_case_insensitive_html_attributes.rs"]}

# Who may depend on each: adblock is for the engine's own code; the rest only
# for other third-party crates, as gnrt writes it.
VISIBILITY = {"adblock": ["//components/domicile/*"]}

# The crates the pin already vendors that these depend on, by name: the
# directory under third_party/rust Chromium keeps each in.
CHROMIUM = {
    "base64": "base64/v0_23",
    "bitflags": "bitflags/v2",
    "icu_normalizer": "icu_normalizer/v2",
    "icu_properties": "icu_properties/v2",
    "itertools": "itertools/v0_14",
    "itoa": "itoa/v1",
    "log": "log/v0_4",
    "memchr": "memchr/v2",
    "proc-macro2": "proc_macro2/v1",
    "quote": "quote/v1",
    "regex": "regex/v1",
    "serde": "serde/v1",
    "serde_json": "serde_json/v1",
    "siphasher": "siphasher/v1",
    "smallvec": "smallvec/v1",
    "stable_deref_trait": "stable_deref_trait/v1",
    "syn": "syn/v2",
    "utf8_iter": "utf8_iter/v1",
}

HEADER = """\
# Copyright 2026 Connor Prussin
# SPDX-License-Identifier: MIT

# @generated from packages/domicile-engine/crates/CRATES by
# packages/domicile-engine/crates/generate-build-files.py, as Chromium's gnrt
# would write it. Do not edit.

import("//build/rust/cargo_crate.gni")

"""

CONFIGS = """
  #####################################################################
  # Tweaking which GN `config`s apply to this target.

  # Config changes that apply to all `//third_party/rust` crates.
  _configs_to_remove = [
    # We don't need code coverage data for any `chromium_crates_io` crates.
    "//build/config/coverage:default_coverage",

    # This is third-party code, so remove `chromium_code` config.  We are not
    # at the same time adding `//build/config/compiler:no_chromium_code`,
    # because 1) we don't want to pull how warnings are handled by that config
    # and 2) that config doesn't have any non-warnings-related stuff.
    "//build/config/compiler:chromium_code",
  ]

  library_configs -= _configs_to_remove
  executable_configs -= _configs_to_remove
  proc_macro_configs -= _configs_to_remove
}
"""


def read_manifest():
    crates = []
    for line in MANIFEST.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        name, version, directory, sha256 = line.split()
        crates.append(
            {"name": name, "version": version, "dir": directory, "sha256": sha256}
        )
    return crates


def gn_dir(name, directory):
    """third_party/rust's directory for a crate: `adblock/v0_13`."""
    epoch = directory.rsplit("-", 1)[1]
    return "%s/%s" % (name.replace("-", "_"), epoch)


def epoch_of(directory):
    """gnrt's epoch: `0.13` for `v0_13`, `1` for `v1`."""
    return directory.rsplit("-", 1)[1][1:].replace("_", ".")


def fetch(crate, into):
    """The crate's unpacked directory, after checking its sum."""
    url = "https://static.crates.io/crates/{0}/{0}-{1}.crate".format(
        crate["name"], crate["version"]
    )
    data = urllib.request.urlopen(url).read()
    got = hashlib.sha256(data).hexdigest()
    if got != crate["sha256"]:
        sys.exit(
            "%s-%s.crate has sha256 %s; CRATES says %s"
            % (crate["name"], crate["version"], got, crate["sha256"])
        )
    path = into / ("%s.crate" % crate["name"])
    path.write_bytes(data)
    with tarfile.open(path) as archive:
        archive.extractall(into, filter="data")
    return into / ("%s-%s" % (crate["name"], crate["version"]))


def gn_list(values, indent="  "):
    if not values:
        return "[]"
    if len(values) == 1 and len(values[0]) < 60:
        return '[ "%s" ]' % values[0]
    inner = "".join('%s  "%s",\n' % (indent, value) for value in values)
    return "[\n%s%s]" % (inner, indent)


def gn_string(value):
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$")


def enabled_optional(cargo, features):
    """The optional dependencies `features` turn on, by their key."""
    table = cargo.get("features", {})
    seen, todo, deps = set(), list(features), set()
    while todo:
        feature = todo.pop()
        if feature in seen:
            continue
        seen.add(feature)
        for item in table.get(feature, []):
            name = item.split("/", 1)[0].rstrip("?")
            if name.startswith("dep:"):
                deps.add(name[4:])
            elif name in table:
                todo.append(name)
            else:
                deps.add(name)
        # A feature named after an optional dependency, Cargo's implicit one.
        deps.add(feature)
    return deps


def deps_of(cargo, crate, ours, table="dependencies"):
    """The GN labels of a crate's `table` dependencies: the non-optional ones
    and those its FEATURES turn on."""
    enabled = enabled_optional(cargo, FEATURES[crate["name"]])
    labels = []
    for key, spec in sorted(cargo.get(table, {}).items()):
        if isinstance(spec, dict) and spec.get("optional") and key not in enabled:
            continue
        name = spec.get("package", key) if isinstance(spec, dict) else key
        if name in ours:
            labels.append("//third_party/rust/%s:lib" % ours[name])
        elif name in CHROMIUM:
            labels.append("//third_party/rust/%s:lib" % CHROMIUM[name])
        else:
            sys.exit(
                "%s depends on %s, which neither CRATES nor CHROMIUM names"
                % (crate["name"], name)
            )
    return labels


def build_gn(crate, source, ours):
    cargo = tomllib.loads((source / "Cargo.toml").read_text())
    package = cargo["package"]
    lib = cargo.get("lib", {})
    root = lib.get("path", "src/lib.rs")
    vendored = "%s/%s" % (VENDOR, crate["dir"])
    # selectors keeps its library at the crate's root, not in src/.
    tree = source / "src" if root.startswith("src/") else source
    skip = ("tests", "benches", "examples")
    sources = sorted(
        "%s/%s" % (vendored, path.relative_to(source).as_posix())
        for path in tree.rglob("*.rs")
        if path.relative_to(source).parts[0] not in skip
        and path.relative_to(source).as_posix() != "build.rs"
    )
    kind = "proc-macro" if lib.get("proc-macro") else "rlib"
    authors = ", ".join(package.get("authors", []))
    text = HEADER
    text += 'cargo_crate("lib") {\n'
    text += '  crate_name = "%s"\n' % lib.get("name", crate["name"].replace("-", "_"))
    text += '  epoch = "%s"\n' % epoch_of(crate["dir"])
    text += '  crate_type = "%s"\n' % kind
    text += '  crate_root = "%s/%s"\n' % (vendored, root)
    text += "  sources = %s\n" % gn_list(sources)
    inputs = ["%s/%s" % (vendored, name) for name in INPUTS.get(crate["name"], [])]
    text += "  inputs = %s\n\n" % gn_list(inputs)
    text += "  build_native_rust_unit_tests = false\n"
    text += '  edition = "%s"\n' % package.get("edition", "2015")
    text += '  cargo_pkg_authors = "%s"\n' % gn_string(authors)
    text += '  cargo_pkg_name = "%s"\n' % crate["name"]
    text += '  cargo_pkg_description = "%s"\n' % gn_string(
        package.get("description", "").strip()
    )
    text += '  cargo_pkg_repository = "%s"\n' % package.get("repository", "")
    text += '  cargo_pkg_version = "%s"\n\n' % crate["version"]
    text += "  allow_unsafe = true\n\n"
    deps = deps_of(cargo, crate, ours)
    if deps:
        text += "  deps = %s\n" % gn_list(deps)
    outputs = BUILD_SCRIPTS.get(crate["name"])
    if outputs:
        build = "%s/%s" % (vendored, package.get("build", "build.rs"))
        text += '  build_root = "%s"\n' % build
        text += "  build_sources = %s\n" % gn_list([build])
        build_deps = deps_of(cargo, crate, ours, "build-dependencies")
        if build_deps:
            text += "  build_deps = %s\n" % gn_list(build_deps)
        text += "  build_script_outputs = %s\n" % gn_list(outputs)
    features = FEATURES[crate["name"]]
    if features:
        text += "  features = %s\n" % gn_list(features)
    visibility = VISIBILITY.get(crate["name"], ["//third_party/rust/*"])
    text += "\n  visibility = %s\n" % gn_list(visibility)
    text += CONFIGS
    return text


def license_files(source):
    return sorted(
        path.name
        for path in source.iterdir()
        if path.name.upper().startswith(("LICENSE", "COPYING"))
    )


def readme(crate, source):
    cargo = tomllib.loads((source / "Cargo.toml").read_text())
    package = cargo["package"]
    vcs = source / ".cargo_vcs_info.json"
    revision = json.loads(vcs.read_text())["git"]["sha1"] if vcs.exists() else ""
    files = license_files(source)
    if files:
        licensed = ", ".join(
            "%s/%s/%s" % (VENDOR, crate["dir"], name) for name in files
        )
    else:
        # The .crate carries none; the series keeps the text beside BUILD.gn.
        licensed = "//third_party/rust/%s/LICENSE" % gn_dir(
            crate["name"], crate["dir"]
        )
    lines = [
        "Name: %s" % crate["name"],
        "URL: https://crates.io/crates/%s" % crate["name"],
        "Version: %s" % crate["version"],
        "Revision: %s" % revision,
        "Update Mechanism: Manual (packages/domicile-engine/crates/CRATES)",
        "License: %s" % package.get("license", ""),
        "License File: %s" % licensed,
        "Shipped: yes",
        "Security Critical: yes",
        "",
        "Description: %s" % " ".join(package.get("description", "").split()),
    ]
    return "\n".join(lines) + "\n", not files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--crates",
        type=pathlib.Path,
        help="a directory the .crate files are already unpacked in",
    )
    arguments = parser.parse_args()
    crates = read_manifest()
    ours = {crate["name"]: gn_dir(crate["name"], crate["dir"]) for crate in crates}
    missing_license = []
    with tempfile.TemporaryDirectory() as work:
        for crate in crates:
            if arguments.crates is not None:
                source = arguments.crates / ("%s-%s" % (crate["name"], crate["version"]))
            else:
                source = fetch(crate, pathlib.Path(work))
            target = OUT / ours[crate["name"]]
            target.mkdir(parents=True, exist_ok=True)
            (target / "BUILD.gn").write_text(build_gn(crate, source, ours))
            text, needs_license = readme(crate, source)
            (target / "README.chromium").write_text(text)
            if needs_license and not (target / "LICENSE").exists():
                missing_license.append(str(target / "LICENSE"))
            print("%s: %s %s" % (ours[crate["name"]], crate["name"], crate["version"]))
    if missing_license:
        sys.exit(
            "these crates ship no license file; put the license's text at: %s"
            % ", ".join(missing_license)
        )


if __name__ == "__main__":
    main()
