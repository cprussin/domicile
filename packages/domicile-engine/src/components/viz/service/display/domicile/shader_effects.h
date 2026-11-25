// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_VIZ_SERVICE_DISPLAY_DOMICILE_SHADER_EFFECTS_H_
#define COMPONENTS_VIZ_SERVICE_DISPLAY_DOMICILE_SHADER_EFFECTS_H_

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/containers/flat_map.h"
#include "base/containers/flat_set.h"
#include "base/types/expected.h"
#include "cc/paint/filter_operations.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "services/viz/privileged/mojom/compositing/frame_sink_manager.mojom.h"
#include "third_party/skia/include/core/SkImage.h"
#include "third_party/skia/include/core/SkImageFilter.h"
#include "third_party/skia/include/core/SkMatrix.h"
#include "third_party/skia/include/core/SkMesh.h"
#include "third_party/skia/include/core/SkRefCnt.h"
#include "third_party/skia/include/core/SkSamplingOptions.h"
#include "third_party/skia/include/effects/SkRuntimeEffect.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/size.h"

class SkCanvas;

// A shell's shader effects: SkSL programs it registers and applies with
// `filter: domicile-shader(name, …)` or `backdrop-filter`. See
// docs/architecture/MOTION.md#shader-primitive.
//
// An effect is a fragment shader over the content it shades:
//
//   uniform shader content;  // the content, in its own pixels
//   uniform float2 size;     // the content's size
//   uniform float progress;  // then the function's arguments, in order
//   half4 main(float2 p) { return content.eval(p) * progress; }
//
// `p` is in the content's own coordinates, from its top left, in the render
// pass's pixels: device pixels at the element's raster scale, as `size` is.
// The effect may draw up to its outset past the content.
//
// A mesh effect draws the content through an SkMesh instead: a grid of
// cells, or instances of a quad. Its vertex program places each vertex:
//
//   uniform float2 size;
//   Varyings main(const Attributes a) {
//     Varyings v;
//     v.position = a.uv * size;  // where the vertex goes
//     v.uv = a.uv * size;        // where in the content it shows
//     v.data = float4(0);
//     return v;
//   }
//
// and its fragment program colors it:
//
//   uniform shader content;
//   uniform float2 size;
//   float2 main(const Varyings v, out half4 color) {
//     color = content.eval(v.uv);
//     return v.position;
//   }
//
// `Attributes` holds `uv`, from 0 to 1 across the grid or the quad, and
// `index`: the grid point's, row by row, or the instance's. `Varyings` holds
// `position` and `uv`, in the content's coordinates in the pass's pixels, as
// `p` is, and `data`, a float4 the vertex program passes on as it likes. A mesh
// effect in `backdrop-filter` draws nothing.
//
// Either kind may sample images (`uniform shader noise;`), which repeat, and
// take array uniforms (`uniform float2 points[64];`), which the shell sets
// per element with `update()` and which are zero until it does.
namespace viz::domicile {

// The longest program a shell may register, in bytes.
inline constexpr size_t kMaxShaderEffectSource = 32 * 1024;
// The most images an effect samples, and the longest side of one.
inline constexpr size_t kMaxShaderEffectImages = 4;
inline constexpr int kMaxShaderEffectImageSide = 2048;
// The most cells or instances a mesh has: six vertices each.
inline constexpr uint32_t kMaxMeshCells = 16 * 1024;

// An image an effect samples by `name`: `size` of unpremultiplied RGBA,
// rows top first.
struct ShaderEffectImage {
  std::string name;
  gfx::Size size;
  std::vector<uint8_t> pixels;
};

// What a shell registers. A mesh effect has a `vertex` program and either a
// grid of `columns` by `rows` cells or `instances` quads.
struct ShaderEffectSource {
  ShaderEffectSource();
  ShaderEffectSource(const ShaderEffectSource&);
  ShaderEffectSource(ShaderEffectSource&&);
  ShaderEffectSource& operator=(const ShaderEffectSource&);
  ShaderEffectSource& operator=(ShaderEffectSource&&);
  ~ShaderEffectSource();

  std::string sksl;
  std::string vertex;
  uint32_t columns = 0;
  uint32_t rows = 0;
  uint32_t instances = 0;
  std::vector<ShaderEffectImage> images;
};

// An array uniform an effect takes, and how many floats it holds.
struct ShaderEffectArray {
  std::string name;
  uint32_t floats = 0;

  friend bool operator==(const ShaderEffectArray&,
                         const ShaderEffectArray&) = default;
};

// What a SHADER filter draws with besides its program, which viz attaches
// as `cc::FilterOperation::shader_inputs()`: the images, and a mesh
// effect's mesh.
class ShaderEffectInputs : public SkRefCnt {
 public:
  ShaderEffectInputs();
  ShaderEffectInputs(const ShaderEffectInputs&) = delete;
  ShaderEffectInputs& operator=(const ShaderEffectInputs&) = delete;
  ~ShaderEffectInputs() override;

  // The images, by the child each fills.
  std::vector<std::pair<std::string, sk_sp<SkImage>>> images;
  // A mesh effect's specification and vertices; null for a fragment effect.
  sk_sp<SkMeshSpecification> mesh;
  sk_sp<SkMesh::VertexBuffer> vertices;
  size_t vertex_count = 0;
};

struct CompiledShaderEffect {
  CompiledShaderEffect();
  CompiledShaderEffect(const CompiledShaderEffect&);
  CompiledShaderEffect(CompiledShaderEffect&&);
  CompiledShaderEffect& operator=(const CompiledShaderEffect&);
  CompiledShaderEffect& operator=(CompiledShaderEffect&&);
  ~CompiledShaderEffect();

  // A fragment effect's program; null for a mesh effect.
  sk_sp<SkRuntimeEffect> program;
  sk_sp<ShaderEffectInputs> inputs;
  // How many floats the effect takes after `size`.
  uint32_t arguments = 0;
  // Its array uniforms, in the order it declares them.
  std::vector<ShaderEffectArray> arrays;
};

// Compiles `source` as strict ES2 SkSL, or says why it is not an effect.
base::expected<CompiledShaderEffect, std::string> CompileShaderEffect(
    const ShaderEffectSource& source);
// A fragment effect of `sksl` alone.
base::expected<CompiledShaderEffect, std::string> CompileShaderEffect(
    std::string_view sksl);

// A mesh's vertices, three floats each: `uv`, then `index`. Two triangles
// for each of `columns` by `rows` cells, or for each of `instances` quads.
std::vector<float> MeshVertices(uint32_t columns,
                                uint32_t rows,
                                uint32_t instances);

// The effects shells registered, by id. Viz has one, on its SurfaceManager.
//
// The browser assigns ids and names the frame sink each effect is for. Only
// that frame sink's frames draw it: a SHADER filter anywhere else draws
// nothing.
class ShaderEffects : public mojom::DomicileShaderEffects {
 public:
  ShaderEffects();
  ShaderEffects(const ShaderEffects&) = delete;
  ShaderEffects& operator=(const ShaderEffects&) = delete;
  ~ShaderEffects() override;

  // Binds the browser's end. A new one replaces the last, whose effects went
  // with it.
  void Bind(mojo::PendingReceiver<mojom::DomicileShaderEffects> receiver,
            mojo::PendingRemote<mojom::DomicileShaderEffectsClient> client);

  // Effect `id`, if `owner` registered it.
  const CompiledShaderEffect* Find(uint32_t id, const FrameSinkId& owner) const;

  // Says which effects `drawer` (a display's aggregator) drew in its last
  // frame. The browser hears the union whenever it changes, so that after a
  // GPU hang it can drop the effects that were drawing. An empty set forgets
  // `drawer`.
  void SetDrawing(const void* drawer, base::flat_set<uint32_t> ids);

  // mojom::DomicileShaderEffects:
  void Register(uint32_t id,
                const FrameSinkId& owner,
                mojom::DomicileShaderEffectSourcePtr source,
                RegisterCallback callback) override;
  void Unregister(uint32_t id) override;

 private:
  struct Effect {
    FrameSinkId owner;
    CompiledShaderEffect compiled;
  };

  void ReportDrawing();

  base::flat_map<uint32_t, Effect> effects_;
  base::flat_map<const void*, base::flat_set<uint32_t>> drawing_;
  base::flat_set<uint32_t> reported_;
  mojo::Receiver<mojom::DomicileShaderEffects> receiver_{this};
  mojo::Remote<mojom::DomicileShaderEffectsClient> client_;
};

// `filters` with each SHADER filter `owner` may draw given its program and
// inputs, and the ids of those effects added to `drawn`. Any other SHADER
// filter is left without them, so it draws nothing.
cc::FilterOperations ResolveShaderEffects(const cc::FilterOperations& filters,
                                          const ShaderEffects& effects,
                                          const FrameSinkId& owner,
                                          base::flat_set<uint32_t>& drawn);

// The image filter for `filters`, some of them SHADER filters, over content
// whose bounds in the pass are `content`. `local_matrix` maps filter space to
// the pass's, as SkiaRenderer's does. cc's filters run in filter space as cc
// builds them; each effect runs in the pass's pixels, its outset scaled, and
// gets what came before it as `content`. A SHADER filter without a program
// is skipped, as a mesh effect is: SkiaRenderer draws that one itself, with
// DrawMeshEffect.
sk_sp<SkImageFilter> BuildShadedImageFilter(const cc::FilterOperations& filters,
                                            const gfx::RectF& content,
                                            const SkMatrix& local_matrix);

// The first mesh effect in `filters`, which SkiaRenderer draws, or null. An
// element draws one mesh; later ones are skipped.
const cc::FilterOperation* FindMeshEffect(const cc::FilterOperations& filters);

// Where mesh effect `op` may draw over a render pass quad of `quad_rect`, in
// the quad's space: the content out to its outset.
gfx::RectF MeshEffectBounds(const cc::FilterOperation& op,
                            const gfx::Rect& quad_rect,
                            const SkMatrix& local_matrix);

// Draws mesh effect `op` into `canvas`, whose matrix maps the quad's space to
// the target, with the pass's `content` as its `content` child.
// `tex_coord_rect` is the part of `content` the quad's `quad_rect` shows.
// The caller puts the other filters, the opacity and the blend mode on a
// layer around it.
void DrawMeshEffect(SkCanvas& canvas,
                    const cc::FilterOperation& op,
                    const sk_sp<SkImage>& content,
                    const gfx::Rect& quad_rect,
                    const gfx::RectF& tex_coord_rect,
                    const SkMatrix& local_matrix,
                    const SkSamplingOptions& sampling);

}  // namespace viz::domicile

#endif  // COMPONENTS_VIZ_SERVICE_DISPLAY_DOMICILE_SHADER_EFFECTS_H_
