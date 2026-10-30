# Appearance

## Light and dark

Click the theme switch in the [top bar](TOP-BAR.md), or run
`domicile theme toggle`, to switch until you log out. To keep a theme:

<!-- tab: Settings app -->

Open **Settings**, then **Appearance**, and pick a **Theme**.

<!-- tab: Config file -->

```json
{ "theme": { "mode": "light" } }
```

<!-- /tabs -->

Apps that follow the system's theme switch with it.

## Color, contrast and motion

<!-- tab: Settings app -->

On **Appearance**:

- **Accent color**: the color of highlights, in the desktop and in apps that
  follow it.
- **Contrast**: **High** draws text and edges at full strength.
- **Reduce motion**: animations run once, at their shortest.
- **Icon theme**: the icons in the launcher, title bars and menus, such as
  `Papirus-Dark`.

<!-- tab: Config file -->

```json
{
  "theme": {
    "accent_color": "#3584e4",
    "contrast": "high",
    "reduced_motion": true,
    "icon_theme": "Papirus-Dark"
  }
}
```

<!-- /tabs -->

## Pointer and fonts

These are in the config file only:

```json
{
  "theme": {
    "cursor_theme": { "dark": "Bibata-Modern-Ice", "light": "Bibata-Modern-Classic" },
    "cursor_size": 24,
    "font_name": "Inter 11",
    "monospace_font_name": "Iosevka 12"
  }
}
```

- A cursor theme can be one name, or one per theme as above.
- Install icon and cursor themes the usual way, so they are under an `icons`
  folder, such as `~/.local/share/icons`.
- Fonts apply to apps that follow the system's font.
- The desktop itself draws its text in Inter. Pick another installed face with
  the manganese shell's `font` option.

## Dark sites

Some sites, such as Gmail, have no dark look. List them, and the browser
darkens them while the desktop is dark:

```json
{ "theme": { "force_dark": ["mail.google.com"] } }
```

## Wallpaper

The wallpaper is a photograph that changes every minute: space in the dark
theme, nature in the light one. An app that sets a wallpaper, such as an
image viewer's "Set as wallpaper", replaces it.

All the options, with defaults: [SHELL-CONFIG.md](../SHELL-CONFIG.md#theme).
