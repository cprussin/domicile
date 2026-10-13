# @domicile-desktop/manganese-window-management

Manganese's window management: sway's layout tree, tiling, floating, workspaces, keybindings and the windows' chrome.

## Exports

- `@domicile-desktop/manganese-window-management/Stage`
- `@domicile-desktop/manganese-window-management/client-icons`
- `@domicile-desktop/manganese-window-management/direction`
- `@domicile-desktop/manganese-window-management/floating/floating-rules`
- `@domicile-desktop/manganese-window-management/grab-cursor-styles`
- `@domicile-desktop/manganese-window-management/keyboard/commands`
- `@domicile-desktop/manganese-window-management/keyboard/useKeybindings`
- `@domicile-desktop/manganese-window-management/keyboard/useModifiers`
- `@domicile-desktop/manganese-window-management/placement`
- `@domicile-desktop/manganese-window-management/pointer-warp`
- `@domicile-desktop/manganese-window-management/rect`
- `@domicile-desktop/manganese-window-management/screens/fixture`
- `@domicile-desktop/manganese-window-management/screens/host-displays`
- `@domicile-desktop/manganese-window-management/screens/shown-windows`
- `@domicile-desktop/manganese-window-management/screens/stage-screens`
- `@domicile-desktop/manganese-window-management/screens/useScreenFollowsPointer`
- `@domicile-desktop/manganese-window-management/screens/useShared`
- `@domicile-desktop/manganese-window-management/screens/useStageScreens`
- `@domicile-desktop/manganese-window-management/tiled/aim`
- `@domicile-desktop/manganese-window-management/tree/path`
- `@domicile-desktop/manganese-window-management/useClientIcons`
- `@domicile-desktop/manganese-window-management/useGrabCursor`
- `@domicile-desktop/manganese-window-management/usePointerWarp`
- `@domicile-desktop/manganese-window-management/useWindows`
- `@domicile-desktop/manganese-window-management/window`
- `@domicile-desktop/manganese-window-management/window-state`
- `@domicile-desktop/manganese-window-management/window-styles`
- `@domicile-desktop/manganese-window-management/workspaces-context`

`@domicile-desktop/manganese-window-management/panda-preset` holds its keyframes. A shell that renders this package adds the preset to its Panda config.

## More

- [WINDOW-MANAGEMENT.md](docs/WINDOW-MANAGEMENT.md)
- [KEYS.md](docs/KEYS.md)
- [FOCUS-INTERNALS.md](docs/FOCUS-INTERNALS.md)

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese-window-management
```
