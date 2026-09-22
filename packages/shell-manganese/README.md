# @domicile/shell-manganese

The bundled reference chrome: a tiling desktop keyed like [sway](https://swaywm.org),
under a transparent bar carrying the workspaces, a clock and the charge. It is
the app Domicile ships to prove the model end to end — every
pixel of it is ordinary web content, and each Wayland client on it is a real
`<app>` element that takes ordinary CSS.

The chrome is a React tree built from
[`@domicile/component-library`](../component-library/README.md): a browser
window's controls are its `Button`, the address bar its `Input`, the
empty-desktop card its `Card`. The one control that is the shell's own is a
workspace number on the bar, and it is one for the reason the library's own
`TabRail` has one — what marks it is `aria-current`, which `Button` does not
dress, and `className` is private there.
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
| **Mod+Space**, **Mod+D** | Open the launcher, or put it away. The config's launcher keys, in both the places it binds one. |
| **Mod+Shift+V** | Open the clipboard's history, or put it away. Not sway's: sway has no clipboard manager, and this is where every config that adds one puts it. |
| **Mod+Shift+Q** | Close the window being worked in. |
| **Mod+H / J / K / L**, **Mod+←↓↑→** | Move the focus. Wrapping at the ends of a container, which is what `focus.wrapping = "yes"` asks for. |
| **Mod+Shift+** the same | Move the window. Past its neighbor, *into* a neighbor that is a container rather than a window, out of the container it is in, or — pushed across the grain — into a new split of the workspace. |
| **Mod+B / Mod+V** | `splith` / `splitv`: wrap the focus in a container of one, so the next window opens beside or below it. |
| **Mod+W / Mod+S / Mod+E** | `layout tabbed` / `layout stacking` / `layout toggle split` on the container the focus is in. |
| **Mod+A / Mod+Shift+A** | `focus parent` / `focus child`: point the commands at the container around the focus, or back at the window. The selected container is drawn with a dashed accent line around it — sway's indicator. |
| **Mod+F / Mod+Shift+F** | Fill the screen with the window being worked in, or every screen there is. The button on a window's own title bar is the first of the two, on the window whose bar it is. |
| **Mod+Tab** | `focus mode_toggle`: swap the keyboard between the floating windows and the tiled ones. |
| **Mod+Shift+Tab** | `floating toggle`: take the window out of the tiling, or put it back. |
| **Mod+Minus / Mod+Shift+Minus** | `scratchpad show` / `move scratchpad`. |
| **Mod+R** | Resize mode — see below. |
| **Mod+( ) } + { ] [ ! = \*** | Go to a workspace. **With Shift**, send the window being worked in there and stay. |

**A split and a move make a group**, which is the whole of what tiling is for:
**Mod+V** wraps the window being worked in in a column of one, and a window
moved at that column from beside it goes *in* rather than trading places with
it — beside the window the column last had the focus in, or at the near end of
one that runs the way the window is moving. **Mod+A** then points the keys at
the group rather than at the window in it, and says which group with a dashed
line around it: what splits, lays out, moves and resizes from there is the
whole container. **Mod+Shift+A** points them back at the window.

The window being worked in is the one with a **rule of accent across the top
of its frame**, over a title bar washed with enough of the same accent to find
in the corner of your eye, and it is the one everything keyed acts on. Its
frame is drawn in that color and its name is set in a heavier face, so the bar
and the three edges below it say one thing. Every window eases between those
colors rather than snapping between them: focus follows the cursor here, so
they change every time the pointer crosses a window.

**And the cursor follows the keyboard**, which is `mouse_warping container`
from the config and is not decoration: a key that moves the focus leaves the
pointer over the window it came from, the layout slides another window under
that stationary pointer, and the `pointerover` that fires as it arrives hands
the focus straight back. So a keyed focus change puts the pointer in the middle
of the window it moved to — unless the pointer is over that window already,
which is every press that moved nothing the pointer is near: a split, a layout,
a tab of the container it is sitting on. The page cannot move a pointer; the
engine can, and `warpPointer` is what asks it to.

**A window that opens takes the pointer the same way**, and for the same
reason with nobody pressing anything: a window lands on the workspace being
looked at and takes the keyboard — a terminal finishing its startup, a link
opening a browser window — while the pointer is still over whatever that
window was laid out beside, which is what would take the focus back. What
says a window is new is that it was not there a render ago; a window that
opens WITHOUT the keyboard moves nothing, because the pointer has no quarrel
with it.

**Both ask in the page's pixels, which on a tty are not the layout's.** Where
a page is one monitor, `<Screen>` draws its region over the whole window
through a transform — a 4K panel at density 1.2 is laid out as a 3200-wide box
and drawn across 3840 — and a pointer only ever exists in what the page draws.
So a window's box goes through `onThePage` before either question is asked of
it. Laying that step out wrongly is a cursor that lands a fraction of the way
to the window, right at the screen's corner and further out the further from
it, which is what it looked like before this existed.

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
- **A drag is measured in the pointer's pixels, and those are not the
  window's.** Where a page is one monitor, `<Screen>` covers its window with a
  transform, so a hand that crossed 120 of the page's pixels crossed 60 of the
  ones the window was laid out in — and crossed them sideways on a monitor on
  its side. The travel goes through `offThePage` before it is added to the box,
  which is the seam the pointer warp crosses in the other direction.
- **The page cannot see the modifier while a window has the keyboard.**
  `wl_keyboard.modifiers` goes to the focused surface, so the compositor
  broadcasts the held set instead and the shell listens (`modifiers`). The
  page's own keyboard events are the fallback for a shell opened in a plain
  browser with no host to ask.

The window is **half transparent while it is being dragged**, and nothing
here arranges that. `opacity` on the element is `opacity` on a layer, because
the window *is* a layer in this page's own layer tree — so the page's
compositor applies it to the client's buffer the way it would to a
hardware-composited `<video>`, and what shows through a dragged window is the
desktop behind it. The shell writes the CSS and stops.

The float order is the stacking order, and the shell writes it as the
`z-index` of the window's *own* element — which is what stacks the window, for
the same reason: it is a layer in this page's layer tree, and it is the
element the pointer hit-tests against, so the order it draws in and the order
it is hit in are one fact rather than two that have to be kept in step.

### Every window has a title bar

Floating or tiled, a window is a title bar over its contents: what it is
called, a button that fills the screen with it — `fullscreen`, which is what
**Mod+F** does — and an X that closes it. The bar comes *out* of the window's
box rather than being added to it, so a window dragged or tiled to a size is
that size, bar included, and a resize does not have to reason about a frame
that grows with it.

Its top two corners are rounded and its bottom two are not, because those are
the only corners the page draws: the bottom of a frame is the window's
contents, and those are a client's own pixels laid into the page.

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

**Three states, which are sway's three client colors.** The window the
keyboard is in has the accent rule and the wash under it; a container's open
tab with the keyboard somewhere else is marked by its edge and its text alone
(`focused_inactive`, and without it two bars on one screen would look like the
focused window); every other bar recedes to a card fill and muted text,
because the window under it is what the user is looking at. Which of the three
a bar is, is on the element as `data-focus` as well as in its colors.

### Windows arrive, settle and leave

A window is not simply *there* and then gone.

- **One that opens** fades up and grows out of the middle of its own frame.
- **One whose neighbors rearrange** eases across to the new box rather than
  jumping to it.
- **One that closes** shrinks and fades away from where it was.
- **A workspace being switched to** slides its windows in from the side it was
  on, while the one being left slides off the other way.

**The arrivals and the departures are a transform, and the settling is the box
itself**, which is not a stylistic difference. The size of an `<app>` is the
resolution its client is configured at — the element's layout box *is* the
`xdg_toplevel.configure`, which the engine states off the layout it performed —
so a window that *grew* by laying out smaller would make its client redraw on
every frame of the animation. A transform leaves the box alone: the page's own
compositor scales or slides the layer the client's buffer is already in. A settling window really
is a different size afterwards and its client really does have to be told,
which is the same stream of sizes dragging a floating window's corner already
produces, over a sixth of a second instead of as long as the user holds it.
**A window being dragged settles at nothing**: it takes the box each pointer
move writes, because one easing towards each of them trails the pointer instead
of following it.

**A window turns about one point, not two.** Its bar and its contents are
separate elements; each scaled about its own center would pull away from the
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

**A window and the space around it are one movement.** Opening and closing run
for exactly as long as the layout takes to ease into its new boxes, and both
lead with the motion — most of the scale and most of the fade in the first few
frames, the rest settling — rather than the usual accelerate-away curve for
something leaving, which at this length reads as a window sitting still and
then being snatched. A closing window is drawn *over* the windows moving into
its place, too: they are easing into the box it is still shrinking away inside,
and at the depth it used to have they would cover it before it had gone.

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

## The clipboard

**A Wayland clipboard is the client that copied**, and that is the whole
problem this solves. `wl_data_device.set_selection` hands the compositor a
source object rather than any bytes, so every paste asks the offering client to
write what it copied all over again — and closing the terminal you copied out
of empties the clipboard. Copy a command, close the window, and it is gone.

**Mod+Shift+V** puts up what has been copied, newest first, and choosing a row
makes it the selection again. What answers the next paste then is the
*compositor*, not the client that first copied it, so a row outlives the
terminal it came from.

**The history is the compositor's**, because the compositor is the only process
a copy arrives at. It reads the selection over a pipe each time a client sets
one, keeps the last thirty-two, and moves a repeat back to the top rather than
drawing it twice — `domicile_host::clipboard` is the rule and
`packages/domicile-host/tests/clipboard.rs` is what pins it. It is **pushed**,
like the charge and unlike `list_files`: a copy is an event the compositor
already hears, so the panel is current when it opens rather than fetching on
the way up.

**A row is an id and a preview, and never the text.** The bytes stay in the
compositor and the shell hands back the id it was given, which is what
`copyClipboardEntry` takes. A password manager's copy is a row in this list, so
the less of it that crosses into a page the better — and the preview is cut to
a row's worth anyway, because the rest of a copied file is not a row. What goes
back on the clipboard is always the whole thing.

**Text only, in memory only.** A selection with no text in its mime types — an
image, a file drag — is not a row: a list of previews is not a store, and a
manager that offered a row it could not hand back would be worse than one that
never offered it. And nothing is written to disk, so a history does not survive
the reason you rebooted. A desktop that has just started says it has nothing
rather than showing an empty box.

## The top bar

Across the top of the screen the chrome is on: the workspaces at one end, the
clock in the middle, and at the other end the charge, behind the name of the
binding mode whenever it is not the usual one.

**It launches nothing.** Everything this desktop does is on a key, and the two
buttons that were here — a terminal and a window of the shell's own — were a
ranking of two of them that nobody made. `mod+Return` is still the terminal and
`mod+Space` is the launcher, which is what opens a window on a URL or a search;
both are where sway's config puts them and so where a user of this desktop
already looks. What the bar carries is what no key can be pressed to ask: which
workspace this is, what time it is, and how much charge is left.

What is behind it is the wallpaper: the windows are laid out in what is *left*
of the screen under it, so nothing else is. A window that covers it is one the
user put there: a float dragged up, or a window filling the screen.

**Its text is white with a black shadow under it, in both themes.** There is no
surface to read against, so the theme's `foreground` would not do: it flips
with the theme and the photograph does not, and half of any photograph is
lighter than light text. The shadow is `shadows.textOverPhoto` from the
component library's preset — tight and nearly opaque rather than soft, because
a blurred shadow under ten-pixel type reads as a smudge.

**Under the text is a scrim, not a surface.** `gradients.scrimOverPhoto`, also
from the preset: black at the top edge and gone by the bottom one, so the bar
still ends in the wallpaper rather than against a line. The shadow draws each
letter off the picture and the scrim darkens the ground the whole row sits on;
a wallpaper that is white across the top of the screen needs both.

**It hangs half the bar's height below the bar**, which is what keeps it
strong where the text is. A gradient given only the bar's own 32px has to
reach nothing by the bar's lower edge, so it is already thinning out a few
pixels under the letters — the weakest part of the ramp arrives exactly where
a bright photograph does its worst. With the extra room the letters sit in the
dark part and the fade happens under them. The overhang takes no pointer, so
the top of the stage is still the stage, and it ends where a window's top edge
is: what you see is a band that stops at the window rather than a line drawn
across open wallpaper.

The workspaces on it are the ones with windows on them, plus the one being
looked at — sway's own rule. The desktop keeps all ten all the time, which is
the one place that difference from sway could show, and it does not: an empty
workspace nobody is looking at is not on the bar either.

**Each one is a number in a ring**, which is the shape the author's waybar
draws and the one thing on the bar that is not plain writing: a circle the
height of the bar's own text, empty until the pointer is over it — which draws
the ring in white and washes the inside of it — and filled white with the
number in black for the workspace on screen. The fill is what makes the marked
one a shape rather than a shade of the same white as its neighbors, which is
the difference that survives being glanced at over a photograph.

**It is the same circle for all ten of them**, which is what the number being
set a size smaller than the rest of the bar is for: the tenth workspace is two
digits wide, and a ring drawn around what is written in it would be a lozenge
there and a circle around the nine before it. The figures are tabular for the
other half of that — `11` is the width of `10`, so the digit inside the ring
does not shift as the workspaces change.

**And the figure is centered on the ring rather than in a line box.** A line
box is as tall as the font's ascent and descent, and a digit has neither the
accent the one leaves room for nor the tail the other does, so a box centered
in the circle puts the number a couple of pixels high in it — which is exactly
the kind of wrong that is hard to name and impossible to stop seeing.
`text-box: trim-both cap alphabetic` cuts the box down to the cap above and
the baseline below, so what gets centered is what is drawn. The trim is
honored on a block container and quietly ignored on a flex one, which is why
the chip is a block with its text centered rather than the obvious centering
flex box. Pressing one gives a little under the pointer; the white and the shadow it is drawn in are the bar's own, inherited
rather than declared, because a workspace number is a character of the bar's
one row of writing that happens to be in a circle.

The clock reads `Wednesday 2026-09-16 20:53:40` and ticks every second, in the
middle of the *bar* rather than in the middle of what the workspaces and the
charge leave — so the reading does not shift along as windows open. The day is
named in English beside an ISO date because the format is a decision rather
than a locale's default: a locale's own is a different width every hour and a
different order in every language, which is not something to put in the middle
of a bar and expect to stay put.

**The charge is at the far end, and is three readings of one number.** A bolt
when AC is in, a meter whose fill *is* the level, and the percentage in
figures. None of the three is the other two: the meter is what is read at a
glance and is the only one exact to better than a percent, the figures are what
a decision about a lead is made on, and the bolt is the plug — a full battery
and a machine on AC look identical on a meter and are not the same thing. The
meter is drawn in `currentcolor`, so the one decision about what color survives
a photograph is the bar's own; a meter is boxes rather than type, and `color`
would reach the figures beside it and nothing else.

**At a tenth left the whole readout goes to `danger`, and at a twentieth it
flashes.** Both thresholds are read off the *percentage* rather than the level
behind it, so the color and the figures cannot disagree — a tenth and a bit
reads as `10%`, and a readout saying ten while looking comfortable would be two
answers to one question. The lead being in does not clear either: the bolt is
what says the lead is in, and what the color is about is the cell. The flash is
`chargeFlashing`, the shell's own keyframe, rather than the preset's `pulse`:
`pulse` sits between a third and two thirds throughout and says a control is
busy, where this is at full strength twice a turn — a battery with minutes left
has to be more legible than the rest of the bar at the moment it is least
ignorable, not less. It is an opacity rather than a second color, so the one
decision about what red is stays the `danger` token's and one animation covers
the case, the fill, the bolt and the figures at once.

**It comes off the host, and the first version of it did not.** The obvious
route for a page is `navigator.getBattery`, the Battery Status API, and it is a
trap: that API answers through UPower over D-Bus, a desktop on a bare tty has
neither — see the `ERROR:dbus/bus.cc` line `scripts/test-shell-guard.sh` has
long treated as ordinary engine noise — and Chromium then resolves with its
*default* `BatteryStatus`, which is *charging, and full*. A default that looks
like a real reading is the worst kind: no page can tell it from a laptop
genuinely on AC at 100%, so nothing in here could have caught it, and the bar
said `100%` on a machine running flat.

So the charge crosses the control channel like everything else the desktop
knows about the machine. The compositor reads `/sys/class/power_supply`, which
is in every kernel and wants no daemon and no bus, sums the batteries rather
than averaging their percentages, and counts a USB-C charger as a lead the same
as `AC` — `domicile_host::battery` is the reading and `packages/domicile-host/
tests/battery.rs` is the rule. It is **pushed**, not asked for, which is the
one place this differs from `list_files`: a charge changes on its own, so there
is nothing for a shell to ask. It arrives when the reading moves far enough to
draw — a whole percent, or the lead — and once more to a page that has just
connected, so a reload does not wait for the next percent.

**And it is not polled**, which it was for one release and should not have
been. The kernel announces a supply that changed — `power_supply_changed()` in
the driver is a uevent — so the compositor subscribes to
`NETLINK_KOBJECT_UEVENT` and re-reads when it is told to. A socket rather than
libudev, because libudev's monitor is a wrapper over that same socket and
`domicile-compositor` takes no C library beyond libxkbcommon; group 1 rather
than udevd's, because a desktop on a bare tty is the machine least likely to
be running that daemon. Nothing in the datagram is believed: it is a doorbell,
and the reading that follows comes from `/sys`. A slow backstop is still
armed, for drivers that do not announce every capacity step.

Nothing is drawn until the host has said a charge, and a machine with no
battery looks exactly the same: the compositor sends nothing for a desktop PC,
and a bar that drew `100%` for one would be the same lie in a different hat.

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
| `src/index.tsx` | Entry point: applies the theme, builds the `DomicileClient`, binds the SDK to it, mounts `<Shell>`, and states the desktop's size and density. |
| `src/Shell.tsx` | The composition root: the providers, and the one `DisplayProvider` every screen below fans out from. |
| `src/Desktop.tsx` | What is on the desktop: the window state, the keys, the bar over the windows, and the rectangles each screen offers them. |
| `src/clock/` | The live clock, and what it says: in the middle of the bar, and alone on every display the bar is not on. |
| `src/top-bar/` | The bar: the workspaces, the clock and the charge. |
| `src/battery/` | The charge at the end of the bar, and the platform battery it is read off. |
| `src/clipboard/` | What has been copied, as a panel over the desktop, and the host message it is read from. |
| `src/mount-point.ts` | Where the chrome mounts. Its own file because Domicile writes the document, so there is no element to look up — the shell makes one. |
| `src/screens/` | Where the desktop's screens come from, and what goes on each of them. |
| `src/screens/host-displays.ts` | The `DomicileClient` as the component library's `DisplaySource`, which is the whole of what joins the two. |
| `src/screens/viewport-displays.ts` | The same, for a shell with no host: the window is the only display there is. |
| `src/screens/FirstScreen.tsx`, `OtherScreens.tsx`, `NoScreens.tsx` | The screen the chrome goes on — handed to the chrome, because what a pointer's pixels are worth is that screen's to say — the screens it is not on, and what the page says for a desktop with no screens at all. |
| `src/screens/IdleScreen.tsx` | What a screen with no chrome on it shows: the clock. |
| `src/keyboard/bindings.ts` | The desktop's keys, as the sway config binds them: one table from a key to an action. |
| `src/keyboard/programmers-dvorak.ts` | Which physical key each keysym is on, which is what the table above is resolved through. |
| `src/keyboard/useShortcuts.ts` | The two paths a press can arrive by, and the claim that decides which one answers. |
| `src/keyboard/useModifiers.ts` | Which modifiers are held, from both of the places that can know. |
| `src/address/` | What a line of typed text means as a web address. The launcher's box and a browser window's address bar both ask, and a desktop where the two disagree about `localhost:5173` is one where the user has to remember which box they are in. |
| `src/address/typed-address.ts` | Which of the two a typed line is: a site, or words to search for. |
| `src/address/search.ts` | Where words go: the bang tags, and Google for a query that carries none. |
| `src/address/address-suggestions.ts` | What an address bar offers under itself — what Enter would do, then where the window has been. |
| `src/address/connection-safety.ts` | The browser's own verdict on a connection, parsed at the boundary — and the one state that must never look like the others, which is the browser not having said. |
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
| `src/window-management/title-focus.ts` | Which of sway's three client colors a bar is drawn in, and why a tab needs the third. |
| `src/window-management/pointer-warp.ts` | Where the pointer goes when the desktop moves the focus, the two questions that decide whether it goes anywhere at all, and a window's box in the page's own coordinates rather than the layout's. |
| `src/window-management/usePointerWarp.ts` | The half of that a page has to do: which focus changes were the desktop's own — a keyed press, and a window that has only just opened — where the pointer is, and the render that is late enough to know the window's new box. |
| `src/window-management/AppWindow.tsx` | A Wayland client's window: one `<app>` element. |
| `src/window-management/BrowserWindow.tsx` | A browser window: an address bar over a `<webview>`, and everywhere the shell has sent it. |
| `src/window-management/browser/AddressBar.tsx` | That bar: the history controls, the one button that is Reload or Stop, and the address as a pill with its connection indicator inside it. |
| `src/window-management/browser/ConnectionIndicator.tsx` | The lock at the inline start of the bar, and the panel behind it: the browser's verdict on the connection, drawn from `security_state` rather than guessed from a URL scheme. |
| `src/window-management/useShownPage.ts` | Where the page in a window actually is, what the browser says about the connection behind it, and everywhere it has been — read off the view's own properties, because a chrome that learned the security level from an event alone would have none for the page already showing when it mounted. |
| `src/window-management/useHistoryAvailability.ts` | Where that window's page can be sent, read off the view's own properties rather than learned from the event that says to read them. |
| `src/window-management/useReclaimFocus.ts` | Keeping the document's focus on the window being worked in, but only when it landed on nothing at all — the address bar and the bar's own controls are the user reaching for focus, and a closing window's own control leaves it on the body. Which of the two a `focusout` is comes off the event's `relatedTarget`, because the document is mid-change while it is dispatched. |
| `src/window-management/window-styles.ts` | What every window shares, how one is placed at a rectangle, and how one arrives, settles and leaves. |
| `src/window-management/window-motion.ts` | What a window is doing that the page has to draw over time, and which way a workspace switch went. |
| `src/window-management/shown.ts` | The desktop as the page last drew it, which is the only place a close or a switch survives. |
| `src/window-management/closing.ts` | A window that has closed: the box, the name and the keyboard it had, and where in the list it goes on being drawn. |
| `src/window-management/workspace-switch.ts` | The workspace that has just left the screen, with the screenful it had and the way it went. |
| `src/window-management/useWindowMotion.ts` | Which windows are drawn and what each of them is doing, worked out from the difference between two renders. |
| `src/window-management/floating/float.ts` | A window that has left the tiling: where it sits and how big. Its own module because floating is not a kind of window. |
| `src/window-management/floating/useFloatDrag.ts`, `FloatGrab.tsx`, `FloatTitleBar.tsx` | Dragging and resizing a floating window, the pointer's travel read in the pixels the window was laid out in, and the furniture that offers it. |
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
  launcher keys are what is left: a terminal, and the shell's own launcher.
- **Per-window rules.** `for_window [app_id="launcher"] floating enable` and
  the rest of the config's `window.commands` have no equivalent here: every
  window opens tiled, and floating one is a key away.
- **`reload` and `exit`.** There is no config to re-read and no session to
  end from the page.
- **Outputs, inputs, and the bar's own config.** The compositor owns the
  displays and the keyboard — `manganese.json` is where those are set, below —
  and the bar is this page rather than a swaybar process.
- **Per-window borders and `hideEdgeBorders`.** A window's frame is CSS here,
  and every window wears the same one.

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
compositor built out of this checkout. Nothing reloads the page for you;
`domicile load-shell .vite/renderer/main_window/shell.js`, typed in a terminal
inside that desktop, puts the rebuilt shell on it without stopping it. See
`scripts/dev-shell.sh`.

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
