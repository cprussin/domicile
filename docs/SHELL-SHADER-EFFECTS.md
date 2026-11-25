# Shader effects in a shell

A shell draws its own SkSL over any element: a window closing into smoke, a
sheet of cloth, flecks that scatter, glass over the wallpaper. The GPU
process runs the program in the render pass that holds the element, so the
page never reads a window's pixels. Part of
[WRITING-A-SHELL.md](WRITING-A-SHELL.md). Design:
[MOTION.md](architecture/MOTION.md#shader-primitive).

[`packages/shell-effects-example`](/packages/shell-effects-example) builds
each of the [reference effects](architecture/MOTION.md#reference-effects)
this way: smoke, cloth, swarm, liquid glass and a workspace cube. Its files
are the examples this page names.

## Registering an effect

```ts
const result = await domicile.effects.register("dissolve", {
  sksl: `
    uniform shader content;
    uniform float2 size;
    uniform float progress;

    half4 main(float2 p) {
      return content.eval(p) * half(1.0 - progress);
    }
  `,
});
const dissolve = result.unwrapOrElse((why) => {
  throw new Error(why);
});
```

```css
app[data-closing] {
  filter: domicile-shader(dissolve, 1);
}
```

- `register` compiles the program in the GPU process and resolves a
  `Result`: the registered effect, or the compiler's error or the image that
  did not load.
- `domicile-shader(name, …)` draws it in `filter` or `backdrop-filter`, on
  any element: `<app>`, `<webview>`, your own elements and
  `::view-transition-*`. It composes with the built-in filter functions in
  one list.
- Register before you use the name. A name nothing registered draws nothing
  until it is registered; then every element's style resolves again.
- A second `register` of a name replaces the first.
- The types are in `@domicile-desktop/sdk/desktop/effects`.

### Options

| Option | What it is |
|---|---|
| `sksl` | The program, strict ES2 SkSL, at most 32 KiB. A fragment effect's `half4 main(float2 p)`, or a mesh effect's fragment program. |
| `vertex` | A mesh effect's vertex program. Give it with `mesh`, or neither. |
| `mesh` | `{ grid: [columns, rows] }` or `{ instances: n }`. At most 16384 cells or instances. |
| `images` | Extra inputs by the name of their `uniform shader`: URLs the page can fetch, at most 4, each at most 2048 pixels on a side. The SDK fetches and decodes them. Each repeats. |
| `outset` | How many CSS pixels the effect may draw outside the element, or `"screen"` for the screen's longer side. 0 by default. The engine scales it to device pixels. |

`register` resolves to `{ arguments, update }`: how many numbers
`domicile-shader()` passes, and the call that sets the effect's arrays (see
[Arrays](#arrays)).

## Uniforms and arguments

An effect declares, in this order:

1. `uniform shader content`: the element as drawn, in premultiplied color.
   Sampling outside it gives transparent black.
2. Its images: `uniform shader noise`, and so on. Any `uniform shader` not in
   `images` fails to register.
3. `uniform float2 size`: the element's size in device pixels. It is always
   the first uniform.
4. Its arguments: floats, `float2` to `float4` and matrices, at most 16 floats
   in all. `domicile-shader(name, a, b, c)` fills them in order. A missing
   number is 0 and extras are dropped. The CSS takes numbers only, so give
   lengths and angles as plain numbers.
5. Its arrays: `uniform float4 points[425]`, set by `update`.

Every uniform is a float type. `p` is in device pixels from the element's top
left, and runs out to the outset on every side.

## Units

An effect runs in the device pixels of the render pass that draws it:

- **Device pixels:** `size`, `p`, a mesh's `position` and `uv` varyings, and
  the point `content.eval` takes. An image's `eval` takes the image's own
  pixels.
- **CSS pixels:** `outset`. The engine scales it.
- **Plain numbers:** the arguments and arrays. The engine does not scale
  them.

To measure in CSS pixels, pass `devicePixelRatio` as an argument and scale
by it in the program. An effect that measures only in fractions of `size`
needs no scale.

```glsl
uniform float2 size;
uniform float radius; // CSS pixels
uniform float scale;  // devicePixelRatio

half4 main(float2 p) {
  float r = radius * scale;
  // ...
}
```

```ts
app.style.filter = `domicile-shader(rounded, 12, ${devicePixelRatio})`;
```

- Images are sampled in device pixels too: divide `p` by `scale` for an image
  that keeps its size in CSS pixels, as `src/smoke.ts` does with its noise.
- Points from `getBoundingClientRect` or pointer events are CSS pixels.
  Scale them in the program, as `src/cloth.ts` does, or before `update`.
- `devicePixelRatio` changes when the page moves to a monitor of another
  scale. Set the filter again then: `src/index.ts` watches a
  `(resolution: …dppx)` media query.

Strict ES2 rules apply:

- Loops have constant bounds.
- An array index is a constant or a loop counter. To read the element a
  vertex names, loop over the array and pick it, as `src/cloth.ts` does.
- No recursion, and no integer `%`: use `mod` on floats.

## Mesh effects

An effect with `mesh` and `vertex` draws the element's pixels through a mesh
instead of over its box: a grid for cloth or a page curl, instances for
particles.

```glsl
// vertex
uniform float2 size;
uniform float progress;

Varyings main(const Attributes a) {
  Varyings v;
  v.position = a.uv * size + float2(0.0, progress * size.y); // where it goes
  v.uv = a.uv * size;                                         // what it shows
  v.data = float4(0.0);
  return v;
}
```

```glsl
// fragment
uniform shader content;

float2 main(const Varyings v, out half4 color) {
  color = content.eval(v.uv);
  return v.uv;
}
```

- **`Attributes`**: `uv`, 0 to 1 across the grid or across one instance's
  quad, and `index`, a float. A grid point's index runs row by row, with
  `columns + 1` points in a row. An instance's is its number.
- **`Varyings`**: `position` and `uv` in device pixels from the element's
  top left, and `data`, a `float4` the vertex passes to the fragment as it
  likes.
- `color` is what the mesh draws, in premultiplied color. The returned
  coordinates are unused.
- Only the fragment program samples `content` and images.
- The vertex program's uniforms come first in the order above, then those
  only the fragment program declares. A uniform both declare has one type.
- Each cell or instance is two triangles. Instances overlap in the order of
  their index.

`src/swarm.ts` places 1440 instances from their index alone, in fractions of
`size`. `src/cloth.ts` moves a 24 by 16 grid by points it is given in CSS
pixels, and scales them by its `scale` argument.

## Arrays

```ts
const failed = cloth.update(app, { points: new Float32Array(1700) });
```

- `update(element, arrays)` sets an effect's array uniforms for one element,
  by name. The element draws them in its next frame, in the same commit as its
  filter, with no style recalc.
- A shorter array leaves the rest zero. Arrays are zero until set.
- An element's arrays hold at most 64 KiB across its effects.
- It returns `Some(why)` for an array the effect does not have, or values that
  do not fit, and `None()` otherwise.
- Set them from `requestAnimationFrame` while something moves. A compositor
  animation of the filter keeps the last arrays the page set.

## Animating on the compositor

Shader arguments interpolate like any filter's, so CSS transitions and the Web
Animations API run them on the compositor thread:

```ts
await app.animate(
  [
    { filter: `domicile-shader(smoke, 0, ${devicePixelRatio})` },
    { filter: `domicile-shader(smoke, 1, ${devicePixelRatio})` },
  ],
  { duration: 900, fill: "forwards" },
).finished;
```

- **Outsets must match across keyframes.** The compositor runs a filter
  animation only while the layer's bounds hold. Keep the same effects, with
  the same outsets, in every keyframe. An animation from `none`, or to another
  effect with a different outset, runs on the main thread.
- Start from the effect with its resting arguments, such as
  `domicile-shader(smoke, 0, 2)`, not from `none`.
- The same effect with the same number of arguments interpolates them. A
  missing side is the effect with every argument 0. Two different effects
  step from one to the other halfway.
- A drag sets the arguments from JavaScript each frame.
- Turn effects off when `domicile.appearance.reducedMotion` is `true`.

## Closing a window

A closed window's last frame stays while an `<app>` shows it, up to 10
seconds. To play an effect on it:

1. When the window leaves `domicile.windows.list`, keep its `<app>`.
2. Play the effect.
3. Remove the `<app>`. The frame goes as soon as no `<app>` shows it, or after
   10 seconds.

`src/close.ts` and `closed` in `src/index.ts` do this. To start an opening
window where it came from, read its `launchedFrom` or, for a browser window,
its `opener` ([WRITING-A-SHELL.md](WRITING-A-SHELL.md#windows)).

## Backdrop effects

In `backdrop-filter`, `content` is what is behind the element, `size` is the
element's size and `p` runs from its top left, all in device pixels.

- The result stays inside the element and its `border-radius`.
- The outset widens what the effect reads: with an outset, a refraction near
  the edge reads the backdrop beside the element. `src/liquid-glass.ts`
  reads up to its strength outward, 24 CSS pixels, and has an outset of 32.
- Put `blur()` before the effect to frost the glass:
  `backdrop-filter: blur(6px) domicile-shader(liquid-glass, 18, 22, 24, 1, 2)`,
  where 2 is `devicePixelRatio`.

## Cost

- **A render pass per shaded element.** The element draws offscreen, then the
  effect draws it. At 1600×1000 that is about 13 MB of memory traffic per
  frame, as `opacity` or `blur()` on a window.
- **Outsets grow the pass.** `outset: "screen"` makes the pass the size of
  the screen, and a fragment effect runs for every pixel of it. Use it only
  while the effect plays.
- **A mesh effect's pass always draws offscreen**, even where the element
  would otherwise draw straight to its target, and builds mipmaps each frame
  it changes.
- **No direct scanout** for a window while it is shaded. Effects suit
  transitions, not a permanent state on a fullscreen game or video.
- **Images** stay in the GPU process's memory while the effect is
  registered: width × height × 4 bytes each, 16 MiB for a 2048 square.
- **Backdrop effects** run again on every damage under the element, as
  backdrop blurs do.
- **Arrays** upload with each frame that changes them, up to 64 KiB.

## Limitations

- A mesh effect draws first, and the element's other filters run over it,
  whatever their order in the list.
- An element draws one mesh effect. A later one in the list is skipped.
- A mesh effect in `backdrop-filter` draws nothing.
- A desktop that composites on the CPU draws no effects.
- An effect's run time can depend on pixel values, which the page could
  time. Only the shell registers effects, and the shell is the desktop the
  user chose.

## When the GPU hangs

A hung effect trips the GPU watchdog. The GPU process restarts, and the engine
drops the effects that were drawing. `effects.on("lost")` names each one. Its
filters draw nothing until you register it again:

<!-- tab: React -->

```tsx
const domicile = useDomicile();
useEffect(
  () => domicile.effects.on("lost", (name) => registerAgain(name)),
  [domicile],
);
```

<!-- tab: JavaScript -->

```js
domicile.effects.on("lost", (name) => registerAgain(name));
```

<!-- /tabs -->

Fix the program before registering it again, or it hangs again.
