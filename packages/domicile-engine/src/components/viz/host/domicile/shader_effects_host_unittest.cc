// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/viz/host/domicile/shader_effects_host.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "base/functional/callback_helpers.h"
#include "base/test/bind.h"
#include "base/test/task_environment.h"
#include "components/viz/test/test_frame_sink_manager.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace viz::domicile {
namespace {

const FrameSinkId kShell(1, 1);

// Viz's end: every source compiles but "bad", taking two floats.
class FakeViz : public TestFrameSinkManagerImpl,
                public mojom::DomicileShaderEffects {
 public:
  // Ids registered, in order.
  std::vector<uint32_t> registered;
  std::vector<uint32_t> unregistered;
  // When false, Register never answers.
  bool answers = true;

  void Draw(const std::vector<uint32_t>& ids) { client_->Drawing(ids); }

 private:
  // mojom::FrameSinkManager:
  void BindDomicileShaderEffects(
      mojo::PendingReceiver<mojom::DomicileShaderEffects> receiver,
      mojo::PendingRemote<mojom::DomicileShaderEffectsClient> client) override {
    receiver_.Bind(std::move(receiver));
    client_.Bind(std::move(client));
  }

  // mojom::DomicileShaderEffects:
  void Register(uint32_t id,
                const FrameSinkId& owner,
                const std::string& sksl,
                RegisterCallback callback) override {
    registered.push_back(id);
    if (!answers) {
      unanswered_.push_back(std::move(callback));
    } else if (sksl == "bad") {
      std::move(callback).Run(0, "error: 1: bad");
    } else {
      std::move(callback).Run(2, "");
    }
  }
  void Unregister(uint32_t id) override { unregistered.push_back(id); }

  // Before the receiver, so that it closes first: a responder may go only
  // once its binding has.
  std::vector<RegisterCallback> unanswered_;
  mojo::Receiver<mojom::DomicileShaderEffects> receiver_{this};
  mojo::Remote<mojom::DomicileShaderEffectsClient> client_;
};

class ShaderEffectsHostTest : public testing::Test {
 protected:
  // Registers `sksl`, and returns what the host answered once viz has.
  base::expected<ShaderEffectsHost::Registered, std::string> Register(
      const std::string& sksl,
      ShaderEffectsHost::LostCallback lost = base::DoNothing()) {
    base::expected<ShaderEffectsHost::Registered, std::string> answer =
        base::unexpected("no answer");
    host_.Register(
        kShell, sksl, std::move(lost),
        base::BindLambdaForTesting(
            [&answer](base::expected<ShaderEffectsHost::Registered, std::string>
                          said) { answer = said; }));
    task_environment_.RunUntilIdle();
    return answer;
  }

  // A new GPU process's viz, connected.
  FakeViz& Relaunch() {
    viz_ = std::make_unique<FakeViz>();
    host_.Connect(*viz_);
    task_environment_.RunUntilIdle();
    return *viz_;
  }

  base::test::TaskEnvironment task_environment_;
  std::unique_ptr<FakeViz> viz_;
  ShaderEffectsHost host_;
};

TEST_F(ShaderEffectsHostTest, NamesEachEffect) {
  Relaunch();

  auto first = Register("ok");
  auto second = Register("ok");

  ASSERT_TRUE(first.has_value());
  ASSERT_TRUE(second.has_value());
  EXPECT_NE(first->id, second->id);
  EXPECT_EQ(first->arguments, 2u);
  EXPECT_EQ(viz_->registered, std::vector<uint32_t>({first->id, second->id}));
}

TEST_F(ShaderEffectsHostTest, SaysWhatTheCompilerSaid) {
  Relaunch();

  EXPECT_EQ(Register("bad"), base::unexpected("error: 1: bad"));
}

TEST_F(ShaderEffectsHostTest, RefusesWhileTheGpuProcessIsAway) {
  EXPECT_EQ(Register("ok"), base::unexpected("the GPU process is restarting"));
}

TEST_F(ShaderEffectsHostTest, AnswersARegisterTheGpuProcessCutShort) {
  Relaunch().answers = false;
  base::expected<ShaderEffectsHost::Registered, std::string> answer =
      base::unexpected("no answer");
  host_.Register(
      kShell, "ok", base::DoNothing(),
      base::BindLambdaForTesting(
          [&answer](
              base::expected<ShaderEffectsHost::Registered, std::string> said) {
            answer = said;
          }));
  task_environment_.RunUntilIdle();

  host_.OnConnectionLost();

  EXPECT_EQ(answer, base::unexpected("the GPU process is restarting"));
}

TEST_F(ShaderEffectsHostTest, GivesARelaunchedGpuProcessItsEffects) {
  Relaunch();
  const uint32_t first = Register("ok")->id;
  const uint32_t second = Register("ok")->id;

  host_.OnConnectionLost();
  FakeViz& relaunched = Relaunch();

  EXPECT_EQ(relaunched.registered, std::vector<uint32_t>({first, second}));
}

TEST_F(ShaderEffectsHostTest, DropsTheEffectsThatWereDrawingWhenItWent) {
  Relaunch();
  bool first_lost = false;
  bool second_lost = false;
  const uint32_t first =
      Register("ok",
               base::BindLambdaForTesting([&](uint32_t) { first_lost = true; }))
          ->id;
  const uint32_t second =
      Register("ok", base::BindLambdaForTesting(
                         [&](uint32_t) { second_lost = true; }))
          ->id;
  viz_->Draw({first});
  task_environment_.RunUntilIdle();

  host_.OnConnectionLost();
  FakeViz& relaunched = Relaunch();

  EXPECT_TRUE(first_lost);
  EXPECT_FALSE(second_lost);
  EXPECT_EQ(relaunched.registered, std::vector<uint32_t>({second}));
}

TEST_F(ShaderEffectsHostTest, ForgetsAnUnregisteredEffect) {
  Relaunch();
  const uint32_t id = Register("ok")->id;

  host_.Unregister(id);
  task_environment_.RunUntilIdle();
  const std::vector<uint32_t> unregistered = viz_->unregistered;
  host_.OnConnectionLost();
  FakeViz& relaunched = Relaunch();

  EXPECT_EQ(unregistered, std::vector<uint32_t>({id}));
  EXPECT_TRUE(relaunched.registered.empty());
}

}  // namespace
}  // namespace viz::domicile
