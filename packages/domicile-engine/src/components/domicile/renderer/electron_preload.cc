// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/renderer/electron_preload.h"

#include <cstdint>
#include <iterator>
#include <string>
#include <tuple>
#include <utility>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/strings/strcat.h"
#include "components/domicile/renderer/context_bridge.h"
#include "content/public/renderer/render_frame.h"
#include "gin/converter.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "third_party/blink/public/platform/scheduler/web_agent_group_scheduler.h"
#include "third_party/blink/public/platform/web_string.h"
#include "third_party/blink/public/platform/web_url.h"
#include "third_party/blink/public/web/web_console_message.h"
#include "third_party/blink/public/web/web_document.h"
#include "third_party/blink/public/web/web_local_frame.h"
#include "third_party/blink/public/web/web_script_source.h"
#include "url/gurl.h"
#include "v8/include/v8-context.h"
#include "v8/include/v8-exception.h"
#include "v8/include/v8-function-callback.h"
#include "v8/include/v8-function.h"
#include "v8/include/v8-isolate.h"
#include "v8/include/v8-local-handle.h"
#include "v8/include/v8-object.h"
#include "v8/include/v8-primitive.h"

namespace domicile {
namespace {

// The preload's isolated world. Chrome numbers its own worlds just past
// content's and extensions count theirs up from there, so this stays far
// above both and below Blink's kEmbedderWorldIdLimit (1 << 29).
constexpr int32_t kElectronPreloadWorld = 1 << 20;

// Run in the preload's world with the natives and the preload, as a function
// of Node's module arguments. Gives back the two functions the browser's
// messages call. Everything Electron-shaped lives here; the natives only move
// strings and values.
constexpr char kBootstrap[] = R"JS(
(function (native, preload) {
  'use strict';
  const listeners = new Map();
  const answers = new Map();
  let nextInvoke = 1;
  // An error in a listener or the preload reaches the console, as an uncaught
  // one, and stops nothing else.
  const report = (error) => queueMicrotask(() => { throw error; });
  const listen = (channel, listener, once) => {
    if (typeof listener !== 'function') {
      throw new TypeError('an ipcRenderer listener must be a function');
    }
    const key = String(channel);
    const list = listeners.get(key) ?? [];
    list.push({ listener, once });
    listeners.set(key, list);
  };
  const unsupported = (what) => () => {
    throw new Error(`${what} does not work on Domicile yet`);
  };
  const ipcRenderer = {
    send(channel, ...args) {
      native.send(String(channel), JSON.stringify(args));
    },
    invoke(channel, ...args) {
      const key = String(channel);
      const json = JSON.stringify(args);
      return new Promise((resolve, reject) => {
        const id = nextInvoke++;
        answers.set(id, { channel: key, resolve, reject });
        native.invoke(id, key, json);
      });
    },
    on(channel, listener) {
      listen(channel, listener, false);
      return ipcRenderer;
    },
    once(channel, listener) {
      listen(channel, listener, true);
      return ipcRenderer;
    },
    removeListener(channel, listener) {
      const key = String(channel);
      const list = listeners.get(key);
      if (list) {
        const at = list.findIndex((entry) => entry.listener === listener);
        if (at >= 0) list.splice(at, 1);
        if (list.length === 0) listeners.delete(key);
      }
      return ipcRenderer;
    },
    removeAllListeners(channel) {
      if (channel === undefined) listeners.clear();
      else listeners.delete(String(channel));
      return ipcRenderer;
    },
    listenerCount(channel) {
      return listeners.get(String(channel))?.length ?? 0;
    },
    sendSync: unsupported('ipcRenderer.sendSync'),
    postMessage: unsupported('ipcRenderer.postMessage'),
    sendToHost: unsupported('ipcRenderer.sendToHost'),
  };
  ipcRenderer.addListener = ipcRenderer.on;
  ipcRenderer.off = ipcRenderer.removeListener;
  const contextBridge = {
    exposeInMainWorld(key, api) {
      native.expose(String(key), api);
    },
    exposeInIsolatedWorld: unsupported('contextBridge.exposeInIsolatedWorld'),
  };
  const electron = Object.freeze({ contextBridge, ipcRenderer });
  const require = (name) => {
    if (name === 'electron' || name === 'electron/renderer') return electron;
    throw new Error(
      `Cannot find module '${name}': a preload on Domicile can require ` +
      'only electron');
  };
  const process = {
    platform: 'linux',
    type: 'renderer',
    sandboxed: true,
    contextIsolated: true,
    env: {},
    argv: [],
    versions: {},
  };
  const module = { exports: {} };
  try {
    preload.call(globalThis, require, process, module, module.exports,
                 globalThis);
  } catch (error) {
    report(error);
  }
  return {
    deliver(channel, json) {
      const list = listeners.get(channel);
      if (!list) return;
      const args = JSON.parse(json);
      const event = { sender: ipcRenderer, senderId: 0, ports: [] };
      for (const entry of [...list]) {
        if (entry.once) ipcRenderer.removeListener(channel, entry.listener);
        try {
          entry.listener(event, ...args);
        } catch (error) {
          report(error);
        }
      }
    },
    settle(id, ok, answer) {
      const waiting = answers.get(id);
      if (!waiting) return;
      answers.delete(id);
      if (ok) {
        waiting.resolve(JSON.parse(answer));
      } else {
        waiting.reject(new Error(
          `Error invoking remote method '${waiting.channel}': ${answer}`));
      }
    },
  };
})
)JS";

// The preload, as a function of Node's module arguments. The newline before
// the close keeps a last-line comment from swallowing it.
std::string Wrapped(const std::string& source) {
  return base::StrCat(
      {"(function (require, process, module, exports, global) {", source,
       "\n})"});
}

v8::Isolate* IsolateOf(blink::WebLocalFrame& frame) {
  return frame.GetAgentGroupScheduler()->Isolate();
}

}  // namespace

// static
void ElectronPreload::Attach(content::RenderFrame* frame) {
  if (frame->IsMainFrame()) {
    new ElectronPreload(frame);
  }
}

ElectronPreload::ElectronPreload(content::RenderFrame* frame)
    : content::RenderFrameObserver(frame),
      content::RenderFrameObserverTracker<ElectronPreload>(frame) {
  frame->GetAssociatedInterfaceRegistry()->AddInterface<mojom::ElectronFrame>(
      base::BindRepeating(&ElectronPreload::Bind, weak_factory_.GetWeakPtr()));
}

ElectronPreload::~ElectronPreload() = default;

void ElectronPreload::Bind(
    mojo::PendingAssociatedReceiver<mojom::ElectronFrame> receiver) {
  // The browser asks again for each navigation.
  receiver_.reset();
  receiver_.Bind(std::move(receiver));
}

void ElectronPreload::ReadyToCommitNavigation(
    blink::WebDocumentLoader* document_loader) {
  ++document_;
  deliver_.Reset();
  settle_.Reset();
  host_.reset();
  to_run_.reset();
  if (next_.has_value()) {
    host_.Bind(std::move(next_->host));
    to_run_ = std::move(next_->source);
    next_.reset();
  }
}

void ElectronPreload::DidCreateDocumentElement() {
  if (to_run_.has_value()) {
    const std::string source = std::move(*to_run_);
    to_run_.reset();
    Run(source);
  }
}

void ElectronPreload::OnDestruct() {
  delete this;
}

void ElectronPreload::Preload(
    const std::string& source,
    mojo::PendingAssociatedRemote<mojom::ElectronFrameHost> host) {
  next_ = Next{.source = source, .host = std::move(host)};
}

void ElectronPreload::Deliver(const std::string& channel,
                              const std::string& args_json) {
  if (deliver_.IsEmpty()) {
    // No preload ran in this document, so nothing listens.
    return;
  }
  blink::WebLocalFrame& frame = *render_frame()->GetWebFrame();
  v8::Isolate* isolate = IsolateOf(frame);
  v8::HandleScope handle_scope(isolate);
  v8::Local<v8::Value> argv[] = {gin::StringToV8(isolate, channel),
                                 gin::StringToV8(isolate, args_json)};
  Call(deliver_, static_cast<int>(std::size(argv)), argv);
}

void ElectronPreload::Run(const std::string& source) {
  blink::WebLocalFrame& frame = *render_frame()->GetWebFrame();
  v8::Isolate* isolate = IsolateOf(frame);
  v8::HandleScope handle_scope(isolate);
  v8::Local<v8::Value> bootstrap =
      frame.ExecuteScriptInIsolatedWorldAndReturnValue(
          kElectronPreloadWorld,
          blink::WebScriptSource(blink::WebString::FromUtf8(kBootstrap),
                                 GURL("domicile-electron:///bootstrap.js")),
          blink::BackForwardCacheAware::kAllow);
  // The bootstrap is ours, so its failing is the engine's bug.
  CHECK(!bootstrap.IsEmpty() && bootstrap->IsFunction())
      << "domicile: the Electron preload's bootstrap did not compile";
  v8::Local<v8::Value> preload =
      frame.ExecuteScriptInIsolatedWorldAndReturnValue(
          kElectronPreloadWorld,
          blink::WebScriptSource(blink::WebString::FromUtf8(Wrapped(source)),
                                 GURL("domicile-electron:///preload.js")),
          blink::BackForwardCacheAware::kAllow);
  if (preload.IsEmpty() || !preload->IsFunction()) {
    // The app's bug. Blink already put the syntax error on the console.
    LOG(ERROR) << "domicile: an Electron window's preload did not compile; "
                  "the page runs without it.";
    frame.AddMessageToConsole(blink::WebConsoleMessage(
        blink::mojom::ConsoleMessageLevel::kError,
        blink::WebString::FromUtf8(
            "Unable to load preload script: it did not compile.")));
    return;
  }
  v8::Local<v8::Context> world =
      frame.GetScriptContextFromWorldId(isolate, kElectronPreloadWorld);
  v8::Context::Scope scope(world);
  v8::Local<v8::Object> natives = v8::Object::New(isolate);
  const auto add = [&](const char* name, v8::FunctionCallback callback) {
    natives
        ->CreateDataProperty(
            world, gin::StringToSymbol(isolate, name),
            v8::Function::New(world, callback).ToLocalChecked())
        .Check();
  };
  add("send", &ElectronPreload::Send);
  add("invoke", &ElectronPreload::Invoke);
  add("expose", &ElectronPreload::Expose);
  v8::Local<v8::Value> argv[] = {natives, preload};
  v8::Local<v8::Value> made;
  if (!frame
           .CallFunctionEvenIfScriptDisabled(bootstrap.As<v8::Function>(),
                                             v8::Undefined(isolate),
                                             static_cast<int>(std::size(argv)), argv)
           .ToLocal(&made) ||
      !made->IsObject()) {
    // Only a frame torn down in the middle gets here.
    LOG(ERROR) << "domicile: an Electron window's preload stopped before it "
                  "finished starting.";
    return;
  }
  v8::Local<v8::Object> calls = made.As<v8::Object>();
  v8::Local<v8::Value> deliver;
  v8::Local<v8::Value> settle;
  CHECK(calls->Get(world, gin::StringToSymbol(isolate, "deliver"))
            .ToLocal(&deliver) &&
        deliver->IsFunction());
  CHECK(calls->Get(world, gin::StringToSymbol(isolate, "settle"))
            .ToLocal(&settle) &&
        settle->IsFunction());
  deliver_.Reset(isolate, deliver.As<v8::Function>());
  settle_.Reset(isolate, settle.As<v8::Function>());
}

void ElectronPreload::Call(const v8::Global<v8::Function>& function,
                           int argc,
                           v8::Local<v8::Value> argv[]) {
  blink::WebLocalFrame& frame = *render_frame()->GetWebFrame();
  v8::Isolate* isolate = IsolateOf(frame);
  v8::Local<v8::Context> world =
      frame.GetScriptContextFromWorldId(isolate, kElectronPreloadWorld);
  v8::Context::Scope scope(world);
  // What a listener throws, the bootstrap already reported.
  std::ignore = frame.CallFunctionEvenIfScriptDisabled(
      function.Get(isolate), v8::Undefined(isolate), argc, argv);
}

void ElectronPreload::Answered(uint64_t document,
                               double id,
                               bool ok,
                               const std::string& answer) {
  if (document != document_ || settle_.IsEmpty()) {
    return;
  }
  blink::WebLocalFrame& frame = *render_frame()->GetWebFrame();
  v8::Isolate* isolate = IsolateOf(frame);
  v8::HandleScope handle_scope(isolate);
  v8::Local<v8::Value> argv[] = {v8::Number::New(isolate, id),
                                 v8::Boolean::New(isolate, ok),
                                 gin::StringToV8(isolate, answer)};
  Call(settle_, static_cast<int>(std::size(argv)), argv);
}

// static
ElectronPreload* ElectronPreload::Of(v8::Isolate* isolate) {
  blink::WebLocalFrame* frame =
      blink::WebLocalFrame::FrameForContext(isolate->GetCurrentContext());
  content::RenderFrame* render_frame =
      frame ? content::RenderFrame::FromWebFrame(frame) : nullptr;
  return render_frame ? Get(render_frame) : nullptr;
}

// static
void ElectronPreload::Send(const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  ElectronPreload* self = Of(isolate);
  std::string channel;
  std::string args_json;
  // The bootstrap is the only caller, and it passes two strings.
  CHECK(gin::ConvertFromV8(isolate, info[0], &channel) &&
        gin::ConvertFromV8(isolate, info[1], &args_json));
  if (self == nullptr || !self->host_.is_bound()) {
    isolate->ThrowException(v8::Exception::Error(gin::StringToV8(
        isolate, "this window's app is gone, so ipcRenderer sends nothing")));
    return;
  }
  self->host_->Send(channel, args_json);
}

// static
void ElectronPreload::Invoke(const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  ElectronPreload* self = Of(isolate);
  std::string channel;
  std::string args_json;
  // The bootstrap is the only caller: a number and two strings.
  CHECK(info[0]->IsNumber() && gin::ConvertFromV8(isolate, info[1], &channel) &&
        gin::ConvertFromV8(isolate, info[2], &args_json));
  const double id = info[0].As<v8::Number>()->Value();
  if (self == nullptr || !self->host_.is_bound()) {
    isolate->ThrowException(v8::Exception::Error(gin::StringToV8(
        isolate, "this window's app is gone, so ipcRenderer.invoke fails")));
    return;
  }
  self->host_->Invoke(
      channel, args_json,
      base::BindOnce(&ElectronPreload::Answered,
                     self->weak_factory_.GetWeakPtr(), self->document_, id));
}

// static
void ElectronPreload::Expose(const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  ElectronPreload* self = Of(isolate);
  std::string key;
  CHECK(gin::ConvertFromV8(isolate, info[0], &key));
  if (self == nullptr) {
    return;
  }
  v8::Local<v8::Context> world = isolate->GetCurrentContext();
  v8::Local<v8::Context> page =
      self->render_frame()->GetWebFrame()->MainWorldScriptContext();
  // On failure the exception is pending, for the preload to see.
  std::ignore = ExposeAcrossWorlds(isolate, world, page, key, info[1]);
}

}  // namespace domicile
