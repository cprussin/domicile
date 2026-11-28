# @domicile-desktop/duplication

Fails when the repository defines something a second time.

```sh
bun run turbo test:shell --filter=@domicile-desktop/duplication
```

| Check | Fails on |
|---|---|
| `test-no-hand-rolled-codecs.sh` | A base64 alphabet, a `%XX` percent escape or a CRC/Adler-32 table written out in Rust or C++. Use the `base64`, `percent-encoding` and `png` crates, or `base::` in the engine. |

- Its `test:shell` runs in `turbo test`.
- Never cached: it reads every tracked file.
