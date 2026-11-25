// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/viz/host/domicile/shader_effects_host.h"

#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "mojo/public/cpp/bindings/callback_helpers.h"

namespace viz::domicile {

namespace {

constexpr char kRestarting[] = "the GPU process is restarting";

}  // namespace

ShaderEffectsHost::Registered::Registered() = default;
ShaderEffectsHost::Registered::Registered(Registered&&) = default;
ShaderEffectsHost::Registered& ShaderEffectsHost::Registered::operator=(
    Registered&&) = default;
ShaderEffectsHost::Registered::~Registered() = default;

ShaderEffectsHost::Effect::Effect(FrameSinkId owner,
                                  mojom::DomicileShaderEffectSourcePtr source,
                                  LostCallback lost)
    : owner(owner), source(std::move(source)), lost(std::move(lost)) {}
ShaderEffectsHost::Effect::Effect(Effect&&) = default;
ShaderEffectsHost::Effect& ShaderEffectsHost::Effect::operator=(Effect&&) =
    default;
ShaderEffectsHost::Effect::~Effect() = default;

ShaderEffectsHost::ShaderEffectsHost() = default;
ShaderEffectsHost::~ShaderEffectsHost() = default;

void ShaderEffectsHost::Connect(mojom::FrameSinkManager& manager) {
  registry_.reset();
  receiver_.reset();
  manager.BindDomicileShaderEffects(registry_.BindNewPipeAndPassReceiver(),
                                    receiver_.BindNewPipeAndPassRemote());
  // The same source compiles the same way, so the answers say nothing new.
  for (const auto& [id, effect] : effects_) {
    registry_->Register(id, effect.owner, effect.source.Clone(),
                        base::DoNothing());
  }
}

void ShaderEffectsHost::OnConnectionLost() {
  registry_.reset();
  receiver_.reset();
  // Taken out first: a `lost` may unregister another effect.
  std::vector<std::pair<uint32_t, LostCallback>> lost;
  for (const uint32_t& id : drawing_) {
    auto effect = effects_.find(id);
    if (effect != effects_.end()) {
      lost.emplace_back(id, std::move(effect->second.lost));
      effects_.erase(effect);
    }
  }
  drawing_.clear();
  for (auto& [id, run] : lost) {
    std::move(run).Run(id);
  }
}

void ShaderEffectsHost::Register(const FrameSinkId& owner,
                                 mojom::DomicileShaderEffectSourcePtr source,
                                 LostCallback lost,
                                 RegisterCallback done) {
  if (!registry_.is_bound()) {
    std::move(done).Run(base::unexpected(std::string(kRestarting)));
    return;
  }
  const uint32_t id = next_id_++;
  // Kept to register again in a relaunched GPU process.
  mojom::DomicileShaderEffectSourcePtr kept = source.Clone();
  registry_->Register(
      id, owner, std::move(source),
      mojo::WrapCallbackWithDefaultInvokeIfNotRun(
          base::BindOnce(&ShaderEffectsHost::OnRegistered,
                         weak_factory_.GetWeakPtr(), id, owner,
                         std::move(kept), std::move(lost), std::move(done)),
          0u, std::vector<mojom::DomicileShaderEffectArrayPtr>(),
          std::string(kRestarting)));
}

void ShaderEffectsHost::Unregister(uint32_t id) {
  effects_.erase(id);
  drawing_.erase(id);
  if (registry_.is_bound()) {
    registry_->Unregister(id);
  }
}

void ShaderEffectsHost::Drawing(const std::vector<uint32_t>& ids) {
  drawing_ = base::flat_set<uint32_t>(ids.begin(), ids.end());
}

void ShaderEffectsHost::OnRegistered(
    uint32_t id,
    FrameSinkId owner,
    mojom::DomicileShaderEffectSourcePtr source,
    LostCallback lost,
    RegisterCallback done,
    uint32_t arguments,
    std::vector<mojom::DomicileShaderEffectArrayPtr> arrays,
    const std::string& error) {
  if (!error.empty()) {
    std::move(done).Run(base::unexpected(error));
    return;
  }
  effects_.insert_or_assign(id,
                            Effect(owner, std::move(source), std::move(lost)));
  Registered registered;
  registered.id = id;
  registered.arguments = arguments;
  registered.arrays = std::move(arrays);
  std::move(done).Run(std::move(registered));
}

}  // namespace viz::domicile
