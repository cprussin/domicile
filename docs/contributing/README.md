# Contributing

How to work on Domicile itself. To write a shell or an app on it, see
[WRITING-A-SHELL.md](../WRITING-A-SHELL.md) instead.

- [AGENTS.md](/AGENTS.md): the rules every change follows, and which
  guideline applies to what.
- [DEVELOPING.md](DEVELOPING.md): running, testing and debugging from a
  checkout.
- [COMPOSITOR-DEBUGGING.md](COMPOSITOR-DEBUGGING.md): the compositor's frame
  report, slow launches and rendering pitfalls.
- [RELEASING.md](RELEASING.md): branches, versions and cutting a release.
- [HARDWARE-CHECKS.md](../HARDWARE-CHECKS.md): checks that need a lit panel.
- [guidelines/](../guidelines/): code, tests, styling and writing.
- [architecture/](../architecture/): design docs. Start with
  [ARCHITECTURE.md](../architecture/ARCHITECTURE.md).

## Built with AI

Domicile is developed with extensive help from Claude, Anthropic's AI model.

- **Claude** writes most of the code, tests and docs, debugs, and builds the
  development tooling. Its commits carry a `Co-Authored-By: Claude` trailer.
- **The maintainer** sets the architecture and direction, makes the technical
  decisions, and uses the desktop every day.
- **Review:** changes are checked by the test suite, CI and daily use, not by
  line-by-line human review.
- [AGENTS.md](/AGENTS.md) holds the rules every change follows, whoever writes
  it.
