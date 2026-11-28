# @domicile-desktop/story-harness

What the Storybook harnesses (`motion-harness`, `popover-harness`) share:

- `./storybook-config`: `storybookConfig(extra)`, a package's whole `.storybook/main.ts`. component-library's uses it too.
- `./harness`: `launched` (a Chromium, or a skip when there is none), `served` (the built Storybook on a free port), `storyUrl`, `named` and `said`.
