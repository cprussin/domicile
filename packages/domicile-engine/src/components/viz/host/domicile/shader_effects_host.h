// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_VIZ_HOST_DOMICILE_SHADER_EFFECTS_HOST_H_
#define COMPONENTS_VIZ_HOST_DOMICILE_SHADER_EFFECTS_HOST_H_

#include <cstdint>
#include <string>
#include <vector>

#include "base/containers/flat_map.h"
#include "base/containers/flat_set.h"
#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/types/expected.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "components/viz/host/viz_host_export.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "services/viz/privileged/mojom/compositing/frame_sink_manager.mojom.h"

namespace viz::domicile {

// The browser's end of viz's shader effects (see
// //components/viz/service/display/domicile/shader_effects.h). It names each
// effect and keeps its source, so that a relaunched GPU process gets the
// effects back, except those it was drawing when it went: a hung effect trips
// the GPU watchdog, and drawing it again would hang the new process too.
class VIZ_HOST_EXPORT ShaderEffectsHost
    : public mojom::DomicileShaderEffectsClient {
 public:
  struct Registered {
    Registered();
    Registered(Registered&&);
    Registered& operator=(Registered&&);
    ~Registered();

    uint32_t id = 0;
    // How many floats the effect takes after `size`.
    uint32_t arguments = 0;
    // Its array uniforms, in the order it declares them.
    std::vector<mojom::DomicileShaderEffectArrayPtr> arrays;
  };
  using RegisterCallback =
      base::OnceCallback<void(base::expected<Registered, std::string>)>;

  ShaderEffectsHost();
  ShaderEffectsHost(const ShaderEffectsHost&) = delete;
  ShaderEffectsHost& operator=(const ShaderEffectsHost&) = delete;
  ~ShaderEffectsHost() override;

  // Connects to `manager`'s registry and registers every kept effect there.
  void Connect(mojom::FrameSinkManager& manager);

  // The registry went with the GPU process. Drops the effects it was drawing
  // and runs their `lost`.
  void OnConnectionLost();

  // Runs with an effect's id when the engine drops it.
  using LostCallback = base::OnceCallback<void(uint32_t)>;

  // Compiles `source` in viz as an effect only `owner`'s frames draw. `lost`
  // runs if the engine drops it after a GPU hang.
  void Register(const FrameSinkId& owner,
                mojom::DomicileShaderEffectSourcePtr source,
                LostCallback lost,
                RegisterCallback done);

  void Unregister(uint32_t id);

  // mojom::DomicileShaderEffectsClient:
  void Drawing(const std::vector<uint32_t>& ids) override;

 private:
  struct Effect {
    Effect(FrameSinkId owner,
           mojom::DomicileShaderEffectSourcePtr source,
           LostCallback lost);
    Effect(Effect&&);
    Effect& operator=(Effect&&);
    ~Effect();

    FrameSinkId owner;
    mojom::DomicileShaderEffectSourcePtr source;
    LostCallback lost;
  };

  void OnRegistered(uint32_t id,
                    FrameSinkId owner,
                    mojom::DomicileShaderEffectSourcePtr source,
                    LostCallback lost,
                    RegisterCallback done,
                    uint32_t arguments,
                    std::vector<mojom::DomicileShaderEffectArrayPtr> arrays,
                    const std::string& error);

  uint32_t next_id_ = 1;
  base::flat_map<uint32_t, Effect> effects_;
  base::flat_set<uint32_t> drawing_;
  mojo::Remote<mojom::DomicileShaderEffects> registry_;
  mojo::Receiver<mojom::DomicileShaderEffectsClient> receiver_{this};
  base::WeakPtrFactory<ShaderEffectsHost> weak_factory_{this};
};

}  // namespace viz::domicile

#endif  // COMPONENTS_VIZ_HOST_DOMICILE_SHADER_EFFECTS_HOST_H_
