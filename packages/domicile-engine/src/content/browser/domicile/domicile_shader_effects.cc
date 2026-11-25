// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "content/browser/domicile/domicile_shader_effects.h"

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "base/containers/flat_set.h"
#include "base/functional/bind.h"
#include "base/memory/self_deleting.h"
#include "base/memory/weak_ptr.h"
#include "base/types/expected.h"
#include "components/domicile/browser/shell_origin.h"
#include "components/viz/host/domicile/shader_effects_host.h"
#include "components/viz/host/host_frame_sink_manager.h"
#include "content/browser/compositor/surface_utils.h"
#include "content/public/browser/document_service.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host.h"
#include "mojo/public/cpp/bindings/message.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "services/viz/privileged/mojom/compositing/frame_sink_manager.mojom.h"

namespace content {

namespace {

// The browser's effects, or null before the compositor is up and after it
// is gone.
viz::domicile::ShaderEffectsHost* Effects() {
  viz::HostFrameSinkManager* manager = GetHostFrameSinkManager();
  return manager ? &manager->domicile_shader_effects() : nullptr;
}

// The source as viz takes it. The domicile mojom stays apart from viz's
// privileged one, which no renderer may see.
viz::mojom::DomicileShaderEffectSourcePtr ToViz(
    domicile::mojom::ShaderEffectSourcePtr source) {
  auto viz_source = viz::mojom::DomicileShaderEffectSource::New();
  viz_source->sksl = std::move(source->sksl);
  viz_source->vertex = std::move(source->vertex);
  viz_source->columns = source->columns;
  viz_source->rows = source->rows;
  viz_source->instances = source->instances;
  for (auto& image : source->images) {
    viz_source->images.push_back(viz::mojom::DomicileShaderEffectImage::New(
        std::move(image->name), image->size, std::move(image->pixels)));
  }
  return viz_source;
}

void UnregisterEffect(uint32_t id) {
  if (viz::domicile::ShaderEffectsHost* effects = Effects()) {
    effects->Unregister(id);
  }
}

// One shell document's effects. A DocumentService, so a reloaded shell
// starts with none.
class ShaderEffectsService final
    : public DocumentService<domicile::mojom::ShaderEffects> {
 public:
  ShaderEffectsService(
      RenderFrameHost& frame,
      mojo::PendingReceiver<domicile::mojom::ShaderEffects> receiver,
      base::SelfDeletingPassKey key)
      : DocumentService(frame, std::move(receiver), key) {}

 private:
  ~ShaderEffectsService() override {
    for (const uint32_t& id : ids_) {
      UnregisterEffect(id);
    }
  }

  // An answer to Register. The effect goes if the document went first.
  static void OnRegistered(
      base::WeakPtr<ShaderEffectsService> service,
      RegisterCallback callback,
      base::expected<viz::domicile::ShaderEffectsHost::Registered, std::string>
          registered) {
    if (!registered.has_value()) {
      std::move(callback).Run(0, 0, {}, registered.error());
    } else if (!service) {
      UnregisterEffect(registered->id);
    } else {
      service->ids_.insert(registered->id);
      std::vector<domicile::mojom::ShaderEffectArrayPtr> arrays;
      for (const auto& array : registered->arrays) {
        arrays.push_back(
            domicile::mojom::ShaderEffectArray::New(array->name, array->floats));
      }
      std::move(callback).Run(registered->id, registered->arguments,
                              std::move(arrays), std::string());
    }
  }

  void OnLost(uint32_t id) {
    ids_.erase(id);
    if (client_.is_bound()) {
      client_->Lost(id);
    }
  }

  // domicile::mojom::ShaderEffects:
  void Listen(mojo::PendingRemote<domicile::mojom::ShaderEffectsClient> client)
      override {
    if (client_.is_bound()) {
      ReportBadMessageAndDeleteThis(
          "domicile: the shader effects have one client per document.");
      return;
    }
    client_.Bind(std::move(client));
  }

  void Register(domicile::mojom::ShaderEffectSourcePtr source,
                RegisterCallback callback) override {
    viz::domicile::ShaderEffectsHost* effects = Effects();
    if (!effects) {
      std::move(callback).Run(0, 0, {}, "the compositor is not up");
      return;
    }
    // The widget's frame sink is the one whose frames hold the document's
    // filters, so it is the only one that draws the effect. Viz checks the
    // source: it compiles it.
    effects->Register(
        render_frame_host().GetRenderWidgetHost()->GetFrameSinkId(),
        ToViz(std::move(source)),
        base::BindOnce(&ShaderEffectsService::OnLost,
                       weak_factory_.GetWeakPtr()),
        base::BindOnce(&ShaderEffectsService::OnRegistered,
                       weak_factory_.GetWeakPtr(), std::move(callback)));
  }

  void Unregister(uint32_t id) override {
    if (!ids_.contains(id)) {
      ReportBadMessageAndDeleteThis(
          "domicile: a document unregisters only its own shader effects.");
      return;
    }
    ids_.erase(id);
    UnregisterEffect(id);
  }

  base::flat_set<uint32_t> ids_;
  mojo::Remote<domicile::mojom::ShaderEffectsClient> client_;
  base::WeakPtrFactory<ShaderEffectsService> weak_factory_{this};
};

}  // namespace

void BindDomicileShaderEffects(
    RenderFrameHost* frame,
    mojo::PendingReceiver<domicile::mojom::ShaderEffects> receiver) {
  // Checked at bind time: the binder map is built before a document commits.
  if (!domicile::IsShellOrigin(frame->GetLastCommittedOrigin())) {
    mojo::ReportBadMessage("domicile: only the shell may run shader effects.");
    return;
  }
  // Owns itself and dies with the document, like every DocumentService.
  base::MakeSelfDeleting<ShaderEffectsService>(*frame, std::move(receiver));
}

}  // namespace content
