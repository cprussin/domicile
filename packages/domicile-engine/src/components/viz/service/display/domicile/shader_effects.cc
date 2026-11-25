// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/viz/service/display/domicile/shader_effects.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <optional>
#include <utility>

#include "base/check.h"
#include "base/logging.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/types/expected_macros.h"
#include "cc/paint/filter_operation.h"
#include "cc/paint/paint_filter.h"
#include "cc/paint/render_surface_filters.h"
#include "third_party/skia/include/core/SkBlendMode.h"
#include "third_party/skia/include/core/SkBlender.h"
#include "third_party/skia/include/core/SkCanvas.h"
#include "third_party/skia/include/core/SkData.h"
#include "third_party/skia/include/core/SkImageInfo.h"
#include "third_party/skia/include/core/SkPaint.h"
#include "third_party/skia/include/core/SkShader.h"
#include "third_party/skia/include/core/SkSpan.h"
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
using Child = SkRuntimeEffect::Child;

// A mesh vertex: `uv`, then `index`.
constexpr size_t kMeshStride = 3 * sizeof(float);

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

// How an effect's uniforms after `size` take their values.
struct Layout {
  uint32_t arguments = 0;
  std::vector<ShaderEffectArray> arrays;
};

// Checks that `uniforms` start with `size` and hold only floats, at most 16
// of them outside arrays and 64 KiB in arrays.
base::expected<Layout, std::string> LayoutOf(SkSpan<const Uniform> uniforms) {
  if (uniforms.empty() || uniforms[0].name != "size" ||
      uniforms[0].type != Uniform::Type::kFloat2 || uniforms[0].isArray()) {
    return base::unexpected(
        std::string("an effect's first uniform is `uniform float2 size`"));
  }
  Layout layout;
  size_t arguments = 0;
  size_t array_floats = 0;
  for (size_t i = 1; i < uniforms.size(); ++i) {
    const Uniform& uniform = uniforms[i];
    if (!IsFloats(uniform.type)) {
      return base::unexpected(
          base::StrCat({"an effect's uniforms are floats, and `", uniform.name,
                        "` is not"}));
    }
    const size_t floats = uniform.sizeInBytes() / sizeof(float);
    if (uniform.isArray()) {
      array_floats += floats;
      layout.arrays.push_back(
          {std::string(uniform.name), static_cast<uint32_t>(floats)});
    } else {
      arguments += floats;
    }
  }
  if (arguments > cc::FilterOperation::kMaxShaderArguments) {
    return base::unexpected(base::StrCat(
        {"an effect takes at most ",
         base::NumberToString(cc::FilterOperation::kMaxShaderArguments),
         " floats after `size`, and this one takes ",
         base::NumberToString(arguments)}));
  }
  if (array_floats > cc::FilterOperation::kMaxShaderArrayFloats) {
    return base::unexpected(base::StrCat(
        {"an effect's arrays hold at most ",
         base::NumberToString(cc::FilterOperation::kMaxShaderArrayFloats),
         " floats, and this one's hold ", base::NumberToString(array_floats)}));
  }
  layout.arguments = static_cast<uint32_t>(arguments);
  return layout;
}

// Checks that each of `children` is a shader, `content` or one of `images`,
// that `content` is one, and that each image is one.
std::optional<std::string> CheckChildren(
    SkSpan<const Child> children,
    const std::vector<ShaderEffectImage>& images) {
  bool content = false;
  for (const Child& child : children) {
    const bool image = std::ranges::any_of(
        images,
        [&](const ShaderEffectImage& each) { return each.name == child.name; });
    if (child.type != SkRuntimeEffect::ChildType::kShader ||
        (child.name != "content" && !image)) {
      return base::StrCat(
          {"an effect's children are `uniform shader content` "
           "and its images, and `",
           child.name, "` is neither"});
    }
    content = content || child.name == "content";
  }
  if (!content) {
    return std::string("an effect samples `uniform shader content`");
  }
  for (const ShaderEffectImage& image : images) {
    bool sampled = false;
    for (const Child& child : children) {
      sampled = sampled || child.name == image.name;
    }
    if (!sampled) {
      return base::StrCat(
          {"image `", image.name, "` is no `uniform shader` of the effect"});
    }
  }
  return std::nullopt;
}

// `images` as Skia images, or why they are not images an effect samples.
base::expected<std::vector<std::pair<std::string, sk_sp<SkImage>>>, std::string>
MakeImages(const std::vector<ShaderEffectImage>& images) {
  if (images.size() > kMaxShaderEffectImages) {
    return base::unexpected(base::StrCat(
        {"an effect samples at most ",
         base::NumberToString(kMaxShaderEffectImages), " images"}));
  }
  std::vector<std::pair<std::string, sk_sp<SkImage>>> made;
  for (const ShaderEffectImage& image : images) {
    const gfx::Size& size = image.size;
    if (size.width() < 1 || size.height() < 1 ||
        size.width() > kMaxShaderEffectImageSide ||
        size.height() > kMaxShaderEffectImageSide) {
      return base::unexpected(
          base::StrCat({"image `", image.name, "` is not 1 to ",
                        base::NumberToString(kMaxShaderEffectImageSide),
                        " pixels on a side"}));
    }
    const size_t row = static_cast<size_t>(size.width()) * 4;
    if (image.pixels.size() != row * static_cast<size_t>(size.height())) {
      return base::unexpected(base::StrCat(
          {"image `", image.name, "` is not its size of RGBA pixels"}));
    }
    if (image.name == "content" ||
        std::ranges::any_of(
            made, [&](const auto& each) { return each.first == image.name; })) {
      return base::unexpected(
          base::StrCat({"image `", image.name, "` is named twice"}));
    }
    sk_sp<SkImage> made_image = SkImages::RasterFromData(
        SkImageInfo::Make(size.width(), size.height(), kRGBA_8888_SkColorType,
                          kUnpremul_SkAlphaType),
        SkData::MakeWithCopy(image.pixels.data(), image.pixels.size()), row);
    if (!made_image) {
      return base::unexpected(
          base::StrCat({"image `", image.name, "` could not be made"}));
    }
    made.emplace_back(image.name, std::move(made_image));
  }
  return made;
}

sk_sp<SkShader> ImageShader(const sk_sp<SkImage>& image) {
  return image->makeShader(SkTileMode::kRepeat, SkTileMode::kRepeat,
                           SkSamplingOptions(SkFilterMode::kLinear));
}

// Values for `uniforms`: `size`, then `arguments` across the uniforms that are
// not arrays and `arrays` across those that are, in order. Values past the
// last uniform are dropped and missing ones are zero.
sk_sp<SkData> Uniforms(SkSpan<const Uniform> uniforms,
                       size_t uniform_size,
                       const gfx::SizeF& size,
                       const std::vector<float>& arguments,
                       const std::vector<float>& arrays) {
  std::vector<float> values(uniform_size / sizeof(float), 0.f);
  size_t next = 0;
  size_t next_array = 0;
  for (const Uniform& uniform : uniforms) {
    const size_t at = uniform.offset / sizeof(float);
    const size_t count = uniform.sizeInBytes() / sizeof(float);
    if (uniform.name == "size" && !uniform.isArray()) {
      values[at] = size.width();
      values[at + 1] = size.height();
    } else if (uniform.isArray()) {
      for (size_t i = 0; i < count && next_array + i < arrays.size(); ++i) {
        values[at + i] = arrays[next_array + i];
      }
      next_array += count;
    } else {
      for (size_t i = 0; i < count && next < arguments.size(); ++i) {
        values[at + i] = arguments[next++];
      }
    }
  }
  return SkData::MakeWithCopy(values.data(), values.size() * sizeof(float));
}

const ShaderEffectInputs* InputsOf(const cc::FilterOperation& op) {
  // Only ResolveShaderEffects sets them, and always to ShaderEffectInputs.
  return static_cast<const ShaderEffectInputs*>(op.shader_inputs().get());
}

// Effect `op` over content in `content`, reading what `input` drew. All in
// the pass's pixels; `outset` is the effect's outset in them.
sk_sp<SkImageFilter> Shade(const cc::FilterOperation& op,
                           const gfx::RectF& content,
                           const gfx::Vector2dF& outset,
                           sk_sp<SkImageFilter> input) {
  const sk_sp<SkRuntimeEffect>& program = op.shader_runtime_effect();
  SkRuntimeEffectBuilder builder(
      program,
      Uniforms(program->uniforms(), program->uniformSize(), content.size(),
               op.shader_arguments(), op.shader_arrays()));
  if (const ShaderEffectInputs* inputs = InputsOf(op)) {
    for (const auto& [name, image] : inputs->images) {
      builder.child(name) = ImageShader(image);
    }
  }
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

base::expected<CompiledShaderEffect, std::string> CompileFragment(
    const ShaderEffectSource& source) {
  // Strict ES2: constant loop bounds, no recursion.
  SkRuntimeEffect::Result result = SkRuntimeEffect::MakeForShader(
      SkString(source.sksl.data(), source.sksl.size()));
  if (!result.effect) {
    return base::unexpected(std::string(result.errorText.c_str()));
  }
  const SkRuntimeEffect& program = *result.effect;
  if (std::optional<std::string> error =
          CheckChildren(program.children(), source.images)) {
    return base::unexpected(std::move(*error));
  }
  ASSIGN_OR_RETURN(Layout layout, LayoutOf(program.uniforms()));
  CompiledShaderEffect compiled;
  compiled.program = std::move(result.effect);
  compiled.inputs = sk_make_sp<ShaderEffectInputs>();
  compiled.arguments = layout.arguments;
  compiled.arrays = std::move(layout.arrays);
  return compiled;
}

base::expected<CompiledShaderEffect, std::string> CompileMesh(
    const ShaderEffectSource& source) {
  const bool grid = source.columns > 0 && source.rows > 0;
  if (grid == (source.instances > 0) ||
      (!grid && (source.columns > 0 || source.rows > 0))) {
    return base::unexpected(
        std::string("a mesh effect has a grid of columns by rows, or "
                    "instances"));
  }
  const uint64_t cells = grid ? uint64_t{source.columns} * uint64_t{source.rows}
                              : uint64_t{source.instances};
  if (cells > kMaxMeshCells) {
    return base::unexpected(base::StrCat(
        {"a mesh has at most ", base::NumberToString(kMaxMeshCells),
         " cells or instances, and this one has ",
         base::NumberToString(cells)}));
  }

  const std::array<SkMeshSpecification::Attribute, 2> attributes = {
      SkMeshSpecification::Attribute{
          SkMeshSpecification::Attribute::Type::kFloat2, 0, SkString("uv")},
      SkMeshSpecification::Attribute{
          SkMeshSpecification::Attribute::Type::kFloat, 2 * sizeof(float),
          SkString("index")},
  };
  const std::array<SkMeshSpecification::Varying, 3> varyings = {
      SkMeshSpecification::Varying{SkMeshSpecification::Varying::Type::kFloat2,
                                   SkString("position")},
      SkMeshSpecification::Varying{SkMeshSpecification::Varying::Type::kFloat2,
                                   SkString("uv")},
      SkMeshSpecification::Varying{SkMeshSpecification::Varying::Type::kFloat4,
                                   SkString("data")},
  };
  SkMeshSpecification::Result result = SkMeshSpecification::Make(
      SkSpan(attributes.data(), attributes.size()), kMeshStride,
      SkSpan(varyings.data(), varyings.size()),
      SkString(source.vertex.data(), source.vertex.size()),
      SkString(source.sksl.data(), source.sksl.size()));
  if (!result.specification) {
    return base::unexpected(std::string(result.error.c_str()));
  }
  const SkMeshSpecification& spec = *result.specification;
  if (std::optional<std::string> error =
          CheckChildren(spec.children(), source.images)) {
    return base::unexpected(std::move(*error));
  }
  ASSIGN_OR_RETURN(Layout layout, LayoutOf(spec.uniforms()));

  const std::vector<float> vertices =
      MeshVertices(source.columns, source.rows, source.instances);
  CompiledShaderEffect compiled;
  compiled.inputs = sk_make_sp<ShaderEffectInputs>();
  compiled.inputs->mesh = std::move(result.specification);
  compiled.inputs->vertices = SkMeshes::MakeVertexBuffer(
      vertices.data(), vertices.size() * sizeof(float));
  compiled.inputs->vertex_count = vertices.size() / 3;
  compiled.arguments = layout.arguments;
  compiled.arrays = std::move(layout.arrays);
  return compiled;
}

}  // namespace

ShaderEffectSource::ShaderEffectSource() = default;
ShaderEffectSource::ShaderEffectSource(const ShaderEffectSource&) = default;
ShaderEffectSource::ShaderEffectSource(ShaderEffectSource&&) = default;
ShaderEffectSource& ShaderEffectSource::operator=(const ShaderEffectSource&) =
    default;
ShaderEffectSource& ShaderEffectSource::operator=(ShaderEffectSource&&) =
    default;
ShaderEffectSource::~ShaderEffectSource() = default;

ShaderEffectInputs::ShaderEffectInputs() = default;
ShaderEffectInputs::~ShaderEffectInputs() = default;

CompiledShaderEffect::CompiledShaderEffect() = default;
CompiledShaderEffect::CompiledShaderEffect(const CompiledShaderEffect&) =
    default;
CompiledShaderEffect::CompiledShaderEffect(CompiledShaderEffect&&) = default;
CompiledShaderEffect& CompiledShaderEffect::operator=(
    const CompiledShaderEffect&) = default;
CompiledShaderEffect& CompiledShaderEffect::operator=(CompiledShaderEffect&&) =
    default;
CompiledShaderEffect::~CompiledShaderEffect() = default;

base::expected<CompiledShaderEffect, std::string> CompileShaderEffect(
    const ShaderEffectSource& source) {
  if (source.sksl.size() > kMaxShaderEffectSource ||
      source.vertex.size() > kMaxShaderEffectSource) {
    return base::unexpected(base::StrCat(
        {"an effect's program is at most ",
         base::NumberToString(kMaxShaderEffectSource), " bytes of SkSL"}));
  }
  const bool mesh =
      source.columns > 0 || source.rows > 0 || source.instances > 0;
  if (mesh != !source.vertex.empty()) {
    return base::unexpected(
        std::string("a mesh effect has a vertex program and a mesh, and any "
                    "other effect neither"));
  }
  ASSIGN_OR_RETURN(CompiledShaderEffect compiled,
                   mesh ? CompileMesh(source) : CompileFragment(source));
  ASSIGN_OR_RETURN(compiled.inputs->images, MakeImages(source.images));
  return compiled;
}

base::expected<CompiledShaderEffect, std::string> CompileShaderEffect(
    std::string_view sksl) {
  ShaderEffectSource source;
  source.sksl = std::string(sksl);
  return CompileShaderEffect(source);
}

std::vector<float> MeshVertices(uint32_t columns,
                                uint32_t rows,
                                uint32_t instances) {
  std::vector<float> vertices;
  auto add = [&vertices](float u, float v, float index) {
    vertices.push_back(u);
    vertices.push_back(v);
    vertices.push_back(index);
  };
  if (instances > 0) {
    vertices.reserve(size_t{instances} * 18);
    for (uint32_t i = 0; i < instances; ++i) {
      const float index = static_cast<float>(i);
      add(0, 0, index);
      add(1, 0, index);
      add(0, 1, index);
      add(0, 1, index);
      add(1, 0, index);
      add(1, 1, index);
    }
    return vertices;
  }
  if (columns == 0 || rows == 0) {
    return vertices;
  }
  vertices.reserve(size_t{columns} * rows * 18);
  // Grid point (column, row), indexed row by row.
  auto corner = [&](uint32_t column, uint32_t row) {
    add(static_cast<float>(column) / static_cast<float>(columns),
        static_cast<float>(row) / static_cast<float>(rows),
        static_cast<float>(row * (columns + 1) + column));
  };
  for (uint32_t row = 0; row < rows; ++row) {
    for (uint32_t column = 0; column < columns; ++column) {
      corner(column, row);
      corner(column + 1, row);
      corner(column, row + 1);
      corner(column, row + 1);
      corner(column + 1, row);
      corner(column + 1, row + 1);
    }
  }
  return vertices;
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

const CompiledShaderEffect* ShaderEffects::Find(
    uint32_t id,
    const FrameSinkId& owner) const {
  auto effect = effects_.find(id);
  if (effect == effects_.end() || effect->second.owner != owner) {
    return nullptr;
  }
  return &effect->second.compiled;
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
                             mojom::DomicileShaderEffectSourcePtr source,
                             RegisterCallback callback) {
  ShaderEffectSource converted;
  converted.sksl = std::move(source->sksl);
  converted.vertex = std::move(source->vertex);
  converted.columns = source->columns;
  converted.rows = source->rows;
  converted.instances = source->instances;
  for (mojom::DomicileShaderEffectImagePtr& image : source->images) {
    converted.images.push_back(
        {std::move(image->name), image->size, std::move(image->pixels)});
  }
  auto compiled = CompileShaderEffect(converted);
  if (!compiled.has_value()) {
    std::move(callback).Run(0, {}, compiled.error());
    return;
  }
  std::vector<mojom::DomicileShaderEffectArrayPtr> arrays;
  for (const ShaderEffectArray& array : compiled->arrays) {
    arrays.push_back(
        mojom::DomicileShaderEffectArray::New(array.name, array.floats));
  }
  const uint32_t arguments = compiled->arguments;
  effects_.insert_or_assign(id, Effect{owner, std::move(*compiled)});
  std::move(callback).Run(arguments, std::move(arrays), std::string());
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
      const CompiledShaderEffect* effect =
          effects.Find(op.shader_effect(), owner);
      if (effect) {
        drawn.insert(op.shader_effect());
      }
      op.set_shader_runtime_effect(effect ? effect->program : nullptr);
      op.set_shader_inputs(effect ? effect->inputs : nullptr);
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

const cc::FilterOperation* FindMeshEffect(const cc::FilterOperations& filters) {
  for (size_t i = 0; i < filters.size(); ++i) {
    const cc::FilterOperation& op = filters.at(i);
    if (op.type() == cc::FilterOperation::SHADER) {
      const ShaderEffectInputs* inputs = InputsOf(op);
      if (inputs && inputs->mesh) {
        return &op;
      }
    }
  }
  return nullptr;
}

gfx::RectF MeshEffectBounds(const cc::FilterOperation& op,
                            const gfx::Rect& quad_rect,
                            const SkMatrix& local_matrix) {
  SkMatrix to_filter_space;
  if (!local_matrix.invert(&to_filter_space)) {
    return gfx::RectF(quad_rect);
  }
  SkRect content = to_filter_space.mapRect(gfx::RectToSkRect(quad_rect));
  content.outset(op.amount(), op.amount());
  return gfx::SkRectToRectF(local_matrix.mapRect(content));
}

void DrawMeshEffect(SkCanvas& canvas,
                    const cc::FilterOperation& op,
                    const sk_sp<SkImage>& content,
                    const gfx::Rect& quad_rect,
                    const gfx::RectF& tex_coord_rect,
                    const SkMatrix& local_matrix,
                    const SkSamplingOptions& sampling) {
  const ShaderEffectInputs* inputs = InputsOf(op);
  CHECK(inputs && inputs->mesh);
  if (!content) {
    return;
  }
  // The mesh is in the content's coordinates, in the quad's pixels from the
  // content's top left, as a fragment effect's `p` is.
  const SkRect content_rect = gfx::RectToSkRect(quad_rect);
  const SkMatrix content_to_quad =
      SkMatrix::Translate(content_rect.x(), content_rect.y());
  const SkMatrix quad_to_texels = SkMatrix::RectToRect(
      gfx::RectToSkRect(quad_rect), gfx::RectFToSkRect(tex_coord_rect));
  SkMatrix texels_to_content;
  if (!SkMatrix::Concat(quad_to_texels, content_to_quad)
           .invert(&texels_to_content)) {
    return;
  }
  sk_sp<SkShader> content_shader = content->makeShader(
      SkTileMode::kDecal, SkTileMode::kDecal, sampling, &texels_to_content);

  const SkMeshSpecification& spec = *inputs->mesh;
  std::vector<SkRuntimeEffect::ChildPtr> children;
  for (const Child& child : spec.children()) {
    sk_sp<SkShader> shader;
    if (child.name == "content") {
      shader = content_shader;
    } else {
      for (const auto& [name, image] : inputs->images) {
        if (name == child.name) {
          shader = ImageShader(image);
        }
      }
    }
    children.push_back(SkRuntimeEffect::ChildPtr(std::move(shader)));
  }

  const gfx::SizeF size(content_rect.width(), content_rect.height());
  SkMesh::Result result = SkMesh::Make(
      inputs->mesh, SkMesh::Mode::kTriangles, inputs->vertices,
      inputs->vertex_count, /*vertexOffset=*/0,
      Uniforms(spec.uniforms(), spec.uniformSize(), size, op.shader_arguments(),
               op.shader_arrays()),
      SkSpan(children.data(), children.size()),
      SkRect::MakeWH(size.width(), size.height())
          .makeOutset(std::abs(local_matrix.getScaleX()) * op.amount(),
                      std::abs(local_matrix.getScaleY()) * op.amount()));
  if (!result.mesh.isValid()) {
    DLOG(ERROR) << "domicile: shader effect " << op.shader_effect()
                << " made no mesh: " << result.error.c_str();
    return;
  }
  SkAutoCanvasRestore restore(&canvas, /*doSave=*/true);
  canvas.concat(content_to_quad);
  // The mesh's own color, the destination of the blend, is what it draws.
  canvas.drawMesh(result.mesh, SkBlender::Mode(SkBlendMode::kDst), SkPaint());
}

}  // namespace viz::domicile
