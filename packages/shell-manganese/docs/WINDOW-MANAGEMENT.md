# Window management

Manganese uses sway's layout model. For the key bindings, see
[KEYS.md](KEYS.md).

## Layout

- Each workspace holds a tree. Windows are leaves; containers lay out their
  children split, tabbed or stacking.
- Tiled windows have a 20px gap between them and at the screen's edges, which
  the focus glow lights. A lone window keeps the gap at the edges.
- A new window or tab opens just after the focused one. Closing a window
  gives its space to the rest.
- Closing the focused window focuses the one in its group focused most
  recently before it, as sway's focus stack does. Each window records when it
  last took focus, and keeps that when it moves.
- Every tiled window is in a group. The first window on a workspace opens in a
  tab group of one, so the next window's place shows.
- A group changes only on request (a layout or split command, a move or a
  drop). Closing down to one window keeps the group. A group left holding only
  another group is replaced by it.
- A split of one window leaves 64px empty at its end, where the next window
  opens.
- There are 10 workspaces for the whole desktop, plus the scratchpad and floating
  windows.
- A window is either a Wayland client or a browser window the shell opened.
- Until the compositor reports the screens, only the wallpaper is drawn. A
  desktop with no screens shows a message.

## Screens

Workspaces belong to the desktop, and screens show them, as in sway:

- A workspace shows on one screen at a time.
- `workspace 2` goes to the screen already showing workspace 2.
- A hidden workspace belongs to the screen that last showed it. Only that
  screen's bar lists it.
- An empty workspace opens on the screen with the keyboard.
- A window opens on the screen with the keyboard.
- Two screens never show one workspace. A client surface can be shown in only
  one place, so a second copy would blank the first.

## Focus

- **Focus follows the pointer.** The window under the pointer gets the
  keyboard. No click needed. This is one case in `reduceWindows`; a shell that
  wants click-to-focus changes only that case.
- **Hovering does not raise.** A click raises.
- **The screen under the pointer gets the keyboard**, even with no window on
  it (`src/screens/useScreenFollowsPointer.ts`).
- **`focus <direction>`** past the edge of a workspace or a fullscreen window
  moves to the next screen that way, then wraps.
- **`move <direction>`** past the edge of a workspace moves the tiled window
  (or `focus parent` selection) to the next screen that way, as in sway. It
  enters that screen's tiling on the near side, and focus follows it. Floats
  and fullscreen windows stay put.
- **The chrome does not take focus.** The bar, wallpaper and title bars leave
  the keyboard where it was.
- **The focused window stands out.** An accent ring and glow surround it
  (`FocusGlow.tsx`), lighting the gaps around it. A window in a tab group
  lights the whole group, tabs included. Its title bar is raised with bold
  text. The glow fades out and in where it is, rather than moving to the next
  window, so pointer-driven focus changes don't flash or slide.
- **Meta+A selects a group.** Commands then act on the whole container. One
  glow surrounds the group; the focused window's bar gets the accent color.
  A selected tab group lights its tab strip instead, and its tabs keep their
  usual states. Meta+Shift+A,
  focusing a floating window, or clicking another window ends the selection.
- **`xdg-activation` requests are granted.** The compositor forwards them as
  `focus_requested`. Manganese switches to that window's workspace and focuses
  it. The compositor drops requests made before the keyboard last moved, so a
  window cannot take focus back after the user moved on.

### Pointer warping

The pointer follows keyboard focus (sway's `mouse_warping container`):

- A keyed focus change warps the pointer to the center of the new window,
  unless it is already over it. An empty screen warps to its center.
- A window that opens with the keyboard also warps the pointer, but only when
  the pointer is over another window. Over the top bar or an empty workspace,
  it stays put.
- Focus changes on `pointerover` only when the pointer moves. A window sliding
  under a still pointer does not take focus.

### Browser windows

- A pointer that enters a browser window directly over its page (not its
  chrome) may not move focus until a click.
- Clicking in the address bar keeps the caret there.

For how warping, browser-window focus and modifier drags work, see
[FOCUS-INTERNALS.md](FOCUS-INTERNALS.md).

## Floating windows

- **Meta+Shift+Tab** floats the window, or tiles it again at the tiling focus.
  New floats cascade from the previous ones. A click raises a float.
- A floated window goes in a tabbed container, so new windows opened while it
  has the keyboard join it as tabs. Tiling it again drops the container when
  it holds one window.
- After **Meta+A**, the whole selected container floats as one box and keeps
  its layout. Tiling keys work inside it. A new window opened while the
  keyboard is in a floating group joins that group.
- **Meta+drag** moves a float. **Meta+Shift+drag** or **Meta+right-drag**
  resizes from the nearest corner. The mode is fixed when the drag starts.
- The Shift used to float a window does not count as the resize modifier until
  it is released and pressed again.
- **Edges resize without a modifier**: a strip along each edge and a larger
  square at each corner (`floating/float-borders.ts`). Over the title bar,
  only the outside strip is a border.
- A float can't be resized below 240×120 px, and its top-left corner stays on
  the desktop.
- **A float moves to the screen its center is dragged onto**, as in sway
  (`floatDragged`). A browser window crosses screens without reloading.
- A float casts a shadow (`FloatShadow.tsx`), except when fullscreen.
- Stacking order is the `z-index` of the window's element, so drawing order and
  hit-testing order match.
- A window's open tab and popups draw one above the window (`raised`), so
  tabs that swap slide under the open one. Floats are two apart to leave room.
- Raising a float over one it overlaps animates the two swapping places.

## Dragging tiled windows

- **Meta+drag**, or dragging its title bar, picks up a tiled window. An
  overlay shows where it will land: half of a target puts it on that side; the
  center swaps the two. Dropping over nothing does nothing. See
  `tree/drop.ts`.
- **A drop can land on any screen.** Targets include tiled windows on other
  screens, and the whole of a screen with nothing tiled. Focus follows the
  window.
- **Dropping on a tab** puts the window before or after it in its strip, by
  which half of the tab the pointer is over.
- **Dragging a tab along its strip** moves it at once into the slot under the
  pointer, with no overlay.
- The pointer shows `grabbing` while a window moves.
- A move aims only once the pointer is 8px from the press, so clicking a tab
  never drops it beside its container's open tab.
- **Meta+right-drag** or **Meta+Shift+drag** resizes from the
  corner nearest the pointer. See `tree/stretch.ts`. Unlike a move, a resize
  does not make the window transparent.
- **Shared edges resize without a modifier**, over the window's border and the
  gap beside it (`tiled/borders.ts`).
- Fullscreen windows and hidden tabs cannot be dragged.

## Title bars

- Every window has a title bar: its name, a float/tile button (same as
  Meta+Shift+Tab), a fullscreen button (same as Meta+F) and a close button.
- A browser window's name is its page's title, or its site when the page has
  none.
- Each bar and tab draws its window's icon before the name, else a stand-in:
  - A client's: the `Icon` of the desktop entry its Wayland app id names
    (matched in any case), else the icon named after the app id, in
    `theme.icon_theme`. Entries are read again when a new app id appears.
  - A browser window's: its page's icon.
- A middle click on a bar or tab closes its window.
- The bar is inside the window's box, so a window's size includes its bar.
- The contents reach 1px up under the bar (`SURFACE_TUCK`), so no sliver of
  the desktop shows between them at fractional scales.
- Only the top corners are rounded. The bottom of the frame is client pixels.
- The page hit-tests the bar, so clicks on it never reach the client.
- In a tabbed or stacking container, each window's tab is its title bar. The
  tabs rest in a tab strip, even a container of one.
- The strip has a rounded top and an edge. Its bottom edge is the window's top
  edge; the open tab breaks it to join its window.
- Tabs are at most 240px wide, so the strip always runs on past the last one.
- A "+" past a tabbed strip's last tab focuses the strip's open tab and opens
  the launcher, so the launched window opens as a tab beside it.
- A hidden tab shows only its close button. Dividers separate hidden tabs.
- A tab for a nested container shows the name of its last-focused window, an
  icon for its layout and its window count.
- A bar has four states, set as `data-focus` (`title-focus.ts`): sway's
  `focused`, `focused_inactive` and `unfocused`, plus `leaf` for the focused
  window inside a selected group.

## Animations

- Opening: fade in and grow from the center.
- Opening a tab: the tab opens out along its strip, which stays whole; the
  contents fade in.
- Rearranging: windows ease to their new boxes.
- Moving a tab along its strip: the strip stays whole and the tab slides to
  its new place.
- Closing: shrink and fade out.
- Workspace switch: the new workspace slides in; the old one slides out.
- Tab switch: crossfade.

Rules:

- Open and close use transforms. Resizing the element would reconfigure the
  client every frame. Rearranging changes the real box, since the client must
  resize anyway.
- A window being dragged follows the pointer without easing.
- The title bar and contents scale about one shared center (`scaledAbout`).
- Only windows new since the last render animate open.
- Hidden windows (behind a tab, on another workspace) stay mounted, so client
  surfaces and pages stay alive.
- A closed window keeps rendering from a saved record (`closing.ts`) at its
  old place in the document, so React does not remount a `<webview>`. It takes
  no input while it leaves. A closed client's surface is already gone, so only
  its frame animates; a browser window keeps its page.
- A closing window draws above the windows moving into its space.
- Durations live in the stylesheet only. The shell waits for each animation's
  end event.
