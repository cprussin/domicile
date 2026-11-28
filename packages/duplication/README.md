# @domicile-desktop/duplication

Fails when the repository defines something a second time.

```sh
bun run turbo test:shell --filter=@domicile-desktop/duplication
```

| Check | Fails on |
|---|---|
| `test-no-hand-rolled-codecs.sh` | A base64 alphabet, a `%XX` percent escape or a CRC/Adler-32 table written out in Rust or C++. Use the `base64`, `percent-encoding` and `png` crates, or `base::` in the engine. |
| `test-no-new-clones.sh` | Code copied from elsewhere in TypeScript, Rust or the engine's C++, as [jscpd](https://jscpd.dev) finds it with `jscpd.json` (8 lines, 70 tokens). `clones-baseline.json` lists the clones there were when the check landed. A clone not in it fails, and so does an entry for a clone that is gone, so the list only shrinks. After folding one, run `bun run clones:baseline` here. |

- Its `test:shell` runs in `turbo test`.
- Never cached: they read every tracked file.
