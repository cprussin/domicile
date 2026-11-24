// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_VIZ_SERVICE_DISPLAY_DOMICILE_SHADER_EFFECTS_H_
#define COMPONENTS_VIZ_SERVICE_DISPLAY_DOMICILE_SHADER_EFFECTS_H_

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
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
#include "third_party/skia/include/core/SkImageFilter.h"
#include "third_party/skia/include/core/SkMatrix.h"
#include "third_party/skia/include/core/SkRefCnt.h"
#include "third_party/skia/include/effects/SkRuntimeEffect.h"
#include "ui/gfx/geometry/rect_f.h"

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
namespace viz::domicile {

// The longest program a shell may register, in bytes.
inline constexpr size_t kMaxShaderEffectSource = 32 * 1024;

struct CompiledShaderEffect {
  sk_sp<SkRuntimeEffect> program;
  // How many floats the effect takes after `size`.
  uint32_t arguments = 0;
};

// Compiles `sksl` as strict ES2 SkSL, or says why it is not an effect.
base::expected<CompiledShaderEffect, std::string> CompileShaderEffect(
    std::string_view sksl);

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

  // Effect `id`'s program, if `owner` registered it.
  sk_sp<SkRuntimeEffect> Find(uint32_t id, const FrameSinkId& owner) const;

  // Says which effects `drawer` (a display's aggregator) drew in its last
  // frame. The browser hears the union whenever it changes, so that after a
  // GPU hang it can drop the effects that were drawing. An empty set forgets
  // `drawer`.
  void SetDrawing(const void* drawer, base::flat_set<uint32_t> ids);

  // mojom::DomicileShaderEffects:
  void Register(uint32_t id,
                const FrameSinkId& owner,
                const std::string& sksl,
                RegisterCallback callback) override;
  void Unregister(uint32_t id) override;

 private:
  struct Effect {
    FrameSinkId owner;
    sk_sp<SkRuntimeEffect> program;
  };

  void ReportDrawing();

  base::flat_map<uint32_t, Effect> effects_;
  base::flat_map<const void*, base::flat_set<uint32_t>> drawing_;
  base::flat_set<uint32_t> reported_;
  mojo::Receiver<mojom::DomicileShaderEffects> receiver_{this};
  mojo::Remote<mojom::DomicileShaderEffectsClient> client_;
};

// `filters` with each SHADER filter `owner` may draw given its program, and
// the ids of those effects added to `drawn`. Any other SHADER filter is left
// without one, so it draws nothing.
cc::FilterOperations ResolveShaderEffects(const cc::FilterOperations& filters,
                                          const ShaderEffects& effects,
                                          const FrameSinkId& owner,
                                          base::flat_set<uint32_t>& drawn);

// The image filter for `filters`, some of them SHADER filters, over content
// whose bounds in the pass are `content`. `local_matrix` maps filter space to
// the pass's, as SkiaRenderer's does. cc's filters run in filter space as cc
// builds them; each effect runs in the pass's pixels, its outset scaled, and
// gets what came before it as `content`. A SHADER filter without a program
// is skipped.
sk_sp<SkImageFilter> BuildShadedImageFilter(const cc::FilterOperations& filters,
                                            const gfx::RectF& content,
                                            const SkMatrix& local_matrix);

}  // namespace viz::domicile

#endif  // COMPONENTS_VIZ_SERVICE_DISPLAY_DOMICILE_SHADER_EFFECTS_H_
