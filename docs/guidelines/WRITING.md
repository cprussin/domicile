# Writing

How to write prose in this repo: docs, READMEs, code comments, Nix option
descriptions, commit messages and PR descriptions. Design docs also follow
[DESIGN_DOCS.md](DESIGN_DOCS.md). Spelling is American (see `AGENTS.md`).

## Rules

1. **Lead with the point.** The first sentence says what the thing is or does.
2. **Short, direct sentences.** Subject, verb, object. One idea per sentence.
   Present tense, active voice.
3. **Bullets over paragraphs.** Use a paragraph only for reasoning where each
   step depends on the last.
4. **Plain words.** Name things by what they are: "the compositor", "the
   shell", "the monitor". No metaphors, no personification ("a desk that
   states…", "the page is told…"), no invented jargon.
5. **Describe what is, not what was.** No history and no prior
   implementations: no "before patch N…", "used to", or "now" in contrast to a
   past state. Mention an alternative only when the tradeoff explains a
   decision a reader would otherwise question.
6. **Only what the reader needs.** Cut detail that doesn't serve the document's
   purpose. If a detail is useful but off-topic, move it to its own doc and link
   it.
7. **Say it once.** Don't restate a point in another section, and don't restate
   what the code, a table or a linked doc already says. Link instead.
8. **No filler, hedging or emphasis.** Cut "deliberately", "exactly",
   "genuinely", "essentially", "simply", "crucially", "the whole of", "it is
   worth noting", "in order to", "arguably", "should probably". No ALL-CAPS
   sentences. Bold only the term a bullet defines.
9. **No AI-isms.** Don't define a thing by what it isn't; state what it is.
   Avoid "it's not X, it's Y", "load-bearing", "the answer is…", "the one
   thing…", "which is the point", rhetorical questions, and long em-dash
   chains.
10. **Be concrete.** Real names, paths, commands and values beat descriptions
    of them.

## Code comments

- Explain why. If the code already says what, delete the comment.
- A docstring is one line saying what the item is for. Add a short second
  paragraph only for a non-obvious constraint or caller obligation.
- A module comment says what the module is for in a few lines. The design
  belongs in a doc; link it.
- No changelog in comments ("this replaced…", "until #123…").

## Other prose

- **Nix option descriptions:** one sentence on what the option does, plus its
  effect when unset if that isn't obvious.
- **Commit subjects:** imperative mood, under 72 characters. The body lists
  what changed and why, in bullets.
- **PR descriptions:** bullets of what changed and why. No narrative.

## Size

- A README: what the package is, how to use it, where to read more. Aim for
  under 50 lines.
- A design doc: per [DESIGN_DOCS.md](DESIGN_DOCS.md).
- A long doc that covers several topics is several docs.

## Example

> **Bad:** **THE EDGE IS WHAT THIS REPORTS, not the state.** Lighting a
> connector is a modeset, and a desktop that restated "be dark" on every tick —
> or "be lit" on every keystroke — would ask for one several times a second.
>
> **Good:** Returns a change only when blanking flips. Each change costs a
> modeset, so repeating the current state would modeset several times a second.

> **Bad:** A veto rather than a hand on the desk or a clock that is paused.
>
> **Good:** An idle inhibitor blocks blanking. It does not reset the idle timer.
