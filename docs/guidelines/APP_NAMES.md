# Application names

Show a person an application's name, never its id: `Claude`, not
`com.anthropic.Claude`.

- **Name it from its desktop entry**, through the one library for your side:
  - Rust: `domicile_host::app_names`. `AppNames::name` caches, for a caller
    that names often; `app` also gives the icon.
  - Shell pages: the component library's `useApps`, built on
    `@domicile-desktop/system-apps/describe-apps`.
- Both find an entry the same way: its desktop file id, else its
  `StartupWMClass`, `Name` or the id's last reverse-DNS part. With none, the
  last part is made readable (`org.example.my-app` is `My app`).
- **Don't** show an app id, a process name or a D-Bus name raw, and don't
  write another lookup.
