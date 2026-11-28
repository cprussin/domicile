# @domicile-desktop/app-host-client

How an app module talks to `domicile-app-host`, the process it spawns for
what its sandbox cannot reach (the browser's history, the config files). The
protocol is `domicile_launch::app_host`'s.

| Export | What it is |
|---|---|
| `.` | `spawnedAppHost({ processes, replies, onEvent })`: starts the host on the first request and again after it ends, and gives `ask(request, wanted)`, which resolves with the reply of type `wanted` or rejects with why not. `replies` is the app's zod schema of its replies; `refused` is handled here. |
| `./frames` | `encodeFrame` and `frameDecoder`: each message is a 4-byte little-endian length, then that many bytes of UTF-8 JSON. |
| `./fake` | Fake host processes for an app's client tests: `started(spawnedHost, ask)` gives the processes it spawned, what the app wrote to each, and `answer` and `end` to drive them. |

Used by `app-history` and `app-settings`.
