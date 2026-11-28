---
"@domicile-desktop/sdk": minor
"@domicile-desktop/e2e-harness": patch
---

`@domicile-desktop/sdk/system-message` exports the schemas of the compositor's answers to system calls (`systemReplySchema`, `systemEventSchema`, `systemEndSchema`). The e2e harness takes them from there instead of keeping its own copy, which had fallen behind: it now reads `real_path`, a cast's `preview` frame, `sent` output and the `agents` reply.
