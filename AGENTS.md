# AGENTS

Index of context files for this repo. Domicile is mixed-language, and both
languages share one package tree: `packages/*` holds the Rust crates that make
up the compositor and host (`domicile-*`) alongside the TypeScript libraries
for the chrome, and `apps/*` holds the user-facing apps. A package is a cargo
crate or a bun workspace depending on whether it carries a `Cargo.toml` or a
`package.json`. Each entry below is tagged with an authority level so its
weight is unambiguous.

## Authority levels

- **ALWAYS** — load and read in full before any work. No exceptions for size,
  urgency, familiarity, or "trivial" edits. Skipping an ALWAYS doc is a
  protocol violation, not a judgment call.
- **IF TOUCHED** — required when your change touches the topic. The decision
  is "does my change touch the topic," not "do I feel like reading this." If
  touched, load in full.
- **REFERENCE** — look up as needed during the work; not a prerequisite to
  start.

If a doc's own wording disagrees with these labels, the labels here win —
update the doc.

## Post-edit audit (non-negotiable)

After finishing edits — and before declaring a change done or opening a
PR — re-load the guideline docs that apply to what you just changed and walk
the actual diff against each rule. This is a protocol step, not a judgment
call. A change shipped without this audit is unacceptable, regardless of
size, urgency, or familiarity. "Lint and tests passed" is not a substitute:
many style rules are not lint-enforced.

**This audit runs on EVERY code change, not just the first.** It is not
enough to check compliance once when opening the PR. Every later change —
addressing review feedback, fixing CI, a follow-up tweak, a one-line
amendment — requires you to re-review which guidelines are appropriate for
*that* change and re-check *that* change against them. Which docs are in
scope can shift as the diff grows: a follow-up edit may touch a topic the
original change did not, pulling a new **IF TOUCHED** doc into scope. Redo
the "which docs apply" determination from scratch for each change; do not
assume the earlier audit still covers you.

To decide *which* docs apply, re-read the authority labels below with your
diff in hand:

- Every **ALWAYS** doc is in scope.
- Every **IF TOUCHED** doc whose topic your change actually touches is in
  scope. Be honest about "touched": if you added or modified any `if`/`else`,
  you touched control flow; if you added a hook param for testability, you
  touched testing's dependency-injection rules; if you authored a component,
  you touched React and styling; if you edited a crate, you touched Rust; etc.
- Any per-package addenda (`{package}/docs/AGENTS.md`) for packages you
  modified are in scope.

Walk each rule in scope against your actual diff. Memory is not a substitute
for re-reading.

## PR description requirement

Every PR description MUST include an explicit "Guidelines audited" line
listing the docs reviewed and confirming the change complies. Example:

> **Guidelines audited:** `docs/guidelines/CONTROL_FLOW.md`,
> `docs/guidelines/ERRORS.md`, `docs/guidelines/TESTING.md`. Change complies
> with all rules.

If a rule deserves a note (intentional deviation, ambiguous case, etc.), call
it out below the line. A PR without this line is incomplete.

## ALWAYS (every change, no exceptions)

These apply to every change you make — bug fixes, one-line changes, refactors,
and "trivial" edits included. The language-agnostic ones (TESTING, ERRORS)
govern Rust as well as TypeScript; the rest are TypeScript rules that apply to
every TS file you write or modify.

| Doc | Covers |
|---|---|
| [/docs/guidelines/TESTING.md](/docs/guidelines/TESTING.md) | **TDD is mandatory.** Failing test first, then the minimum production code to make it pass. Parsimonious coverage, unit over integration, dependency injection over mocking, never widen exports for tests, warnings are failures. |
| [/docs/guidelines/ERRORS.md](/docs/guidelines/ERRORS.md) | **Code offensively** (PR-blocker): no defensive guards, no catch-and-swallow, no silent fallbacks; throw or return a `Result`. Promise error handling (never `void promise()`). |
| [/docs/guidelines/CONTROL_FLOW.md](/docs/guidelines/CONTROL_FLOW.md) | `undefined` over `null`, explicit `undefined` checks, curly braces always, explicit control flow, ternaries, no unnecessary `let`, `switch` over `if`/`else if`. |
| [/docs/guidelines/FUNCTIONS.md](/docs/guidelines/FUNCTIONS.md) | Functional/immutable/declarative defaults, arrow syntax, docstrings, manual loops over generators. |
| [/docs/guidelines/FILES.md](/docs/guidelines/FILES.md) | File/directory organization: top-to-bottom reading order, import from defining modules, no grab-bag names, prefer module-scoped functions. |

## IF TOUCHED (load when your change touches the topic)

| Doc | Load when |
|---|---|
| [/docs/guidelines/RUST.md](/docs/guidelines/RUST.md) | You modify any crate in the cargo workspace (the `packages/domicile-*` packages). Workspace layout and the `default-members` split, required checks (`fmt`, `clippy -D warnings`, `test`), and the protocol crate's contract with the chrome SDK. |
| [/docs/guidelines/REACT.md](/docs/guidelines/REACT.md) | You author or modify a component, hook, or JSX. No `className`/`style` prop, Phosphor icon imports, wrapping `@base-ui/react`, the error-boundary contract, and never suppress `useExhaustiveDependencies`. |
| [/docs/guidelines/STYLING.md](/docs/guidelines/STYLING.md) | Any UI styling work. **Mandatory for any UI package.** Panda CSS is the only styling system; all packages extend the `@domicile/component-library` preset and use its components where possible. |
| [/docs/guidelines/ICONS.md](/docs/guidelines/ICONS.md) | You import a Phosphor icon. SSR path, `*Icon`-suffixed name, no barrel. |
| [/docs/guidelines/DATA.md](/docs/guidelines/DATA.md) | You read external data — host protocol frames, `JSON.parse`, `localStorage`, URL params, env vars. Never `as`-cast; parse with Zod. Versioning rules for contracts that cross deploy units, including the host↔chrome protocol. |
| [/docs/guidelines/DISCRIMINATED_UNIONS.md](/docs/guidelines/DISCRIMINATED_UNIONS.md) | You define or modify a discriminated union. Enum discriminant + PascalCase constructor object + type derived via `ReturnType`; the memory format always uses enums; map to wire strings in an explicit serializer/deserializer (Zod codec) at the boundary. |
| [/docs/guidelines/OPTION_RESULT.md](/docs/guidelines/OPTION_RESULT.md) | You design or modify a fallible API or a parser. When to return `Result<T, E>` / `Option<T>` from `@cprussin/option-result` instead of throwing or returning `undefined`, and how to work with them. |
| [/docs/guidelines/DESIGN_DOCS.md](/docs/guidelines/DESIGN_DOCS.md) | You author or modify a design doc in /docs/architecture/. Be concise and direct: lead with the answer, show don't describe, decisions not musings, cut filler and RFC ceremony. |

## REFERENCE

| Doc | Covers |
|---|---|
| [/docs/guidelines/WORKSPACE.md](/docs/guidelines/WORKSPACE.md) | Tools (bun, turbo, biome), workspace layout across both languages, package READMEs, dependency policy, and the required-checks workflow you run before a PR. |

## Architecture & design docs

These live in [`/docs/architecture/`](/docs/architecture/) and are **not**
guidelines — they carry no authority level and impose no rules. They describe
how a part of the system is (or will be) built. Read the relevant one when
working in its area; it is context, not compliance.

| Doc | Covers |
|---|---|
| [/docs/architecture/ARCHITECTURE.md](/docs/architecture/ARCHITECTURE.md) | Why Domicile is a compositor whose renderer is a web engine: the portal model, the host brain, the chrome protocol, and how a Wayland client becomes a styleable `<app>` element. |
| [/docs/architecture/WINDOW-COMPOSITING.md](/docs/architecture/WINDOW-COMPOSITING.md) | How native windows reach parity with an ordinary Wayland compositor: composite client dmabufs in the compositor and punch a transparent hole in the page, rather than pushing pixels through the engine. |
| [/docs/architecture/MULTI-OUTPUT.md](/docs/architecture/MULTI-OUTPUT.md) | How the desktop becomes more than one screen: displays described in the config, one `wl_output` each, and one chrome page spanning them that the shell addresses with `<Screen>`. |

[`/ROADMAP.md`](/ROADMAP.md) carries the current state and the ordered plan;
read it before starting anything substantial.

## Checking your work

```sh
./scripts/check.sh                 # everything
./scripts/check.sh rust            # or one group: shell, rust, typescript, e2e
```

That is the whole answer, and using it is not optional politeness — it is how
you find the things the unit tests cannot. It runs `fmt`, `clippy`, `cargo
test`, `biome`, `turbo test` and every `scripts/test-*.sh` and
`scripts/e2e-*.sh` there is, and it arranges what they need rather than
assuming it: a fresh worktree has no `node_modules`, Electron is not on `PATH`
under `nix develop`, and a display picked by number collides with the corpse a
previous run left behind. Each of those has cost a session an hour and
produced failures that looked like findings.

**Read a `skipped` line as loudly as a failure.** A skip means a check did not
run, which on a machine without a GPU or without Electron is a fact rather than
a verdict — but it is never evidence that the thing works. A script that cannot
run says so by exiting **77**, which is the only thing that distinguishes it
from one that ran and passed; before that existed, a green CI run reported ten
suites where nine had run.

CI adds `DOMICILE_CHECK_STRICT=1`, where a skip *is* a failure, and names the
one it expects (`DOMICILE_CHECK_ALLOW_SKIP=e2e-dmabuf`, because no runner has a
DRM render node). That pair is the point: the expected skip stays green, and a
*new* one — an Electron that vanished, a display that never came up — is fatal.

Three things this cannot reach, so do not read a green run as covering them:

- **The dmabuf import.** It needs a DRM render node; `e2e-dmabuf.sh` says so
  and stops. Everything around the import is reachable — see `dmabuf_import`'s
  own tests — and anything you put *inside* it is not covered by anything.
- **Presentation.** The pixel tests read an offscreen buffer back; no check
  puts a window on a screen.
- **Hardware timing.** `readback_ms`, `rt_ms` and the rest come off a software
  rasteriser here, which flatters some stages and punishes others. Numbers from
  this container are directional, not results.

## Per-package addenda

When working on any package in `/apps/` or `/packages/`, you MUST check for
and load package-specific agent instructions in `{package}/docs/AGENTS.md`,
if such a file exists. These hold rules specific to the package and augment —
never weaken — the root docs. On conflict, package rules win. They are
addenda-only: they do not relist root rules; assume you have already loaded
them.

DO NOT proceed with any changes until the relevant files are loaded and
understood.
