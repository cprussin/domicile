// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/viz/service/display/domicile/shader_effects.h"

#include <array>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/containers/flat_set.h"
#include "base/strings/strcat.h"
#include "base/test/bind.h"
#include "base/test/task_environment.h"
#include "cc/paint/filter_operation.h"
#include "cc/paint/filter_operations.h"
#include "mojo/public/cpp/test_support/test_utils.h"
#include "services/viz/public/cpp/compositing/filter_operation_mojom_traits.h"
#include "services/viz/public/mojom/compositing/filter_operation.mojom.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "third_party/skia/include/core/SkCanvas.h"
#include "third_party/skia/include/core/SkColor.h"
#include "third_party/skia/include/core/SkPaint.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/skia_conversions.h"

namespace viz::domicile {
namespace {

constexpr char kHead[] =
    "uniform shader content;\n"
    "uniform float2 size;\n";

// An effect of `uniforms` and `body`, the body of `main(float2 p)`.
std::string Effect(std::string_view uniforms, std::string_view body) {
  return base::StrCat(
      {kHead, uniforms, "\nhalf4 main(float2 p) {\n", body, "\n}\n"});
}

sk_sp<SkRuntimeEffect> Compiled(std::string_view sksl) {
  auto compiled = CompileShaderEffect(sksl);
  EXPECT_TRUE(compiled.has_value()) << compiled.error();
  return compiled.has_value() ? compiled->program : nullptr;
}

cc::FilterOperation Shader(uint32_t id,
                           float outset,
                           std::vector<float> arguments,
                           sk_sp<SkRuntimeEffect> program = nullptr,
                           std::vector<float> arrays = {}) {
  cc::FilterOperation op =
      cc::FilterOperation::CreateShaderFilter(id, outset, std::move(arguments));
  op.set_shader_runtime_effect(std::move(program));
  op.set_shader_arrays(std::move(arrays));
  return op;
}

// A mesh effect's programs: the vertex one places the grid over the content
// and the fragment one shows the content there.
constexpr char kVertex[] =
    "uniform float2 size;\n"
    "Varyings main(const Attributes a) {\n"
    "  Varyings v;\n"
    "  v.position = a.uv * size;\n"
    "  v.uv = a.uv * size;\n"
    "  v.data = float4(a.index);\n"
    "  return v;\n"
    "}\n";
constexpr char kFragment[] =
    "uniform shader content;\n"
    "uniform float2 size;\n"
    "float2 main(const Varyings v, out half4 color) {\n"
    "  color = content.eval(v.uv);\n"
    "  return v.position;\n"
    "}\n";

ShaderEffectSource Mesh(uint32_t columns, uint32_t rows, uint32_t instances) {
  ShaderEffectSource source;
  source.sksl = kFragment;
  source.vertex = kVertex;
  source.columns = columns;
  source.rows = rows;
  source.instances = instances;
  return source;
}

// A `width` by `height` image named `name`, every pixel `rgba`.
ShaderEffectImage Image(std::string name,
                        int width,
                        int height,
                        std::array<uint8_t, 4> rgba) {
  std::vector<uint8_t> pixels;
  for (int i = 0; i < width * height; ++i) {
    pixels.insert(pixels.end(), rgba.begin(), rgba.end());
  }
  return {std::move(name), gfx::Size(width, height), std::move(pixels)};
}

ShaderEffectSource WithImage(std::string sksl, ShaderEffectImage image) {
  ShaderEffectSource source;
  source.sksl = std::move(sksl);
  source.images.push_back(std::move(image));
  return source;
}

const FrameSinkId kShell(1, 1);
const FrameSinkId kSite(2, 1);

TEST(ShaderEffectCompileTest, CountsTheFloatsAfterSize) {
  auto compiled = CompileShaderEffect(Effect(
      "uniform float progress;\nuniform float2 center;\nuniform float3x3 m;",
      "return content.eval(p);"));

  ASSERT_TRUE(compiled.has_value()) << compiled.error();
  EXPECT_EQ(compiled->arguments, 1u + 2u + 9u);
}

TEST(ShaderEffectCompileTest, TakesAnEffectWithNoArguments) {
  auto compiled = CompileShaderEffect(Effect("", "return content.eval(p);"));

  ASSERT_TRUE(compiled.has_value()) << compiled.error();
  EXPECT_EQ(compiled->arguments, 0u);
}

TEST(ShaderEffectCompileTest, SaysWhatTheCompilerSaid) {
  auto compiled = CompileShaderEffect(Effect("", "return nope;"));

  ASSERT_FALSE(compiled.has_value());
  EXPECT_NE(compiled.error().find("nope"), std::string::npos)
      << compiled.error();
}

TEST(ShaderEffectCompileTest, RefusesALoopWithNoConstantBound) {
  EXPECT_FALSE(
      CompileShaderEffect(Effect("uniform float n;",
                                 "half4 c = half4(0);\n"
                                 "for (float i = 0; i < n; i++) { c += 0.1; }\n"
                                 "return c;"))
          .has_value());
}

TEST(ShaderEffectCompileTest, RefusesALongProgram) {
  std::string comment(kMaxShaderEffectSource, '/');
  auto compiled = CompileShaderEffect(
      base::StrCat({Effect("", "return content.eval(p);"), comment}));

  ASSERT_FALSE(compiled.has_value());
  EXPECT_NE(compiled.error().find("bytes"), std::string::npos);
}

TEST(ShaderEffectCompileTest, RefusesAnEffectWithoutContent) {
  EXPECT_FALSE(CompileShaderEffect("uniform float2 size;\n"
                                   "half4 main(float2 p) { return half4(1); }")
                   .has_value());
}

TEST(ShaderEffectCompileTest, RefusesAChildThatNamesNoImage) {
  EXPECT_FALSE(CompileShaderEffect(
                   Effect("uniform shader other;", "return other.eval(p);"))
                   .has_value());
}

TEST(ShaderEffectCompileTest, SamplesAnImageItNames) {
  auto compiled = CompileShaderEffect(
      WithImage(Effect("uniform shader noise;", "return noise.eval(p);"),
                Image("noise", 2, 2, {255, 0, 0, 255})));

  ASSERT_TRUE(compiled.has_value()) << compiled.error();
  ASSERT_EQ(compiled->inputs->images.size(), 1u);
  EXPECT_EQ(compiled->inputs->images[0].first, "noise");
}

TEST(ShaderEffectCompileTest, RefusesAnImageItDoesNotSample) {
  EXPECT_FALSE(
      CompileShaderEffect(WithImage(Effect("", "return content.eval(p);"),
                                    Image("noise", 2, 2, {255, 0, 0, 255})))
          .has_value());
}

TEST(ShaderEffectCompileTest, RefusesAnImageShortOfItsPixels) {
  ShaderEffectImage image = Image("noise", 2, 2, {255, 0, 0, 255});
  image.pixels.pop_back();

  EXPECT_FALSE(CompileShaderEffect(WithImage(Effect("uniform shader noise;",
                                                    "return noise.eval(p);"),
                                             std::move(image)))
                   .has_value());
}

TEST(ShaderEffectCompileTest, KeepsArraysApartFromArguments) {
  auto compiled = CompileShaderEffect(
      Effect("uniform float progress;\nuniform float2 points[4];",
             "return content.eval(p);"));

  ASSERT_TRUE(compiled.has_value()) << compiled.error();
  EXPECT_EQ(compiled->arguments, 1u);
  EXPECT_EQ(compiled->arrays, std::vector<ShaderEffectArray>({{"points", 8u}}));
}

TEST(ShaderEffectCompileTest, RefusesArraysOverSixtyFourKibibytes) {
  auto compiled = CompileShaderEffect(
      Effect("uniform float4 big[4097];", "return content.eval(p);"));

  ASSERT_FALSE(compiled.has_value());
  EXPECT_NE(compiled.error().find("16388"), std::string::npos)
      << compiled.error();
}

TEST(ShaderEffectCompileTest, CompilesAGridMesh) {
  auto compiled = CompileShaderEffect(Mesh(4, 3, 0));

  ASSERT_TRUE(compiled.has_value()) << compiled.error();
  EXPECT_FALSE(compiled->program);
  ASSERT_TRUE(compiled->inputs->mesh);
  EXPECT_EQ(compiled->inputs->vertex_count, 4u * 3u * 6u);
  EXPECT_EQ(compiled->arguments, 0u);
}

TEST(ShaderEffectCompileTest, CompilesInstances) {
  auto compiled = CompileShaderEffect(Mesh(0, 0, 10));

  ASSERT_TRUE(compiled.has_value()) << compiled.error();
  EXPECT_EQ(compiled->inputs->vertex_count, 60u);
}

TEST(ShaderEffectCompileTest, SaysWhatTheMeshCompilerSaid) {
  ShaderEffectSource source = Mesh(1, 1, 0);
  source.vertex = "Varyings main(const Attributes a) { return nope; }";

  auto compiled = CompileShaderEffect(source);

  ASSERT_FALSE(compiled.has_value());
  EXPECT_NE(compiled.error().find("nope"), std::string::npos)
      << compiled.error();
}

TEST(ShaderEffectCompileTest, RefusesAMeshWithoutAVertexProgram) {
  ShaderEffectSource source = Mesh(1, 1, 0);
  source.vertex.clear();

  EXPECT_FALSE(CompileShaderEffect(source).has_value());
}

TEST(ShaderEffectCompileTest, RefusesAVertexProgramWithoutAMesh) {
  EXPECT_FALSE(CompileShaderEffect(Mesh(0, 0, 0)).has_value());
}

TEST(ShaderEffectCompileTest, RefusesAGridAndInstancesBoth) {
  EXPECT_FALSE(CompileShaderEffect(Mesh(2, 2, 2)).has_value());
}

TEST(ShaderEffectCompileTest, RefusesAMeshOfTooManyCells) {
  auto compiled = CompileShaderEffect(Mesh(129, 128, 0));

  ASSERT_FALSE(compiled.has_value());
  EXPECT_NE(compiled.error().find("16512"), std::string::npos)
      << compiled.error();
}

TEST(MeshVerticesTest, CoversEachCellWithTwoTriangles) {
  // Two cells side by side: grid points 0 1 2 over 3 4 5.
  const std::vector<float> vertices = MeshVertices(2, 1, 0);

  ASSERT_EQ(vertices.size(), 2u * 6u * 3u);
  // The second cell's first triangle: its top left, top right, bottom left.
  EXPECT_EQ(
      std::vector<float>(vertices.begin() + 18, vertices.begin() + 27),
      std::vector<float>({0.5f, 0.f, 1.f, 1.f, 0.f, 2.f, 0.5f, 1.f, 4.f}));
}

TEST(MeshVerticesTest, NumbersEachInstance) {
  const std::vector<float> vertices = MeshVertices(0, 0, 2);

  ASSERT_EQ(vertices.size(), 2u * 6u * 3u);
  EXPECT_EQ(vertices[2], 0.f);
  EXPECT_EQ(vertices[18 + 2], 1.f);
  // The last corner of a quad is its bottom right.
  EXPECT_EQ(std::vector<float>(vertices.end() - 3, vertices.end()),
            std::vector<float>({1.f, 1.f, 1.f}));
}

TEST(ShaderEffectCompileTest, RefusesAnEffectWhoseFirstUniformIsNotSize) {
  EXPECT_FALSE(
      CompileShaderEffect("uniform shader content;\n"
                          "uniform float progress;\n"
                          "uniform float2 size;\n"
                          "half4 main(float2 p) { return content.eval(p); }")
          .has_value());
}

TEST(ShaderEffectCompileTest, RefusesIntegerArguments) {
  EXPECT_FALSE(
      CompileShaderEffect(Effect("uniform int n;", "return content.eval(p);"))
          .has_value());
}

TEST(ShaderEffectCompileTest, RefusesMoreThanSixteenFloats) {
  auto compiled =
      CompileShaderEffect(Effect("uniform float4x4 m;\nuniform float one_more;",
                                 "return content.eval(p);"));

  ASSERT_FALSE(compiled.has_value());
  EXPECT_NE(compiled.error().find("17"), std::string::npos) << compiled.error();
}

TEST(ShaderFilterTest, CrossesMojoWithoutItsProgram) {
  const cc::FilterOperation input = Shader(
      7, 3.f, {0.25f, 2.f}, Compiled(Effect("", "return content.eval(p);")));
  cc::FilterOperation output;

  ASSERT_TRUE(mojo::test::SerializeAndDeserialize<mojom::FilterOperation>(
      input, output));
  EXPECT_EQ(output, input);
  EXPECT_EQ(output.shader_effect(), 7u);
  EXPECT_EQ(output.amount(), 3.f);
  EXPECT_EQ(output.shader_arguments(), std::vector<float>({0.25f, 2.f}));
  EXPECT_FALSE(output.shader_runtime_effect());
}

TEST(ShaderFilterTest, CrossesMojoWithItsArrays) {
  const cc::FilterOperation input =
      Shader(7, 0.f, {}, nullptr, std::vector<float>({1.f, 2.f, 3.f}));
  cc::FilterOperation output;

  ASSERT_TRUE(mojo::test::SerializeAndDeserialize<mojom::FilterOperation>(
      input, output));
  EXPECT_EQ(output.shader_arrays(), std::vector<float>({1.f, 2.f, 3.f}));
  EXPECT_EQ(output, input);
}

TEST(ShaderFilterTest, RefusesArraysOverSixtyFourKibibytes) {
  const cc::FilterOperation input =
      Shader(7, 0.f, {}, nullptr,
             std::vector<float>(cc::FilterOperation::kMaxShaderArrayFloats + 1,
                                0.f));
  cc::FilterOperation output;

  EXPECT_FALSE(mojo::test::SerializeAndDeserialize<mojom::FilterOperation>(
      input, output));
}

TEST(ShaderFilterTest, AnAnimationKeepsTheArraysThePageSet) {
  cc::FilterOperations committed;
  committed.Append(Shader(7, 0.f, {0.f}, nullptr, {4.f, 5.f}));
  cc::FilterOperations animated;
  animated.Append(Shader(7, 0.f, {0.5f}));
  animated.Append(Shader(8, 0.f, {}));

  const cc::FilterOperations kept = animated.WithShaderArraysOf(committed);

  EXPECT_EQ(kept.at(0), Shader(7, 0.f, {0.5f}, nullptr, {4.f, 5.f}));
  EXPECT_EQ(kept.at(1), Shader(8, 0.f, {}));
}

TEST(ShaderFilterTest, RefusesANegativeOutset) {
  const cc::FilterOperation input = Shader(7, -1.f, {});
  cc::FilterOperation output;

  EXPECT_FALSE(mojo::test::SerializeAndDeserialize<mojom::FilterOperation>(
      input, output));
}

TEST(ShaderFilterTest, InterpolatesOneEffectsArguments) {
  const cc::FilterOperation from = Shader(7, 3.f, {0.f, 10.f});
  const cc::FilterOperation to = Shader(7, 3.f, {1.f, 20.f});

  EXPECT_EQ(cc::FilterOperation::Blend(&from, &to, 0.25),
            Shader(7, 3.f, {0.25f, 12.5f}));
}

TEST(ShaderFilterTest, StepsBetweenTwoEffectsHalfway) {
  const cc::FilterOperation from = Shader(7, 0.f, {0.f});
  const cc::FilterOperation to = Shader(8, 0.f, {1.f});

  EXPECT_EQ(cc::FilterOperation::Blend(&from, &to, 0.5), from);
  EXPECT_EQ(cc::FilterOperation::Blend(&from, &to, 0.75), to);
}

TEST(ShaderFilterTest, StartsAnEffectFromZeroArguments) {
  const cc::FilterOperation effect = Shader(7, 2.f, {4.f, 8.f});

  EXPECT_EQ(cc::FilterOperation::Blend(nullptr, &effect, 0.25),
            Shader(7, 2.f, {1.f, 2.f}));
  EXPECT_EQ(cc::FilterOperation::Blend(&effect, nullptr, 0.25),
            Shader(7, 2.f, {3.f, 6.f}));
}

TEST(ShaderFilterTest, InterpolatesInAListBesideABlur) {
  cc::FilterOperations from;
  from.Append(Shader(7, 0.f, {0.f}));
  from.Append(cc::FilterOperation::CreateBlurFilter(0.f));
  cc::FilterOperations to;
  to.Append(Shader(7, 0.f, {1.f}));
  to.Append(cc::FilterOperation::CreateBlurFilter(4.f));

  const cc::FilterOperations blended = to.Blend(from, 0.5);

  ASSERT_EQ(blended.size(), 2u);
  EXPECT_EQ(blended.at(0), Shader(7, 0.f, {0.5f}));
  EXPECT_EQ(blended.at(1), cc::FilterOperation::CreateBlurFilter(2.f));
}

TEST(ShaderFilterTest, MapsARectOutByItsOutset) {
  EXPECT_EQ(Shader(7, 4.f, {}).MapRect(gfx::Rect(10, 10, 20, 20)),
            gfx::Rect(6, 6, 28, 28));
  EXPECT_EQ(Shader(7, 4.f, {})
                .MapRect(gfx::Rect(10, 10, 20, 20), SkMatrix::Scale(2, 2)),
            gfx::Rect(2, 2, 36, 36));
}

TEST(ShaderFilterTest, MovesPixelsAndAffectsOpacity) {
  cc::FilterOperations filters;
  filters.Append(Shader(7, 0.f, {}));

  EXPECT_TRUE(filters.HasFilterThatMovesPixels());
  EXPECT_TRUE(filters.HasFilterThatAffectsOpacity());
  EXPECT_FALSE(filters.AllowsLCDText());
}

class ShaderEffectsTest : public testing::Test,
                          public mojom::DomicileShaderEffectsClient {
 protected:
  ShaderEffectsTest() {
    effects_.Bind(browser_end_.BindNewPipeAndPassReceiver(),
                  client_.BindNewPipeAndPassRemote());
  }

  // Registers `sksl` as `id` for `owner`, and returns the error, if any.
  std::string Register(uint32_t id,
                       const FrameSinkId& owner,
                       const std::string& sksl) {
    auto source = mojom::DomicileShaderEffectSource::New();
    source->sksl = sksl;
    return Register(id, owner, std::move(source));
  }

  std::string Register(uint32_t id,
                       const FrameSinkId& owner,
                       mojom::DomicileShaderEffectSourcePtr source) {
    std::string said = "no answer";
    effects_.Register(
        id, owner, std::move(source),
        base::BindLambdaForTesting(
            [&said, this](
                uint32_t,
                std::vector<mojom::DomicileShaderEffectArrayPtr> arrays,
                const std::string& error) {
              arrays_ = std::move(arrays);
              said = error;
            }));
    return said;
  }

  std::vector<std::vector<uint32_t>> Reports() {
    task_environment_.RunUntilIdle();
    return reports_;
  }

  // mojom::DomicileShaderEffectsClient:
  void Drawing(const std::vector<uint32_t>& ids) override {
    reports_.push_back(ids);
  }

  base::test::TaskEnvironment task_environment_;
  ShaderEffects effects_;
  mojo::Remote<mojom::DomicileShaderEffects> browser_end_;
  mojo::Receiver<mojom::DomicileShaderEffectsClient> client_{this};
  std::vector<std::vector<uint32_t>> reports_;
  // The arrays the last register said the effect takes.
  std::vector<mojom::DomicileShaderEffectArrayPtr> arrays_;
};

std::string PassThrough() {
  return Effect("", "return content.eval(p);");
}

TEST_F(ShaderEffectsTest, FindsAnEffectForItsOwner) {
  EXPECT_EQ(Register(3, kShell, PassThrough()), "");

  EXPECT_TRUE(effects_.Find(3, kShell));
  EXPECT_FALSE(effects_.Find(3, kSite));
  EXPECT_FALSE(effects_.Find(4, kShell));
}

TEST_F(ShaderEffectsTest, KeepsNothingThatDoesNotCompile) {
  EXPECT_NE(Register(3, kShell, "half4 main(float2 p) {"), "");

  EXPECT_FALSE(effects_.Find(3, kShell));
}

TEST_F(ShaderEffectsTest, ForgetsAnUnregisteredEffect) {
  Register(3, kShell, PassThrough());

  effects_.Unregister(3);

  EXPECT_FALSE(effects_.Find(3, kShell));
}

TEST_F(ShaderEffectsTest, ResolvesOnlyTheOwnersEffects) {
  Register(3, kShell, PassThrough());
  cc::FilterOperations filters;
  filters.Append(Shader(3, 0.f, {}));
  filters.Append(cc::FilterOperation::CreateGrayscaleFilter(1.f));
  filters.Append(Shader(4, 0.f, {}));
  base::flat_set<uint32_t> drawn;

  const cc::FilterOperations for_shell =
      ResolveShaderEffects(filters, effects_, kShell, drawn);
  const cc::FilterOperations for_site =
      ResolveShaderEffects(filters, effects_, kSite, drawn);

  EXPECT_TRUE(for_shell.at(0).shader_runtime_effect());
  EXPECT_EQ(for_shell.at(1), filters.at(1));
  EXPECT_FALSE(for_shell.at(2).shader_runtime_effect());
  EXPECT_FALSE(for_site.at(0).shader_runtime_effect());
  EXPECT_EQ(drawn, base::flat_set<uint32_t>({3}));
}

TEST_F(ShaderEffectsTest, SaysWhichArraysAnEffectTakes) {
  EXPECT_EQ(
      Register(3, kShell,
               Effect("uniform float2 points[3];", "return content.eval(p);")),
      "");

  ASSERT_EQ(arrays_.size(), 1u);
  EXPECT_EQ(arrays_[0]->name, "points");
  EXPECT_EQ(arrays_[0]->floats, 6u);
}

TEST_F(ShaderEffectsTest, ResolvesAMeshEffectForSkiaRendererToDraw) {
  auto source = mojom::DomicileShaderEffectSource::New();
  source->sksl = kFragment;
  source->vertex = kVertex;
  source->instances = 4;
  ASSERT_EQ(Register(3, kShell, std::move(source)), "");
  cc::FilterOperations filters;
  filters.Append(cc::FilterOperation::CreateGrayscaleFilter(1.f));
  filters.Append(Shader(3, 2.f, {}));
  base::flat_set<uint32_t> drawn;

  const cc::FilterOperations resolved =
      ResolveShaderEffects(filters, effects_, kShell, drawn);

  EXPECT_EQ(FindMeshEffect(resolved), &resolved.at(1));
  EXPECT_FALSE(resolved.at(1).shader_runtime_effect());
  EXPECT_FALSE(FindMeshEffect(filters));
  // The image filter leaves the mesh to SkiaRenderer.
  EXPECT_EQ(drawn, base::flat_set<uint32_t>({3}));
}

TEST_F(ShaderEffectsTest, ReportsWhatEveryDisplayDraws) {
  int one = 0;
  int two = 0;

  effects_.SetDrawing(&one, {3});
  effects_.SetDrawing(&two, {3, 4});
  effects_.SetDrawing(&two, {3, 4});
  effects_.SetDrawing(&one, {});
  effects_.SetDrawing(&two, {});

  EXPECT_EQ(Reports(), std::vector<std::vector<uint32_t>>({{3}, {3, 4}, {}}));
}

// Draws a `content` rectangle of `color` through `filters` into a 40x20
// bitmap, which it returns.
SkBitmap Draw(const cc::FilterOperations& filters,
              const gfx::RectF& content,
              SkColor color,
              const SkMatrix& local_matrix = SkMatrix::I()) {
  SkBitmap bitmap;
  bitmap.allocN32Pixels(40, 20);
  SkCanvas canvas(bitmap);
  canvas.clear(SK_ColorTRANSPARENT);
  SkPaint layer;
  layer.setImageFilter(BuildShadedImageFilter(filters, content, local_matrix));
  canvas.saveLayer(nullptr, &layer);
  SkPaint fill;
  fill.setColor(color);
  canvas.drawRect(gfx::RectFToSkRect(content), fill);
  canvas.restore();
  return bitmap;
}

cc::FilterOperations Only(cc::FilterOperation op) {
  cc::FilterOperations filters;
  filters.Append(op);
  return filters;
}

TEST(ShadedImageFilterTest, ShadesTheContent) {
  const SkBitmap drawn =
      Draw(Only(Shader(1, 0.f, {},
                       Compiled(Effect("", "return content.eval(p).bgra;")))),
           gfx::RectF(0, 0, 10, 10), SK_ColorRED);

  EXPECT_EQ(drawn.getColor(5, 5), SK_ColorBLUE);
}

TEST(ShadedImageFilterTest, MeasuresFromTheContentsTopLeft) {
  const SkBitmap drawn = Draw(
      Only(Shader(1, 0.f, {},
                  Compiled(Effect("",
                                  "return p.x < size.x / 2 ? "
                                  "half4(0, 1, 0, 1) : content.eval(p);")))),
      gfx::RectF(20, 0, 20, 20), SK_ColorRED);

  EXPECT_EQ(drawn.getColor(25, 10), SK_ColorGREEN);
  EXPECT_EQ(drawn.getColor(35, 10), SK_ColorRED);
}

TEST(ShadedImageFilterTest, TakesItsArgumentsInOrder) {
  const SkBitmap drawn =
      Draw(Only(Shader(1, 0.f, {0.f, 1.f, 1.f},
                       Compiled(Effect("uniform float r;\nuniform float2 gb;",
                                       "return half4(r, gb, 1);")))),
           gfx::RectF(0, 0, 10, 10), SK_ColorRED);

  EXPECT_EQ(drawn.getColor(5, 5), SK_ColorCYAN);
}

TEST(ShadedImageFilterTest, DrawsOnlyAsFarAsItsOutset) {
  const SkBitmap drawn =
      Draw(Only(Shader(1, 2.f, {},
                       Compiled(Effect("", "return half4(0, 1, 0, 1);")))),
           gfx::RectF(10, 5, 10, 10), SK_ColorRED);

  EXPECT_EQ(drawn.getColor(9, 10), SK_ColorGREEN);
  EXPECT_EQ(drawn.getColor(21, 10), SK_ColorGREEN);
  EXPECT_EQ(drawn.getColor(7, 10), SK_ColorTRANSPARENT);
  EXPECT_EQ(drawn.getColor(23, 10), SK_ColorTRANSPARENT);
}

TEST(ShadedImageFilterTest, RunsAfterTheFiltersBeforeIt) {
  cc::FilterOperations filters;
  filters.Append(cc::FilterOperation::CreateInvertFilter(1.f));
  filters.Append(Shader(
      1, 0.f, {},
      Compiled(Effect("", "return half4(content.eval(p).r, 0, 0, 1);"))));

  // Green inverts to magenta, whose red the effect keeps. The other way
  // round, it would be white.
  EXPECT_EQ(
      Draw(filters, gfx::RectF(0, 0, 10, 10), SK_ColorGREEN).getColor(5, 5),
      SK_ColorRED);
}

TEST(ShadedImageFilterTest, SkipsAnEffectWithoutAProgram) {
  cc::FilterOperations filters;
  filters.Append(Shader(1, 0.f, {}));
  filters.Append(cc::FilterOperation::CreateInvertFilter(1.f));

  EXPECT_EQ(
      Draw(filters, gfx::RectF(0, 0, 10, 10), SK_ColorGREEN).getColor(5, 5),
      SK_ColorMAGENTA);
}

TEST(ShadedImageFilterTest, ReadsItsArrays) {
  const SkBitmap drawn =
      Draw(Only(Shader(1, 0.f, {1.f},
                       Compiled(Effect("uniform float alpha;\n"
                                       "uniform float3 colors[2];",
                                       "return half4(colors[1], alpha);")),
                       {1.f, 0.f, 0.f, 0.f, 1.f, 0.f})),
           gfx::RectF(0, 0, 10, 10), SK_ColorRED);

  EXPECT_EQ(drawn.getColor(5, 5), SK_ColorGREEN);
}

TEST(ShadedImageFilterTest, ReadsZeroForArraysThePageHasNotSet) {
  const SkBitmap drawn =
      Draw(Only(Shader(1, 0.f, {},
                       Compiled(Effect("uniform float3 colors[2];",
                                       "return half4(colors[1], 1);")))),
           gfx::RectF(0, 0, 10, 10), SK_ColorRED);

  EXPECT_EQ(drawn.getColor(5, 5), SK_ColorBLACK);
}

TEST(ShadedImageFilterTest, SamplesItsImages) {
  auto compiled = CompileShaderEffect(
      WithImage(Effect("uniform shader noise;", "return noise.eval(p);"),
                Image("noise", 2, 2, {0, 0, 255, 255})));
  ASSERT_TRUE(compiled.has_value()) << compiled.error();
  cc::FilterOperation op = Shader(1, 0.f, {}, compiled->program);
  op.set_shader_inputs(compiled->inputs);

  // The image repeats across the content.
  EXPECT_EQ(
      Draw(Only(op), gfx::RectF(0, 0, 10, 10), SK_ColorRED).getColor(7, 7),
      SK_ColorBLUE);
}

TEST(MeshEffectBoundsTest, ReachTheOutsetInTheQuadsSpace) {
  // The quad is at twice the scale of the filters, so an outset of 1 is 2
  // of its pixels.
  EXPECT_EQ(MeshEffectBounds(Shader(1, 1.f, {}), gfx::Rect(0, 0, 10, 10),
                             SkMatrix::Scale(2, 2)),
            gfx::RectF(-2, -2, 14, 14));
}

TEST(ShadedImageFilterTest, MeasuresInThePassesPixelsUnderAScale) {
  // The display scale doubles filter space: the 20 pixel quad is 10 in
  // filter space. The effect still draws, in the pass's pixels.
  const SkBitmap drawn = Draw(
      Only(Shader(1, 0.f, {},
                  Compiled(Effect("",
                                  "return size.x == 20 && p.x < 10 ? "
                                  "half4(0, 1, 0, 1) : content.eval(p);")))),
      gfx::RectF(0, 0, 20, 20), SK_ColorRED, SkMatrix::Scale(2, 2));

  EXPECT_EQ(drawn.getColor(5, 10), SK_ColorGREEN);
  EXPECT_EQ(drawn.getColor(15, 10), SK_ColorRED);
}

TEST(ShadedImageFilterTest, ScalesItsOutsetWithTheFilters) {
  // An outset of 2 in filter space is 4 of the pass's pixels at twice the
  // scale.
  const SkBitmap drawn =
      Draw(Only(Shader(1, 2.f, {},
                       Compiled(Effect("", "return half4(0, 1, 0, 1);")))),
           gfx::RectF(10, 5, 10, 10), SK_ColorRED, SkMatrix::Scale(2, 2));

  EXPECT_EQ(drawn.getColor(7, 10), SK_ColorGREEN);
  EXPECT_EQ(drawn.getColor(23, 10), SK_ColorGREEN);
  EXPECT_EQ(drawn.getColor(5, 10), SK_ColorTRANSPARENT);
  EXPECT_EQ(drawn.getColor(25, 10), SK_ColorTRANSPARENT);
}

}  // namespace
}  // namespace viz::domicile
