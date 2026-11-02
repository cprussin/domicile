# @domicile-desktop/spelling

Fails on British spellings anywhere in the repository: prose, comments,
identifiers and filenames. See [AGENTS.md](/AGENTS.md#american-english-everywhere).

```sh
bun run turbo test:shell --filter=@domicile-desktop/spelling
```

- Its `test:shell` runs in `turbo test`.
- Never cached: it reads every tracked file.
