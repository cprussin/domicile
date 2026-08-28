# Rust

Rules for the cargo crates in `/packages`. They share that directory with the
TypeScript packages: a package is a crate when it carries a `Cargo.toml`. The
TypeScript rules in the other
guideline docs do not apply here, but their *spirit* does: the TDD mandate in
[/docs/guidelines/TESTING.md](/docs/guidelines/TESTING.md) and the offensive
error handling in [/docs/guidelines/ERRORS.md](/docs/guidelines/ERRORS.md) are
language-agnostic and govern Rust changes too.

## Workspace layout

Crates are members of the workspace declared in the root `Cargo.toml`, which
is what makes `packages/domicile-config` a crate and `packages/chrome-sdk` a
bun workspace despite sitting side by side. Shared
metadata (`version`, `edition`, `license`, `rust-version`) lives in
`[workspace.package]` and each crate inherits it with `field.workspace = true`;
shared dependency versions live in `[workspace.dependencies]`. Adding a crate
means adding it to `members`, and — unless it needs the heavy native
toolchain — to `default-members`.

`domicile-compositor` is deliberately **excluded** from `default-members`: it
pulls Smithay and the native Wayland libraries, so a plain `cargo test` in the
core shell stays fast and Smithay-free. Build and test it explicitly:

```sh
nix develop .#full -c cargo build -p domicile-compositor
nix develop .#full -c cargo test -p domicile-compositor
```

Keep that split intact. A new crate that needs GPU, Wayland, or CEF belongs
outside `default-members` with a comment saying why.

### A test that needs another crate's binary owns the target

`domicile-compositor`'s integration tests start a real Wayland client, and the
client is `domicile-test-client` — a separate crate, so that its command line
can be tested in the core shell without Smithay. Cargo builds every **binary**
of the package under test before running that package's tests, and has no
stable way to depend on another package's binary (`artifact = "bin"` is still
`-Z bindeps`). So the `domicile-test-client` executable is declared as a
`[[bin]]` of `domicile-compositor`, whose source is one line calling
`domicile_test_client::run`; the client's own crate is a library.

That is what makes `cargo test -p domicile-compositor` work on a clean tree.
Before it, whether those tests passed depended on which cargo command had run
before them — `cargo test --workspace` left a client behind and
`cargo test -p domicile-compositor` did not — and the fixture had to assert the
binary existed and name the command to produce it.

Do the same for the next test that needs a binary from elsewhere: put the
`[[bin]]` on the package whose tests spawn it and keep the code in the crate it
belongs to. Do not reach for a `build.rs` that shells out to cargo — cargo
holds a lock on the target directory while tests run, and a test that invokes
it deadlocks.

## Required checks

Every Rust change must pass, in the core shell:

```sh
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
```

and, when it touches `domicile-compositor`, the same three under
`nix develop .#full` with `-p domicile-compositor`.

**Warnings are failures.** Clippy runs with `-D warnings` in CI; do not merge
a change that only passes because a lint is allowed locally. Reach for
`#[allow(...)]` only with a comment justifying it at the site.

## Test-driven, like everything else

The TDD cycle in [/docs/guidelines/TESTING.md](/docs/guidelines/TESTING.md) is
not TypeScript-specific: write the failing test first, watch it fail for the
right reason, then write the minimum code to pass. The core crates
(`domicile-config`, `domicile-scene`, `domicile-protocol`, `domicile-host`,
`domicile-bridge`) are pure logic precisely so this stays cheap — keep new
logic on that side of the line and out of the Smithay backend wherever the
choice exists.

Unit tests live in the crate they test; cross-module behaviour goes in
`tests/`. The end-to-end scripts in `/scripts` cover what unit tests cannot —
a real Wayland client talking to a real compositor — and are not a substitute
for either.

## The protocol crate is half of a contract

`packages/domicile-protocol` and `@domicile/chrome-sdk/protocol` describe the
same wire format from opposite sides. A change to either is a change to both,
in the same PR. Do **not** bump `PROTOCOL_VERSION` for it: the constant is
pinned at 1 while nothing ships the two halves apart, and its own docs say what
would change that — see also the versioning rules in
[/docs/guidelines/DATA.md](/docs/guidelines/DATA.md). Keep the crate
dependency-light (serde only) so it stays a clean, portable description of the
protocol.
