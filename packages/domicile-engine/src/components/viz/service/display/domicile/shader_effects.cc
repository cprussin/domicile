// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/viz/service/display/domicile/shader_effects.h"

#include <algorithm>
#include <cmath>
#include <utility>

#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "cc/paint/filter_operation.h"
#include "cc/paint/paint_filter.h"
#include "cc/paint/render_surface_filters.h"
#include "third_party/skia/include/core/SkData.h"
#include "third_party/skia/include/core/SkString.h"
#include "third_party/skia/include/core/SkTileMode.h"
#include "third_party/skia/include/effects/SkImageFilters.h"
#include "ui/gfx/geometry/outsets_f.h"
#include "ui/gfx/geometry/rect_conversions.h"
#include "ui/gfx/geometry/skia_conversions.h"
#include "ui/gfx/geometry/vector2d_f.h"

namespace viz::domicile {

namespace {

using Uniform = SkRuntimeEffect::Uniform;

bool IsFloats(Uniform::Type type) {
  switch (type) {
    case Uniform::Type::kFloat:
    case Uniform::Type::kFloat2:
    case Uniform::Type::kFloat3:
    case Uniform::Type::kFloat4:
    case Uniform::Type::kFloat2x2:
    case Uniform::Type::kFloat3x3:
    case Uniform::Type::kFloat4x4:
      return true;
    case Uniform::Type::kInt:
    case Uniform::Type::kInt2:
    case Uniform::Type::kInt3:
    case Uniform::Type::kInt4:
      return false;
  }
  return false;
}

// `program`'s uniforms: `size`, then `arguments` across the rest in order.
// Arguments past the last uniform are dropped and missing ones are zero.
sk_sp<SkData> Uniforms(const SkRuntimeEffect& program,
                       const gfx::SizeF& size,
                       const std::vector<float>& arguments) {
  std::vector<float> values(program.uniformSize() / sizeof(float), 0.f);
  size_t next = 0;
  for (const Uniform& uniform : program.uniforms()) {
    const size_t at = uniform.offset / sizeof(float);
    if (uniform.name == "size") {
      values[at] = size.width();
      values[at + 1] = size.height();
    } else {
      const size_t count = uniform.sizeInBytes() / sizeof(float);
      for (size_t i = 0; i < count && next < arguments.size(); ++i) {
        values[at + i] = arguments[next++];
      }
    }
  }
  return SkData::MakeWithCopy(values.data(), values.size() * sizeof(float));
}

// Effect `op` over content in `content`, reading what `input` drew. All in
// the pass's pixels; `outset` is the effect's outset in them.
sk_sp<SkImageFilter> Shade(const cc::FilterOperation& op,
                           const gfx::RectF& content,
                           const gfx::Vector2dF& outset,
                           sk_sp<SkImageFilter> input) {
  const sk_sp<SkRuntimeEffect>& program = op.shader_runtime_effect();
  SkRuntimeEffectBuilder builder(
      program, Uniforms(*program, content.size(), op.shader_arguments()));
  // The effect may read anywhere in the content from anywhere it draws.
  const float reach = std::max(content.width(), content.height()) +
                      2 * std::max(outset.x(), outset.y());
  // `p` runs from the content's top left. The local matrix moves only the
  // effect, so `input` keeps the pass's space.
  sk_sp<SkImageFilter> shaded =
      SkImageFilters::RuntimeShader(builder, reach, "content", nullptr);
  if (!shaded) {
    return input;
  }
  shaded = shaded->makeWithLocalMatrix(
      SkMatrix::Translate(content.x(), content.y()));
  gfx::RectF drawn = content;
  drawn.Outset(gfx::OutsetsF::VH(outset.y(), outset.x()));
  return SkImageFilters::Crop(
      gfx::RectFToSkRect(drawn), SkTileMode::kDecal,
      input ? SkImageFilters::Compose(std::move(shaded), std::move(input))
            : std::move(shaded));
}

}  // namespace

base::expected<CompiledShaderEffect, std::string> CompileShaderEffect(
    std::string_view sksl) {
  if (sksl.size() > kMaxShaderEffectSource) {
    return base::unexpected(base::StrCat(
        {"an effect is at most ", base::NumberToString(kMaxShaderEffectSource),
         " bytes of SkSL"}));
  }
  // Strict ES2: constant loop bounds, no recursion.
  SkRuntimeEffect::Result result =
      SkRuntimeEffect::MakeForShader(SkString(sksl.data(), sksl.size()));
  if (!result.effect) {
    return base::unexpected(std::string(result.errorText.c_str()));
  }
  const SkRuntimeEffect& program = *result.effect;

  const auto children = program.children();
  if (children.size() != 1 || children[0].name != "content" ||
      children[0].type != SkRuntimeEffect::ChildType::kShader) {
    return base::unexpected(
        std::string("an effect's only child is `uniform shader content`"));
  }

  const auto uniforms = program.uniforms();
  if (uniforms.empty() || uniforms[0].name != "size" ||
      uniforms[0].type != Uniform::Type::kFloat2 || uniforms[0].isArray()) {
    return base::unexpected(
        std::string("an effect's first uniform is `uniform float2 size`"));
  }
  size_t floats = 0;
  for (const Uniform& uniform : uniforms) {
    if (!IsFloats(uniform.type)) {
      return base::unexpected(
          base::StrCat({"an effect's arguments are floats, and `", uniform.name,
                        "` is not"}));
    }
    floats += uniform.sizeInBytes() / sizeof(float);
  }
  // `size` is not an argument.
  floats -= 2;
  if (floats > cc::FilterOperation::kMaxShaderArguments) {
    return base::unexpected(base::StrCat(
        {"an effect takes at most ",
         base::NumberToString(cc::FilterOperation::kMaxShaderArguments),
         " floats after `size`, and this one takes ",
         base::NumberToString(floats)}));
  }
  return CompiledShaderEffect{std::move(result.effect),
                              static_cast<uint32_t>(floats)};
}

ShaderEffects::ShaderEffects() = default;
ShaderEffects::~ShaderEffects() = default;

void ShaderEffects::Bind(
    mojo::PendingReceiver<mojom::DomicileShaderEffects> receiver,
    mojo::PendingRemote<mojom::DomicileShaderEffectsClient> client) {
  receiver_.reset();
  client_.reset();
  effects_.clear();
  reported_.clear();
  receiver_.Bind(std::move(receiver));
  client_.Bind(std::move(client));
  ReportDrawing();
}

sk_sp<SkRuntimeEffect> ShaderEffects::Find(uint32_t id,
                                           const FrameSinkId& owner) const {
  auto effect = effects_.find(id);
  if (effect == effects_.end() || effect->second.owner != owner) {
    return nullptr;
  }
  return effect->second.program;
}

void ShaderEffects::SetDrawing(const void* drawer,
                               base::flat_set<uint32_t> ids) {
  if (ids.empty()) {
    drawing_.erase(drawer);
  } else {
    drawing_.insert_or_assign(drawer, std::move(ids));
  }
  ReportDrawing();
}

void ShaderEffects::Register(uint32_t id,
                             const FrameSinkId& owner,
                             const std::string& sksl,
                             RegisterCallback callback) {
  auto compiled = CompileShaderEffect(sksl);
  if (!compiled.has_value()) {
    std::move(callback).Run(0, compiled.error());
  } else {
    effects_.insert_or_assign(id, Effect{owner, compiled->program});
    std::move(callback).Run(compiled->arguments, std::string());
  }
}

void ShaderEffects::Unregister(uint32_t id) {
  effects_.erase(id);
}

void ShaderEffects::ReportDrawing() {
  base::flat_set<uint32_t> drawing;
  for (const auto& [drawer, ids] : drawing_) {
    drawing.insert(ids.begin(), ids.end());
  }
  if (drawing != reported_) {
    reported_ = std::move(drawing);
    if (client_.is_bound()) {
      client_->Drawing(
          std::vector<uint32_t>(reported_.begin(), reported_.end()));
    }
  }
}

cc::FilterOperations ResolveShaderEffects(const cc::FilterOperations& filters,
                                          const ShaderEffects& effects,
                                          const FrameSinkId& owner,
                                          base::flat_set<uint32_t>& drawn) {
  cc::FilterOperations resolved;
  for (size_t i = 0; i < filters.size(); ++i) {
    cc::FilterOperation op = filters.at(i);
    if (op.type() == cc::FilterOperation::SHADER) {
      sk_sp<SkRuntimeEffect> program = effects.Find(op.shader_effect(), owner);
      if (program) {
        drawn.insert(op.shader_effect());
      }
      op.set_shader_runtime_effect(std::move(program));
    }
    resolved.Append(op);
  }
  return resolved;
}

sk_sp<SkImageFilter> BuildShadedImageFilter(const cc::FilterOperations& filters,
                                            const gfx::RectF& content,
                                            const SkMatrix& local_matrix) {
  SkMatrix to_filter_space;
  if (!local_matrix.invert(&to_filter_space)) {
    return nullptr;
  }
  const gfx::Rect filter_bounds = gfx::ToEnclosingRect(
      gfx::SkRectToRectF(to_filter_space.mapRect(gfx::RectFToSkRect(content))));

  sk_sp<SkImageFilter> built;
  cc::FilterOperations run;
  // Adds cc's own filters since the last effect. They are in filter space,
  // as SkiaRenderer runs them.
  auto end_run = [&] {
    if (run.IsEmpty()) {
      return;
    }
    sk_sp<SkImageFilter> filter = cc::PaintFilter::GetSkFilter(
        cc::RenderSurfaceFilters::BuildImageFilter(run, filter_bounds).get());
    if (filter) {
      filter = filter->makeWithLocalMatrix(local_matrix);
    }
    if (filter) {
      built = built
                  ? SkImageFilters::Compose(std::move(filter), std::move(built))
                  : std::move(filter);
    }
    run.Clear();
  };
  for (size_t i = 0; i < filters.size(); ++i) {
    const cc::FilterOperation& op = filters.at(i);
    if (op.type() != cc::FilterOperation::SHADER) {
      run.Append(op);
    } else if (op.shader_runtime_effect()) {
      end_run();
      // Skia drops a runtime shader under a scaling local matrix, so the
      // effect runs in the pass's pixels, and only its outset, in filter
      // space, is scaled.
      const gfx::Vector2dF outset(
          std::abs(local_matrix.getScaleX()) * op.amount(),
          std::abs(local_matrix.getScaleY()) * op.amount());
      built = Shade(op, content, outset, std::move(built));
    }
  }
  end_run();
  return built;
}

}  // namespace viz::domicile
