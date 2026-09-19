# @domicile/shell-manganese

The bundled reference chrome: a tiling desktop keyed like [sway](https://swaywm.org),
under a transparent bar carrying the workspaces, a clock and the two things it
can launch. It is the app Domicile ships to prove the model end to end — every
pixel of it is ordinary web content, and each Wayland client on it is a real
`<app>` element that takes ordinary CSS.

The chrome is a React tree built entirely from
[`@domicile/component-library`](../component-library/README.md): the bar's
launchers and a browser window's controls are its `Button`, the address bar its
`Input`, the empty-desktop card its `Card`.
Styling is Panda CSS from the library's preset — the shell defines no
stylesheet of its own.

The page is the whole desktop, however many displays that is. The chrome goes
on the first display the config names — the names are the user's, so the shell
cannot pick one — and every other display gets a clock, which is what makes a
screen the config describes visibly there. Nothing is drawn until a desktop has
been described, which is the handshake's worth of blank window: a chrome laid
out over the page and then moved onto a screen is a different element in that
slot, and React would take every open window down with it. Opened in a plain
browser for styling work there is no host to describe one, so the shell
describes the window itself. A host that describes a desktop with *no* screens
is a third thing again — there is nowhere to lay the chrome out — and the page
says so rather than staying blank.

A window is either a Wayland client the host announced or a browser window the
shell opened itself. Both are tiled on the workspace being looked at, both have
a title bar, and both are moved, floated and closed by the same keys.

## Window management

**The layout is sway's**, and so are the keys: the config it was written
against is `config/modules/ui/sway` in the author's dotfiles, and what is not
bound there is bound by `lib.mkOptionDefault` — sway's own defaults — so both
halves are in the table below.

**The modifier is Meta** — `Mod4`, the Super key, which is what the config
sets. Every `Mod+` below is Meta.

A workspace holds a tree. A window is a leaf; every layout is a container of
them; opening a window puts it beside the one being worked in, and closing one
gives its space back to what is left. Ten workspaces, the scratchpad, floating
windows over the tiling, and one window at a time filling the screen.

| Keys | What |
|---|---|
| **Mod+Return** | Launch a terminal (`kitty`), which the compositor spawns. |
| **Mod+Space**, **Mod+D** | Open a browser window. The config's launcher keys — this shell has no launcher to run, and a window of its own is the nearest thing it has. |
| **Mod+Shift+Q** | Close the window being worked in. |
| **Mod+H / J / K / L**, **Mod+←↓↑→** | Move the focus. Wrapping at the ends of a container, which is what `focus.wrapping = "yes"` asks for. |
| **Mod+Shift+** the same | Move the window. Past its neighbour, out of the container it is in, or — pushed across the grain — into a new split of the workspace. |
| **Mod+B / Mod+V** | `splith` / `splitv`: wrap the focus in a container of one, so the next window opens beside or below it. |
| **Mod+W / Mod+S / Mod+E** | `layout tabbed` / `layout stacking` / `layout toggle split` on the container the focus is in. |
| **Mod+A / Mod+Shift+A** | `focus parent` / `focus child`: point the commands at the container around the focus, or back at the window. |
| **Mod+F / Mod+Shift+F** | Fill the screen with the window being worked in, or every screen there is. |
| **Mod+Tab** | `focus mode_toggle`: swap the keyboard between the floating windows and the tiled ones. |
| **Mod+Shift+Tab** | `floating toggle`: take the window out of the tiling, or put it back. |
| **Mod+Minus / Mod+Shift+Minus** | `scratchpad show` / `move scratchpad`. |
| **Mod+R** | Resize mode — see below. |
| **Mod+( ) } + { ] [ ! = \*** | Go to a workspace. **With Shift**, send the window being worked in there and stay. |

The window being worked in is the one whose title bar is **filled with the
accent**, and it is the one everything keyed acts on. Its frame is drawn in
the same colour, so the bar and the three edges below it say one thing.

### The keys are physical, and the layout is written down

sway binds *keysyms* and resolves them through the active keymap. Nothing here
can: a chord claimed from the compositor is an evdev keycode and a press this
page hears is a `KeyboardEvent.code`, both of which name the physical key, and
the engine does not tell a shell what the keymap is. So the layout is written
down in `keyboard/programmers-dvorak.ts` — `dvp`, which is what this desktop
comes up on when the config names no keyboard — and the bindings name the
keysyms the sway config names. `mod+h` is the key a US keyboard calls J,
because that is where Programmer's Dvorak puts `h`; the workspace chords are
the number row, because `parenleft` is on it. Configure a different layout and
the chords stay on these *keys*.

### Resize mode needs the modifier, where sway's does not

`mod+r` enters it and `mod+Return` or `mod+Escape` leaves it, as in the config
— but inside it the resize keys are `mod+h/j/k/l` rather than bare `h/j/k/l`.
A bare claim is not something this shell can take back: `grabShortcut` is
never given up, so a mode that claimed `h` on the way in would take it from
every client for the rest of the session. A tiled window resizes by a
fiftieth of its container per press (sway says `10 px`, which a share of a
container cannot mean); a floating one by ten pixels.

### Floating windows

**Mod+Shift+Tab** takes the window being worked in out of the tiling, where it
floats over the rest in a box of its own; pressing it again puts it back where
the tiling focus is. Each float opens cascaded past the ones already out, and
comes to the front when it is clicked.

The Shift that floats a window is spent on the chord. Shift is also the resize
modifier, and you are still holding both when the window lands — so until you
let go of Shift and press it again, a Mod+drag moves the window rather than
driving its corner.

**Mod+drag** moves a floating window and **Mod+Shift+drag** (or Mod+right-drag)
resizes it from the bottom-right corner — sway's `floating_modifier $mod`, and
the same key as the bindings, so it is Meta as well.
Which of the two a drag is, is read when it starts and then kept, so letting go
of Shift half way through does not turn a resize into a move with the window
jumping to wherever the pointer got to. A window is never dragged smaller than
the grab it is dragged by, and its top-left corner stays on the desktop — the
two edges a window dragged past could not be dragged back from.

Two things have to be true for that drag to be seen at all, and both are worth
knowing about:

- **The pointer over a window belongs to the client behind it.** That is the
  point of Domicile, and it means the shell cannot handle a drag on the window
  itself. While the modifier is held a floating window is given
  `pointer-events: none` — the compositor reports it as taking no pointer and
  routes to the chrome instead — and a transparent sheet over the window
  catches what falls through. The same mechanism that stops a window
  swallowing the clicks meant for a menu drawn over it.
- **The page cannot see the modifier while a window has the keyboard.**
  `wl_keyboard.modifiers` goes to the focused surface, so the compositor
  broadcasts the held set instead and the shell listens (`modifiers`). The
  page's own keyboard events are the fallback for a shell opened in a plain
  browser with no host to ask.

The window is **half transparent while it is being dragged**, and that
translucency is the compositor's rather than the page's: the SDK reports the
element's `opacity` with the placement and the shader applies it to the
client's own buffer, so what shows through a dragged window is the desktop
behind it.

The float order is the stacking order, and the shell writes it as the
`z-index` of the window's *own* element — which is what stacks the window,
because the window is a layer in this page's own layer tree, and what the SDK
reports with the placement so the compositor hit-tests in the same order.

### Every window has a title bar

Floating or tiled, a window is a title bar over its contents: what it is
called, and an X that closes it. The bar comes *out* of the window's box
rather than being added to it, so a window dragged or tiled to a size is that
size, bar included, and a resize does not have to reason about a frame that
grows with it.

**And the press on the bar is the bar's**, because the page is what hit-tests
it: the DOM gives the press to the bar and the `<app>` under it never hears
one, so nothing about the window below is focused or raised by the shell's own
chrome. That is the browser's own hit-testing rather than a rectangle the
compositor was told about, which is why it sees corner radius, transforms and
stacking.

A window in a **tabbed** or **stacking** container has its tab *as* its title
bar — one bar rather than two — so the row of tabs across the top of such a
container is the same component at a different rectangle. A tab that stands
for a whole container is named after the window that container last had the
focus in.

**Three states, which are sway's three client colours.** The window the
keyboard is in has the filled bar; a container's open tab with the keyboard
somewhere else is marked by its edge and its text rather than a fill
(`focused_inactive`, and without it two bars on one screen would look like the
focused window); every other bar recedes to a card fill and muted text,
because the window under it is what the user is looking at. Which of the three
a bar is, is on the element as `data-focus` as well as in its colours.

### Windows arrive, settle and leave

A window is not simply *there* and then gone.

- **One that opens** fades up and grows out of the middle of its own frame.
- **One whose neighbours rearrange** eases across to the new box rather than
  jumping to it.
- **One that closes** shrinks and fades away from where it was.
- **A workspace being switched to** slides its windows in from the side it was
  on, while the one being left slides off the other way.

**The arrivals and the departures are a transform, and the settling is the box
itself**, which is not a stylistic difference. The size of an `<app>` is the
resolution its client is configured at — the SDK measures the element every
animation frame and the host sends the client a `configure` — so a window that
*grew* by laying out smaller would make its client redraw on every frame of the
animation. A transform leaves the box alone: the page's own compositor scales
or slides the layer the client's buffer is already in. A settling window really
is a different size afterwards and its client really does have to be told,
which is the same stream of sizes dragging a floating window's corner already
produces, over a sixth of a second instead of as long as the user holds it.
**A window being dragged settles at nothing**: it takes the box each pointer
move writes, because one easing towards each of them trails the pointer instead
of following it.

**A window turns about one point, not two.** Its bar and its contents are
separate elements; each scaled about its own centre would pull away from the
other by a fraction of the window's height, which is a frame coming apart
rather than a window arriving. So the layout hands both of them the box they
span together and they turn about the middle of that — see `scaledAbout`.

**Opening and being revealed are different things.** A window behind a tab,
under a fullscreen one, or on a workspace nobody is looking at has been on the
desktop the whole time: it is hidden rather than unmounted, which is what keeps
its client's surface and its page alive. Only a window the desktop did not have
a render ago is opening. A workspace switch is the one reveal with an animation
of its own, and it is a slide rather than ten windows growing in at once —
because the windows were already there, and somewhere else is what they were.

**What leaves is the window itself, unchanged.** A close ends the window
everywhere at once — the list, its workspace, the layout — so the page goes on
drawing it from a record of what it was: the box it had, where it was in the
list, and whether the keyboard was in it. It is the same element at the same
place in the document, because React takes an element out of the document the
moment it stops being rendered and a `<webview>` put back a frame later is a
page reloaded from scratch. Its bar goes on saying the keyboard was in it,
because closing a window moves the keyboard and a bar that lost its fill half
way through its own departure is a window changing while the user watches it
go. What it stops doing is asking: no keyboard, no pointer, and nothing a
keyboard can reach. The workspace being switched away from is held the same
way, screenful and all.

One thing a closed **client's** window cannot keep is its pixels. `app_closed`
is the host saying the client has exited, so the surface has gone with it and
what shrinks away is the frame. A browser window, whose page is part of this
one, keeps showing its page the whole way out.

Each of them is let go when it says it has finished, not when a timer says so:
how long any of it takes is the stylesheet's, and a duration written in the
shell as well would be a second copy of it to keep in step.

### Focus follows the cursor

**The window under the pointer is the window the keyboard is in.** Move onto a
window and it is the one you are typing into — a client's keystrokes to the
host, a browser window's to its page — the one whose bar is accented, and the
one everything keyed acts on. No click anywhere. It is one arm of
`reduceWindows`, because it is a policy rather than a mechanism: a shell that
would rather the user clicked writes a different one and changes nothing else.

**It does not raise.** A window that came to the front for being crossed would
cover the one you were heading for, and the pointer would rearrange the desktop
on its way anywhere. A click is still what raises — so every click is reported,
including one in the window the pointer has already made the active one. What
keeps that from re-rendering the desktop on every press is the reduction, where
a reach that moves nothing returns the state it was given.

**The chrome is not a window.** The top bar, the wallpaper, a float's title bar
and the sheet a Mod+drag is caught on leave the keyboard where it was: there is
nothing better to point it at, and handing it back would make the desktop
untypeable whenever the pointer came to rest on furniture.

**A browser window hears the pointer where it hears a click: on its own
chrome.** A pointer inside the page is the guest's, the same way a click there
is, and whether one that lands straight in the page reaches the element the
guest hangs off is the browser process's to say — nothing here has measured it,
so treat a window entered over its page alone as one that may take the keyboard
only when it is clicked. Every focus this shell puts *into* a guest — the one a
window takes for becoming active, and the one it takes back when the chrome
drops it — is announced exactly the way a click there is, because the element
says so whichever route the focus came by, so the window spends the
announcements it causes.

**And it puts none there when it already has the keyboard.** A press in the
address bar is a reach like any other, so it is what makes that window the one
being worked in — and becoming that window is what focuses the page. A window
that focused it here would spend the user's own press: the caret lands in the
bar and is pulled into the page a moment later, so the address bar cannot be
typed into at all. The window asks whether the focus is anywhere in itself
before it moves it, and either half counts — a `<webview>` whose guest has the
focus is this document's `activeElement`, which is the other thing patch 0011
is for.

**And it gives the keyboard back when the user moves on, which is the half
that is not symmetry.** Every key the compositor delivers arrives in this
document and is forwarded from here to whichever client the shell named — so a
key pressed while a guest holds the page's focus never arrives at all: it is
delivered inside a browsing context of its own, and the document around it
hears nothing. Moving the seat does not touch that. `focusApp` says where the
keys this page forwards should go, and a page that is hearing none forwards
none, so a browser window left holding the focus makes every *other* window
deaf: terminals that worked before a browser window was opened stop taking
keystrokes, and the desktop looks locked to the page. The window being left is
the only thing that can undo it, so it blurs what it holds — Blink hands the
embedder's own frame the focus on the way out, which is what moves the browser
process's focused frame tree back off the guest's.

**A browser window comes to the front from a click anywhere in it**, its
address bar and its page alike, and the two halves say so differently. The
chrome sends the shell a pointer event like any other page furniture. The page
does not: it is a guest with a browsing context of its own, so nothing about a
pointer inside it ever crosses back out.

Nor does the focus that click takes, which was the obvious way for it to cross
and is not available: upstream Blink dispatches no focus event across a remote
frame's process boundary, and even with the fork focusing the element (patch
0011, the way upstream already does for a fenced frame) there is still no
`focusin` — Blink dispatches focus events only while the page is focused, and a
guest taking focus is the moment the chrome's page loses it. So **the element
says so itself**, in an event that is not a focus event, and the window listens
for that as well as for its own chrome's pointer events. `guard-webview-click.sh`
is what says a real click in a real guest arrives here — it is also what found
that the focus alone did not.

A client's window arrives at the same place by a different road. The SDK would
focus a clicked client by itself, and the shell stops it: the SDK asks first,
with a cancelable `domicile-focus-requested`, and this shell answers every one
of them. So both kinds of window are reached the same way — the shell decides,
and `focus_changed` comes back afterward to say where the keyboard actually is.

That is also what `focus_requested` is for: a client asking for the keyboard
over `xdg-activation`, which the compositor forwards without granting.
Manganese grants it, and goes to the workspace the window is on to do it — one
arm of `reduceWindows`, because it is a policy rather than a mechanism. A shell
that would rather refuse a window the user has not touched changes that arm and
nothing else.

### Two claims for every chord

Every binding is claimed twice over, because two different things can be
holding the keyboard when the user presses one. The page listens for its own
`keydown`, which is what answers for every press that lands on this document —
the shell's own chrome, and a focused Wayland window too, since an `<app>` is an
element here and DOM focus never leaves the page. And `grabShortcut` claims the
combination for the desktop, which is what answers when a `<webview>` has the
keyboard: a browser window is a browsing context of its own, so a key pressed on
a site the shell is showing reaches neither this page nor the compositor, and
the layer inside the engine is the only one above it.

That claim is also what keeps the two from both firing. The SDK forwards this
document's keystrokes to whichever window has the keyboard, and a chord it did
not know was spoken for went to the window as well as to the handler here —
Mod+Return opening a terminal and typing a newline into the one already open. It
reads the claim now, so the chord stops at the page. One ask, honored wherever
the keyboard happens to be; exactly one path acts for any press.

## The top bar

Transparent, across the top of the screen the chrome is on: the workspaces at
one end, the clock in the middle, and at the other end the two launchers and
the name of the binding mode whenever it is not the usual one.

It paints no background, so what is behind it is the wallpaper — and the
windows are laid out in what is *left* of the screen under it, so nothing is
behind it but the wallpaper. A window that covers it is one the user put there:
a float dragged up, or a window filling the screen.

**Its text is white with a black shadow under it, in both themes.** There is no
background to read against, so the theme's `foreground` would not do: it flips
with the theme and the photograph does not, and half of any photograph is
lighter than light text. The shadow is `shadows.textOverPhoto` from the
component library's preset — tight and nearly opaque rather than soft, because
a blurred shadow under ten-pixel type reads as a smudge.

The workspaces on it are the ones with windows on them, plus the one being
looked at — sway's own rule. The desktop keeps all ten all the time, which is
the one place that difference from sway could show, and it does not: an empty
workspace nobody is looking at is not on the bar either.

The clock reads `Wednesday 2026-09-16 20:53:40` and ticks every second, in the
middle of the *bar* rather than in the middle of what the workspaces and the
buttons leave — so the reading does not shift along as windows open. The day is
named in English beside an ISO date because the format is a decision rather
than a locale's default: a locale's own is a different width every hour and a
different order in every language, which is not something to put in the middle
of a bar and expect to stay put.

## The wallpaper

A photograph behind the whole desktop, and the next one a minute later.

One sheet rather than one per screen: the page spans every display, so
`position: fixed` *is* the desktop — and a `<Screen>` of its own would put a
second region on every display, which is one too many for anything that looks a
display up by `data-screen`. It is up before the host has described anything,
because it is on no screen and so has nothing to wait for: the handshake happens
over a photograph rather than a blank window.

**Every photograph is mounted the whole time**, and a tick of the rotation
changes only which of three things each one is — the one on screen, the one
still opaque underneath it, and the rest, loaded and transparent. The one coming
in rises *over* the one going out, which is what makes the dissolve clean: fade
one out as the other rises and the theme's `background` shows through the middle
of every transition at a quarter strength, which reads as the desktop blinking.
Mounting them all is also what has each one fetched before its turn. The
stacking is the role's rather than the markup's, because at the end of the
rotation the photograph coming in is the *earlier* element of the two, and
`isolation: isolate` on the sheet keeps that `z-index` out of the page's own
stacking context — where it would be a wallpaper painted over the chrome, level
with a floating window.

The photographs are [Wikimedia Commons](https://commons.wikimedia.org) files, by
title: `Special:FilePath` serves the file a title names and `?width=` has
Wikimedia's thumbnailer scale it, so they are the same six every time and the
browser holds them after the first fetch. **The subject is chosen** — which is
the reason they are titles rather than seeds into a placeholder service, because
a seed pins the photograph without pinning what is in it. Three are from orbit
and three from the ground, all six public domain, so showing one owes no credit
line that this surface has nowhere to put. A desktop with no network comes up on
the theme's own `background`, which is what it came up on before this existed. A
shell that wants its own pictures owns its own list.

## Layout

| Path | What |
|---|---|
| `src/index.tsx` | Entry point: applies the theme, builds the `DomicileClient`, binds the SDK to it, mounts `<Shell>`, prints the diagnostics line. |
| `src/Shell.tsx` | The composition root: the providers, and the one `DisplayProvider` every screen below fans out from. |
| `src/Desktop.tsx` | What is on the desktop: the window state, the keys, the bar over the windows, and the rectangles each screen offers them. |
| `src/clock/` | The live clock, and what it says: in the middle of the bar, and alone on every display the bar is not on. |
| `src/top-bar/` | The bar: the workspaces, the clock and the launchers. |
| `src/mount-point.ts` | Where the chrome mounts. Its own file because Domicile writes the document, so there is no element to look up — the shell makes one. |
| `src/placement-line.ts` | What the chrome has to say about its own timings, which is what measuring every window on every frame costs. |
| `src/screens/` | Where the desktop's screens come from, and what goes on each of them. |
| `src/screens/host-displays.ts` | The `DomicileClient` as the component library's `DisplaySource`, which is the whole of what joins the two. |
| `src/screens/viewport-displays.ts` | The same, for a shell with no host: the window is the only display there is. |
| `src/screens/FirstScreen.tsx`, `OtherScreens.tsx`, `NoScreens.tsx` | The screen the chrome goes on, the screens it is not on, and what the page says for a desktop with no screens at all. |
| `src/screens/IdleScreen.tsx` | What a screen with no chrome on it shows: the clock. |
| `src/keyboard/bindings.ts` | The desktop's keys, as the sway config binds them: one table from a key to an action. |
| `src/keyboard/programmers-dvorak.ts` | Which physical key each keysym is on, which is what the table above is resolved through. |
| `src/keyboard/useShortcuts.ts` | The two paths a press can arrive by, and the claim that decides which one answers. |
| `src/keyboard/useModifiers.ts` | Which modifiers are held, from both of the places that can know. |
| `src/window-management/` | The windows: what one is, everything that changes them, and where they are drawn. |
| `src/window-management/window.ts` | The window model: a client's portal or a browser window. |
| `src/window-management/window-state.ts` | Every change the desktop can undergo, as one pure reduction — and sway's commands as the actions it takes. |
| `src/window-management/workspace.ts` | One workspace: the tiling, the floats over it, and which of the two the keyboard is in. |
| `src/window-management/tree/` | The layout tree: sway's own model, one module per thing that can happen to it. |
| `src/window-management/tree/node.ts` | What a node is: a window, or a container in one of the four layouts. |
| `src/window-management/tree/tiling.ts` | The tree plus where the focus is in it, which is one chain and a depth along it. |
| `src/window-management/tree/path.ts` | Where a node is, and how one is replaced without rebuilding the rest. |
| `src/window-management/tree/insert.ts`, `remove.ts`, `move.ts`, `layout.ts`, `resize.ts` | Opening a window, closing one, carrying one through the tree, rearranging the container around it, and its share of that container. |
| `src/window-management/tree/focus-direction.ts` | `focus left` and the other three: the outward walk that finds the next window. |
| `src/window-management/tree/frames.ts` | The tree as rectangles: every visible window's frame, and the tabs of any container. |
| `src/window-management/placement.ts` | What is on screen right now: the tiling, the floats over it or the one window filling everything, and the order they stack in. |
| `src/window-management/rect.ts` | A rectangle of the desktop, and the bar the top of one carries. |
| `src/window-management/Stage.tsx` | The windows on screen, each at the rectangle the layout gave it, and the ones still leaving. |
| `src/window-management/TitleBar.tsx` | The bar every window has: what it is called, and the way out of it. |
| `src/window-management/title-focus.ts` | Which of sway's three client colours a bar is drawn in, and why a tab needs the third. |
| `src/window-management/AppWindow.tsx` | A Wayland client's window: one `<app>` element. |
| `src/window-management/BrowserWindow.tsx` | A browser window: an address bar (back / forward / stop / reload) over a `<webview>`. |
| `src/window-management/useHistoryAvailability.ts` | Where that window's page can be sent, read off the view's own properties rather than learned from the event that says to read them. |
| `src/window-management/useReclaimFocus.ts` | Keeping the document's focus on the window being worked in, but only when it landed on nothing at all — the address bar and the bar's own controls are the user reaching for focus, and a closing window's own control leaves it on the body. Which of the two a `focusout` is comes off the event's `relatedTarget`, because the document is mid-change while it is dispatched. |
| `src/window-management/with-scheme.ts` | What an address typed without one gets: `example.com` is an address, not a relative path. |
| `src/window-management/window-styles.ts` | What every window shares, how one is placed at a rectangle, and how one arrives, settles and leaves. |
| `src/window-management/window-motion.ts` | What a window is doing that the page has to draw over time, and which way a workspace switch went. |
| `src/window-management/shown.ts` | The desktop as the page last drew it, which is the only place a close or a switch survives. |
| `src/window-management/closing.ts` | A window that has closed: the box, the name and the keyboard it had, and where in the list it goes on being drawn. |
| `src/window-management/workspace-switch.ts` | The workspace that has just left the screen, with the screenful it had and the way it went. |
| `src/window-management/useWindowMotion.ts` | Which windows are drawn and what each of them is doing, worked out from the difference between two renders. |
| `src/window-management/floating/float.ts` | A window that has left the tiling: where it sits and how big. Its own module because floating is not a kind of window. |
| `src/window-management/floating/useFloatDrag.ts`, `FloatGrab.tsx`, `FloatTitleBar.tsx` | Dragging and resizing a floating window, and the furniture that offers it. |
| `src/wallpaper/Wallpaper.tsx` | The photograph behind the desktop, and the crossfade to the next one. |
| `src/wallpaper/photos.ts` | Which photographs those are, and where they come from. |
| `src/global.css`, `src/css.d.ts` | The document-level styling, and the type for importing it. |
| `src/domicile-elements.d.ts` | The engine's `<app>`, as JSX. `<webview>` needs no entry — React has had one since Electron. |

There is no main process and no preload. The engine is the display compositor
and serves this page over `domicile://`, and the channel to it is
`window.domicile`, so what is here is the chrome and nothing else.

React owns this DOM, so the chrome writes the tags in JSX: `<app>` and
`<webview>`, both the engine's own. React has had a `webview` tag and an
`HTMLWebViewElement` to go with it since Electron, which the SDK fills in with
what the fork puts on it; `app` it has never heard of, so `domicile-elements.d.ts`
declares it. Neither has a hyphen in its name, so React treats both as ordinary
HTML elements — it writes no property it does not recognize and binds no `on…`
prop for their events, which is why `AppWindow` and `BrowserWindow` both bind
theirs with `addEventListener` on a ref.

## What is not sway

The parts of the config this shell cannot answer, and why:

- **Everything `exec`s a command.** The launcher, the password manager, the
  lock screen, the volume and brightness keys are all paths into the user's own
  nix store, and a shell has nowhere to read them from — the compositor spawns
  what it is told to spawn, and nothing tells it. `mod+Return` and the
  launcher keys are what is left: a terminal, and a window of the shell's own.
- **Per-window rules.** `for_window [app_id="launcher"] floating enable` and
  the rest of the config's `window.commands` have no equivalent here: every
  window opens tiled, and floating one is a key away.
- **`reload` and `exit`.** There is no config to re-read and no session to
  end from the page.
- **Outputs, inputs, and the bar's own config.** The compositor owns the
  displays and the keyboard — `manganese.json` is where those are set, below —
  and the bar is this page rather than a swaybar process.
- **Mouse warping, per-window borders, `hideEdgeBorders`.** A window's frame
  is CSS here; there is no pointer to warp from a page.

## Configure

`$XDG_CONFIG_HOME/domicile/manganese.json`, and nothing of Domicile's: this
shell owns the file, and what the compositor needs is derived from it.

```json
{
  "present": true,
  "desktop": {
    "displays": [{ "name": "left", "size": [1920, 1080] }],
    "keyboard": { "layout": "us", "variant": "dvp", "options": ["caps:swapescape"] }
  }
}
```

Everything is optional; a missing file is a first run rather than a mistake.
`keyboard` is the exception worth knowing about: unset, this desktop comes up
on Programmer's Dvorak with Caps Lock and Escape swapped, which is a preference
rather than a neutral default — and it is the layout the keys above were
written for. Naming one replaces it whole rather than merging into it — a
variant belongs to a layout, so `{ "layout": "de" }` is a German keyboard and
not a German one with `dvp` still under it. For an ordinary US layout, say so:
`{ "layout": "us" }`.

## Build & run

```sh
bun run turbo build:vite --filter @domicile/shell-manganese
```

emits the chrome to `.vite/renderer/main_window/`, which is the whole of what a
shell builds: a page and what it loads.

```sh
nix run 'github:cprussin/domicile#manganese'
```

runs it — the engine on that page, and the compositor as a producer to it.
`./scripts/dev-shell.sh manganese` does the same from a checkout.

`bun run --filter @domicile/shell-manganese start:dev` runs this shell in a real
desktop and rebuilds it as you edit: the engine the flake pins and the
compositor built out of this checkout. A rebuilt shell needs the desktop
restarted — nothing reloads the page for you until `domicile load-shell` lands,
see `scripts/dev-shell.sh`.

`styled-system/` is Panda's generated output, produced by `bun run prepare`
(run automatically as a turbo dependency of the build, type check, and tests)
and not checked in.

## Test

```sh
bun run turbo test --filter @domicile/shell-manganese
```

runs the type check, the unit tests, and the Vite build. The layout tree and
the reduction are tested on their own — they are pure functions over a tree and
a state — and the components render against happy-dom via
[`@domicile/test-support`](../test-support/README.md).
