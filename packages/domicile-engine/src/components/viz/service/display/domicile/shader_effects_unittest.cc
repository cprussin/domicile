// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/viz/service/display/domicile/shader_effects.h"

#include <cstdint>
#include <string>
#include <string_view>
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
                           sk_sp<SkRuntimeEffect> program = nullptr) {
  cc::FilterOperation op =
      cc::FilterOperation::CreateShaderFilter(id, outset, std::move(arguments));
  op.set_shader_runtime_effect(std::move(program));
  return op;
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

TEST(ShaderEffectCompileTest, RefusesASecondChild) {
  EXPECT_FALSE(CompileShaderEffect(
                   Effect("uniform shader other;", "return other.eval(p);"))
                   .has_value());
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
    std::string said = "no answer";
    effects_.Register(
        id, owner, sksl,
        base::BindLambdaForTesting(
            [&said](uint32_t, const std::string& error) { said = error; }));
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
