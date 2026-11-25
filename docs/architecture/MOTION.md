# Motion: shader effects and refined animations

Two pieces of work:

- **A shader primitive for shells.** A shell registers an SkSL program and
  applies it with `filter: domicile-shader(name, …)` or `backdrop-filter`. Viz
  runs it in the render pass that already holds the element, so the page never
  reads window pixels. It is general enough for a shell to build every effect
  in [Reference effects](#reference-effects); manganese ships a few.
- **A motion pass over manganese.** Springs in place of fixed curves,
  animations that change course midway, motion that starts where its cause is,
  then shader effects where they add something.

Shaders make motion richer, not cheaper. Every manganese motion already runs
on the compositor thread (`packages/animated-properties`). A shaded element
costs one more render pass.

## Shader primitive

### API

```ts
const dissolve = await domicile.effects.register("dissolve", {
  outset: 0, // px it may draw outside the box, or "screen"
  sksl: `
    uniform shader content;
    uniform float2 size;
    uniform float progress;
    half4 main(float2 p) { … }
  `,
});

const swarm = await domicile.effects.register("swarm", {
  mesh: { instances: 4096 }, // or { grid: [32, 32] }
  outset: "screen",
  images: { noise: noiseUrl }, // extra child shaders
  vertex: `…`, // SkSL vertex program, per vertex or instance
  sksl: `…`,
});

// Arrays a CSS function cannot carry, such as a cloth simulation's points.
// `register` resolves to a Result; `update` returns why it failed, if it did.
swarm.unwrap().update(element, { points: new Float32Array(…) });
```

```css
app[data-closing] {
  filter: domicile-shader(dissolve, 1);
  transition: filter 250ms;
}
.glass { backdrop-filter: domicile-shader(refract, 0.8) blur(4px); }
```

- **`register`** compiles the program and rejects with the compiler's error.
  Uniforms after `content` and `size` are the function's numeric arguments, in
  order, up to 16 floats.
- **Any element.** `<app>`, `<webview>`, shell chrome and
  `::view-transition-*` pseudo-elements.
- **Animation.** cc interpolates the arguments, so CSS transitions and the Web
  Animations API run on the compositor thread. A drag's spring sets them from
  JS each frame. The drag already runs there.
- **Meshes.** An effect with `mesh` and `vertex` draws the element's pixels
  through an `SkMesh`: a grid for cloth or a page curl, instances for
  particles. Without them it is a fragment shader over the box.
- **`outset`** may reach the whole screen, for smoke or particles that leave
  the window.
- **`images`** are extra inputs: noise, masks, sprites.
- **`update`** sets array uniforms from JS, up to 64 KiB per element per
  frame.
- **`time` uniform**, opt in. It redraws every vsync, so a shell uses it only
  while something animates.
- **Closed windows.** A closed window's last frame stays while its `<app>`
  stays in the page, up to 10 s, so a close effect plays on its pixels. It
  goes as soon as no `<app>` shows it (`engine_lingering.rs`).
- **Where a window came from.** A window lists `launchedFrom`, the `from` its
  launch named (`launch(argv, "launcher")`), and a browser window lists its
  `opener`, so an open motion can start there.
- **Composes** with the built-in filter functions in one `filter` list.

### Engine

```
 shell JS: register(name, sksl) ──mojo──▶ viz: SkRuntimeEffect per frame sink, by id
 CSS filter: domicile-shader(id, args) ──▶ blink FilterOperation ──▶ cc::FilterOperation SHADER
                                                                     │ (interpolated on the
                                                                     │  compositor thread)
                                                                     ▼
                         SkiaRenderer render pass filter: SkImageFilters::RuntimeShader
```

- **Blink:** parses `domicile-shader()` in `filter` and `backdrop-filter`, interpolates it,
  and converts it to cc.
- **cc / mojo:** a `SHADER` filter carries an effect id and its floats. The
  source crosses once, at register.
- **Viz:** runs a fragment effect where `blur()` runs, in `SkiaRenderer`'s
  render pass filters. A mesh effect draws the element's render pass as the
  mesh's texture with `drawMesh`. Works on Ganesh and Graphite.
- **Gate:** an origin trial feature for `domicile://shell/` only, as `<app>`
  is (patch 0116). Viz refuses effects from any other frame sink.
- **As built (patch 0273, fragment effects):** the shell calls
  `registerShaderEffect(name, init)`. The browser's `ShaderEffects`
  service, which only a shell document can bind, hands the source to viz
  through `HostFrameSinkManager`. That service keeps it to register again
  after a GPU restart. Viz compiles the source and keeps it under the shell's
  `FrameSinkId`. The aggregator attaches the program only to a pass of that
  frame sink. `size` and `p` are in the pass's device pixels: Skia drops a
  runtime shader under the display scale's local matrix, so viz runs the
  effect unscaled and scales only its outset. An effect with an outset moves
  pixels, so its animations run on the main thread. One with no outset
  animates on the compositor. The software renderer draws no effects.
- **As built (patch 0274, meshes, images and arrays):**
  - A mesh effect's `SkMeshSpecification` has two attributes, `uv` (0 to 1
    across the grid or quad) and `index` (the grid point's or the
    instance's), and three varyings, `position`, `uv` and `data`. Viz builds
    the vertex buffer once, at register, with two triangles per cell or
    instance, at most 16384. Its `size` and varyings are in the pass's
    device pixels, as a fragment effect's are.
  - The aggregator mipmaps a pass whose quad has a mesh effect, so the pass
    has a texture to sample and is never bypassed. `SkiaRenderer` draws the
    quad with `drawMesh` on a layer that takes the other filters, the mask,
    the opacity and the blend mode. The mesh draws first and the other
    filters run over it, whatever their order in the list. A mesh effect in
    `backdrop-filter` draws nothing.
  - Images cross with the source, as RGBA pixels: at most 4, 2048 on a side.
    The SDK fetches and decodes them.
  - Arrays ride on the `SHADER` filter, after its arguments, through the
    layer tree's effect node to viz. The route keeps an element's arrays in
    the same commit as its filter, so an array and the argument that goes
    with it land in one frame, and needs no new channel. `update()` stores
    the arrays on the element and marks its effect node dirty, so Blink
    rebuilds the filter in the next frame without a style recalc. A
    compositor animation of the filter keeps the arrays the page committed.
    An element's arrays hold at most 64 KiB.
  - `outset: "screen"` is the viewport's longer side.
  - A filter animation whose only pixel-moving filters are shader effects
    runs on the compositor when every keyframe has the same outsets, since
    the layer's bounds then hold.

### Key decisions

- **SkSL over WGSL.** Skia runs it natively in viz's passes. Android exposes
  the same language (AGSL) to untrusted apps, so its compiler is hardened and
  fuzzed. WGSL has no path into a Skia render pass.
- **SkSL over GLSL.** GLSL goes straight to the driver's compiler.
- **A filter function over a WebGPU canvas.** A canvas would need window
  pixels in the page. A filter keeps them in viz and animates without the main
  thread.
- **Meshes in the primitive.** Cloth, a page curl and particles need vertices.
  A fragment shader faking them searches neighbors per pixel and costs more.
- **3D through CSS.** Rotations and a workspace cube are CSS 3D transforms
  (`perspective`, `preserve-3d`) on the workspaces. No shader needed.

### Cost

- **A render pass per shaded element:** about 13 MB of memory traffic per
  frame at 1600×1000, the same as `opacity` or `blur()` on a window today.
- **No direct scanout** for a window while it is shaded. Effects suit
  transitions, not a permanent state on a fullscreen game or video.
- **Backdrop shaders over live windows** run again on every damage under them,
  as backdrop blurs do.

### Security

- **GPU process.** Effects run inside the GPU sandbox. Only the shell can
  register one.
- **Strict ES2 SkSL.** Constant loop bounds, a source size limit, at most 16
  uniforms.
- **Timing.** An effect's run time can depend on pixel values, which the page
  could time. The shell is the user's chosen desktop, so Domicile accepts it.
  `SHELL-*` docs say so.
- **A hung effect** trips the GPU watchdog. The GPU process relaunches (patch
  0074) and the engine drops the effect that hung, with an error to the shell.

## Reference effects

From a Hyprland setup on r/unixporn (frames: project files
`shader-effects/reference-contact-*.png`). Domicile ships none of them as is;
a shell can build each.

| Effect | What it does | Built with |
|---|---|---|
| Smoke | the window bursts into dark smoke that drifts and thins | fragment effect, `outset: "screen"`, noise image, `progress` |
| Cloth | the window flaps and blows away like a sheet | grid mesh; points from a JS cloth simulation through `update` |
| Swarm | the window breaks into flecks that scatter | instanced mesh, one fleck per instance sampling `content` |
| Liquid | refractive glass panels with color fringes | `backdrop-filter` fragment effect |
| Construction | the window is built block by block, small workers on it | fragment effect revealing tiles; workers are shell elements over it |
| Rotation | workspaces turn about an axis | CSS 3D transforms |
| Cube | workspaces on the faces of a cube, inside or out | CSS 3D transforms |

## Motion pass

### Rules

- **Springs.** Tokens `springs.snappy`, `springs.smooth` and `springs.bouncy`,
  each a CSS `linear()` easing sampled from a spring, with its settle time as
  the duration. Fixed curves stay for fades.
- **Interruptible.** A motion that is reversed or retargeted starts from where
  it is on screen. Transitions do this; keyframes snap. Each motion below that
  can be interrupted moves to a transition or to an animation that reads its
  current transform.
- **From its cause.** A panel grows from its bar button, a dialog from the
  window that asked, a sent window toward its workspace in the switcher.
- **Compositor only.** `transform`, `opacity`, `filter` and `clip-path`, as
  `animated-properties` enforces. A sized animation becomes a transform.
- **Reduced motion** keeps its fastest-duration override
  (`html[data-reduced-motion]`). Shader effects are off under it.
- **Shader effects are on by default**, with a Settings switch
  (`shell_options.effects.windows`).
- **An effect applies only while `<html>`'s `data-shader-effects` lists it.**
  The shell registers every effect once at start (`useShaderEffects`) and
  lists those that compiled, while they are switched on and motion is not
  reduced. An effect the engine reports `lost` is dropped from the list and
  logged, not registered again: it may have hung the GPU. Its motion plays
  without it.
- **Effects measure in CSS pixels.** Each takes `scale` last, the device
  pixels to a CSS pixel, and divides `p` or multiplies its lengths by it. The
  shell sets `--device-pixel-ratio` on `<html>` from `devicePixelRatio` with
  the list, and each motion passes `var(--device-pixel-ratio)`.
- **Each change ships with a before and after recording** for review.

### Windows

| Motion | Today | Refined | Shader effect |
|---|---|---|---|
| Open | fade, scale 0.85 → 1 | `springs.smooth` scale from the launcher or the window that opened it | none |
| Close | fade, scale 1 → 0.85 | `springs.snappy` | dissolve |
| Tab open / close | grow from or shrink into the tab (0.15) | spring, tab edge as a faded layer (no `box-shadow` keyframes) | none |
| Tab switch | crossfade | short directional slide plus crossfade | ripple wipe, optional |
| Send to workspace | fade, scale 0.6 | fly to the target in the workspace switcher | genie into the chip |
| Workspace switch | slide one width, `emphasized` | spring, reversible mid-slide | slight motion blur along the slide |
| Restack | translate out and back | spring | none |
| Scratchpad show / hide | slide from the top | spring, reversible | none |
| Picture in picture | grow, return | spring from the video's box | none |
| Drag | follows the pointer | spring lag on release | wobbly |

### Overview

| Motion | Today | Refined | Shader effect |
|---|---|---|---|
| Open / close | camera pull-back by transform | spring, reversible mid-pinch, follows a 4-finger pinch's progress | depth of field on the wallpaper |
| Tile size | `block-size` / `inline-size` transitions (main thread) | scale transform | none |
| Card swap | slide | spring | none |

### Shell surfaces

| Surface | Today | Refined | Shader effect |
|---|---|---|---|
| Bar panels (quick settings, sound, network, notifications, cast, downloads) | `Popover`: fade, scale 0.96 | grow from the bar button with `springs.snappy` | none |
| Panel drawers (`ListRow` details) | base-ui collapsible height | scale reveal (clip-path), content fade | none |
| Launcher | `ModalDialog`: fade, rise, scale 0.96 | spring from the launcher button or screen center | frosted backdrop |
| Dialogs (`ModalDialog`, `PageModal`, page requests) | fade, rise, scale 0.96 | spring from the asking window | none |
| Slide-overs | slide from the edge | spring | none |
| File picker | fade, rise, scale 0.96 | spring from the asking window | none |
| Screenshot / screencast region picker | fade | dim fades in, selection snaps with a spring | none |
| Recording toolbar | ping ring | spring in from the screen edge it sits at | none |
| Toasts and level toasts | slide in, swipe out | spring, swipe follows velocity | none |
| Notification drawer | rows slide out, `min-block-size` closes (main thread) | spring, closing height as a transform | none |
| Context menus, selects, tooltips | fade | fade plus a 2px rise from the anchor | none |
| Workspace switcher highlight | `clip-path` with `outBack` | `springs.bouncy` | none |
| Lock | fade with backdrop blur | spring rise of the clock and field | none |
| Theme switch | view transition wipe | unchanged | soft-edged wipe |
| Wallpaper | 2 s crossfade | unchanged | none |

## Plan

Starts after the next release.

Tooling:

- [ ] `springs.*` easing tokens in `component-library`'s preset, generated from
      spring parameters, with a unit test of the sampled curve
- [x] a motion harness: manganese in Playwright, records frames of one motion,
      fails if any animation of it runs on the main thread
- [x] Storybook page that plays each motion at 0.1× speed

Windows (no engine change):

- [x] open, close, tab open / close, restack on springs; tab edge as a layer
- [x] open from the window that opened it, for a client's dialog
      (`transientFor`)
- [ ] open from the launcher, or a browser popup from its opener (needs the
      engine to say what opened a window)
- [x] workspace switch and scratchpad as reversible transitions
- [x] send to workspace flies to its switcher chip
- [x] tab switch directional slide
- [x] picture-in-picture on springs
- [x] drag release on springs

Overview:

- [x] tile size as a transform
- [x] open / close follows pinch progress and reverses mid-gesture

Shell surfaces:

- [x] `Popover` and bar panels grow from their trigger
- [x] `ModalDialog`, `PageModal`, file picker and launcher spring from their
      origin
- [x] slide-overs, toasts, level toasts on springs; swipe velocity
- [x] notification drawer close as a transform
- [x] region picker and recording toolbar
- [x] context menus, selects, tooltips
- [x] lock entrance; workspace switcher highlight

Shader primitive (engine):

- [x] `cc::FilterOperation` `SHADER`, mojo, `SkiaRenderer` filter, guard on
      `crux` that reads a shaded `<app>` off the compositor's readback
      (`guard-shader-effect.sh`)
- [x] Blink `domicile-shader()` parsing and interpolation
- [x] `domicile.effects.register` in the SDK, the shell-only gate, the GPU
      hang handling
- [x] mesh effects: `SkMesh` grid and instances, `vertex`, `update` arrays
      (`guard-shader-mesh.sh`)
- [x] `images` inputs and `outset: "screen"` (`guard-shader-image.sh`)
- [x] a closed window's last frame stays while its `<app>` does
- [x] where a window came from: its launch, or the browser window that
      opened it
- [x] guard on `crux` for CSS 3D transforms on `<app>`
      (`guard-app-3d-transform.sh`)
- [ ] `examples/`: smoke, cloth, swarm, liquid and cube, as proof each
      reference effect builds
- [ ] docs: `SHELL-*` page with the API, costs and the timing note

Shader effects in manganese:

- [x] dissolve on close
- [ ] genie on send to workspace (needs mesh effects)
- [ ] wobbly drag (needs mesh effects)
- [x] workspace switch motion blur, overview depth of field
- [x] theme switch soft-edged wipe
- [x] launcher frosted backdrop (`frost` on `ModalDialog`'s glass backdrop)
- [x] Settings switch for window effects

## Open questions

- **A `time` uniform in the first engine PR?** Recommend no. Nothing in the
  first effects needs it.
