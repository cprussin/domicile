# @domicile-desktop/engine

## 0.1.0

### Minor Changes

- 40f5af3: The engine casts the desktop to Google Cast TVs: `domicile.googleCast` lists them, and casts to them and stops. `engineCast(domicile.googleCast)` in `@domicile-desktop/sdk/cast` is its backend, and the `Cast` bar item uses it, so it shows when a TV is near.
- ca86667: A shell can add a monitor with no connector, which the desk extends onto and only a capture shows, with `system(domicile).addVirtualMonitor()`. Casting to a TV extends the desk this way.

### Patch Changes

- a88ce23: The engine is a workspace package: its shell tests run in `test:shell`, and its checks against a built tree in `test:engine`.
- 901b871: The keystroke latency run divides by the display frame viz reports, not an assumed 60 Hz, and also reports `commit to present` from viz's presentation feedback. Its guard allows `commit to pixel` the probe's floor plus one frame, so a 120 Hz panel passes.
