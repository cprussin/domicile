// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/renderer/electron_preload.h"

#include <cstdint>
#include <iterator>
#include <optional>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

#include "base/command_line.h"
#include "base/containers/span.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/strings/strcat.h"
#include "base/strings/string_util.h"
#include "base/time/time.h"
#include "base/values.h"
#include "build/build_config.h"
#include "components/domicile/renderer/context_bridge.h"
#include "components/domicile/renderer/electron_node.h"
#include "components/version_info/version_info.h"
#include "content/public/renderer/render_frame.h"
#include "gin/converter.h"
#include "mojo/public/cpp/bindings/callback_helpers.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "third_party/blink/public/mojom/script/script_evaluation_params.mojom-shared.h"
#include "third_party/blink/public/platform/scheduler/web_agent_group_scheduler.h"
#include "third_party/blink/public/platform/web_isolated_world_info.h"
#include "third_party/blink/public/platform/web_string.h"
#include "third_party/blink/public/platform/web_url.h"
#include "third_party/blink/public/web/web_console_message.h"
#include "third_party/blink/public/web/web_css_origin.h"
#include "third_party/blink/public/web/web_document.h"
#include "third_party/blink/public/web/web_frame_widget.h"
#include "third_party/blink/public/web/web_local_frame.h"
#include "third_party/blink/public/web/web_script_execution_callback.h"
#include "third_party/blink/public/web/web_script_source.h"
#include "url/gurl.h"
#include "v8/include/v8-container.h"
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

// process.arch, in Node's names.
#if defined(ARCH_CPU_X86_64)
constexpr char kArch[] = "x64";
#elif defined(ARCH_CPU_ARM64)
constexpr char kArch[] = "arm64";
#elif defined(ARCH_CPU_X86)
constexpr char kArch[] = "ia32";
#elif defined(ARCH_CPU_ARMEL)
constexpr char kArch[] = "arm";
#else
#error "an Electron preload's process.arch needs Node's name for this CPU"
#endif

// webFrame.routingId: each Electron page's frame in a renderer has its own.
int NextRoutingId() {
  static int next = 1;
  return next++;
}

// Run in the preload's world with the natives and the preload, as a function
// of Node's module arguments, or null when Node loads the preload, and what
// the renderer knows of itself and its frame (Facts in Run). Gives back
// the functions the browser's messages call, and `electron` for Node's
// require. Everything Electron-shaped lives here; the natives only move
// strings and values.
constexpr char kBootstrap[] = R"JS(
(function (native, preload, contextIsolated, facts) {
  'use strict';
  const listeners = new Map();
  const answers = new Map();
  let nextInvoke = 1;
  // An error in a listener or the preload reaches the console, as an uncaught
  // one, and stops nothing else.
  const report = (error) => queueMicrotask(() => { throw error; });
  const listen = (channel, listener, once, first = false) => {
    if (typeof listener !== 'function') {
      throw new TypeError('an ipcRenderer listener must be a function');
    }
    const key = String(channel);
    const list = listeners.get(key) ?? [];
    if (first) list.unshift({ listener, once });
    else list.push({ listener, once });
    listeners.set(key, list);
  };
  // Runs `channel`'s listeners with `args` as given, as Node's
  // EventEmitter.emit does. Says whether any listened.
  const run = (channel, args) => {
    const list = listeners.get(channel);
    if (!list) return false;
    for (const entry of [...list]) {
      if (entry.once) ipcRenderer.removeListener(channel, entry.listener);
      try {
        entry.listener(...args);
      } catch (error) {
        report(error);
      }
    }
    return true;
  };
  const unsupported = (what) => () => {
    throw new Error(`${what} does not work on Domicile yet`);
  };
  // Each port the app holds an end of, by name, with this world's end of the
  // pipe to it: what arrives there goes to the app, and the app's to it.
  const ports = new Map();
  let nextPort = 1;
  const relay = (name, port) => {
    ports.set(name, port);
    port.onmessage = (event) => {
      native.portPost(name, JSON.stringify(event.data) ?? 'null');
    };
    port.addEventListener('close', () => {
      if (ports.get(name) === port) {
        ports.delete(name);
        native.portClose(name);
      }
    });
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
    prependListener(channel, listener) {
      listen(channel, listener, false, true);
      return ipcRenderer;
    },
    prependOnceListener(channel, listener) {
      listen(channel, listener, true, true);
      return ipcRenderer;
    },
    // ipcRenderer is an EventEmitter: a preload may emit on it to reach its
    // own listeners, which nothing sends to the main process.
    emit(channel, ...args) {
      return run(String(channel), args);
    },
    listeners(channel) {
      return (listeners.get(String(channel)) ?? []).map(
          (entry) => entry.listener);
    },
    rawListeners(channel) {
      return ipcRenderer.listeners(channel);
    },
    eventNames() {
      return [...listeners.keys()];
    },
    setMaxListeners() {
      return ipcRenderer;
    },
    getMaxListeners() {
      return 0;
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
    sendSync(channel, ...args) {
      return JSON.parse(native.sendSync(String(channel), JSON.stringify(args)));
    },
    postMessage(channel, message, transfer = []) {
      const names = [];
      for (const port of transfer) {
        if (!(port instanceof MessagePort)) {
          throw new TypeError('ipcRenderer.postMessage transfers only ' +
                              'MessagePorts');
        }
      }
      for (const port of transfer) {
        const name = `r${nextPort++}`;
        relay(name, port);
        names.push(name);
      }
      native.post(String(channel), JSON.stringify(message) ?? 'null', names);
    },
    sendToHost: unsupported('ipcRenderer.sendToHost'),
  };
  ipcRenderer.addListener = ipcRenderer.on;
  ipcRenderer.off = ipcRenderer.removeListener;
  const contextBridge = {
    exposeInMainWorld(key, api) {
      if (!contextIsolated) {
        throw new Error('contextBridge API can only be used when ' +
                        'contextIsolation is enabled');
      }
      native.expose(String(key), api);
    },
    exposeInIsolatedWorld: unsupported('contextBridge.exposeInIsolatedWorld'),
    executeInMainWorld: unsupported('contextBridge.executeInMainWorld'),
  };
  // Electron's webFrame for this frame, the window's main frame: the only
  // frame a preload runs in on Domicile, so it is its own top.
  const inserted = new Map();
  const webFrame = {
    routingId: facts.routingId,
    frameToken: facts.frameToken,
    parent: null,
    opener: null,
    firstChild: null,
    nextSibling: null,
    insertCSS(css, options = {}) {
      const origin = options?.cssOrigin ?? 'author';
      if (origin !== 'author' && origin !== 'user') {
        throw new TypeError(
            "webFrame.insertCSS's cssOrigin must be 'author' or 'user'");
      }
      const key = native.insertCSS(String(css), origin === 'user');
      inserted.set(key, origin === 'user');
      return key;
    },
    removeInsertedCSS(key) {
      const user = inserted.get(String(key));
      if (user === undefined) return;
      inserted.delete(String(key));
      native.removeInsertedCSS(String(key), user);
    },
    // The page's zoom, which Chromium folds into its devicePixelRatio over
    // the screen's own scale.
    getZoomFactor() {
      return globalThis.devicePixelRatio / native.deviceScale();
    },
    getZoomLevel() {
      // Chromium's zoom levels: each one is 1.2 times the last.
      return Math.log(webFrame.getZoomFactor()) / Math.log(1.2);
    },
    findFrameByRoutingId(id) {
      return id === webFrame.routingId ? webFrame : null;
    },
    findFrameByToken(token) {
      return token === webFrame.frameToken ? webFrame : null;
    },
    setZoomFactor: unsupported('webFrame.setZoomFactor'),
    setZoomLevel: unsupported('webFrame.setZoomLevel'),
    setVisualZoomLevelLimits: unsupported('webFrame.setVisualZoomLevelLimits'),
    setSpellCheckProvider: unsupported('webFrame.setSpellCheckProvider'),
    isWordMisspelled: unsupported('webFrame.isWordMisspelled'),
    getWordSuggestions: unsupported('webFrame.getWordSuggestions'),
    executeJavaScript: unsupported('webFrame.executeJavaScript'),
    executeJavaScriptInIsolatedWorld:
        unsupported('webFrame.executeJavaScriptInIsolatedWorld'),
    setIsolatedWorldInfo: unsupported('webFrame.setIsolatedWorldInfo'),
    getResourceUsage: unsupported('webFrame.getResourceUsage'),
    clearCache: unsupported('webFrame.clearCache'),
    getFrameForSelector: unsupported('webFrame.getFrameForSelector'),
    findFrameByName: unsupported('webFrame.findFrameByName'),
  };
  webFrame.top = webFrame;
  const webUtils = {
    getPathForFile: unsupported('webUtils.getPathForFile'),
  };
  // What a crash report would carry. Domicile sends none, so these are only
  // the app's to read back.
  const crashParameters = new Map();
  const crashReporter = {
    addExtraParameter(key, value) {
      crashParameters.set(String(key), String(value));
    },
    removeExtraParameter(key) {
      crashParameters.delete(String(key));
    },
    getParameters() {
      return Object.fromEntries(crashParameters);
    },
  };
  const nativeImage = {
    createEmpty: unsupported('nativeImage.createEmpty'),
    createFromPath: unsupported('nativeImage.createFromPath'),
    createFromBitmap: unsupported('nativeImage.createFromBitmap'),
    createFromBuffer: unsupported('nativeImage.createFromBuffer'),
    createFromDataURL: unsupported('nativeImage.createFromDataURL'),
    createFromNamedImage: unsupported('nativeImage.createFromNamedImage'),
    createThumbnailFromPath: unsupported('nativeImage.createThumbnailFromPath'),
  };
  // A sandboxed preload's electron module, as Electron's has it.
  const electron = Object.freeze({
    contextBridge,
    crashReporter,
    ipcRenderer,
    nativeImage,
    webFrame,
    webUtils,
  });
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
    // A preload runs only in a window's main frame on Domicile. Claude's
    // preloads set up nothing of theirs without this.
    isMainFrame: true,
    env: {},
    // The renderer's program, then what the window asked for: an app looks
    // there for the switches it gave webPreferences.additionalArguments.
    argv: [...facts.argv],
    execPath: facts.argv[0],
    arch: facts.arch,
    versions: { chrome: facts.chromeVersion },
  };
  const module = { exports: {} };
  if (preload !== null) {
    try {
      preload.call(globalThis, require, process, module, module.exports,
                   globalThis);
    } catch (error) {
      report(error);
    }
  }
  const emit = (channel, event, args) => {
    run(channel, [event, ...args]);
  };
  return {
    electron,
    deliver(channel, json) {
      emit(channel, { sender: ipcRenderer, senderId: 0, ports: [] },
           JSON.parse(json));
    },
    deliverPost(channel, json, joined) {
      const names = joined === '' ? [] : joined.split(',');
      const given = names.map((name) => {
        const pipe = new MessageChannel();
        relay(name, pipe.port1);
        return pipe.port2;
      });
      emit(channel, { sender: ipcRenderer, senderId: 0, ports: given },
           [JSON.parse(json)]);
    },
    toPort(name, json) {
      ports.get(name)?.postMessage(JSON.parse(json));
    },
    closePort(name) {
      const port = ports.get(name);
      if (port) {
        ports.delete(name);
        port.close();
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
      content::RenderFrameObserverTracker<ElectronPreload>(frame),
      routing_id_(NextRoutingId()) {
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
  bootstrap_.Reset();
  host_.reset();
  to_run_.reset();
  if (next_.has_value()) {
    host_.Bind(std::move(next_->host));
    to_run_ = std::move(next_->preload);
    next_.reset();
  }
}

// static
bool ElectronPreload::RunAtDocumentStart(content::RenderFrame* frame) {
  ElectronPreload* self = Get(frame);
  if (!self || !self->to_run_.has_value()) {
    return true;
  }
  ToRun preload = std::move(*self->to_run_);
  self->to_run_.reset();
  return self->Run(std::move(preload));
}

void ElectronPreload::WillReleaseScriptContext(v8::Local<v8::Context> context,
                                               int32_t world_id) {
  // Node ends with its document, while its context is still whole.
  if (node_ && node_->RunsIn(context)) {
    node_.reset();
  }
}

void ElectronPreload::OnDestruct() {
  delete this;
}

void ElectronPreload::Preload(
    const std::string& source,
    const std::vector<std::string>& arguments,
    mojom::ElectronNodePtr node,
    mojo::PendingAssociatedRemote<mojom::ElectronFrameHost> host) {
  next_ = Next{.preload = {.source = source,
                           .arguments = arguments,
                           .node = std::move(node)},
               .host = std::move(host)};
}

void ElectronPreload::Deliver(const std::string& channel,
                              const std::string& args_json) {
  if (bootstrap_.IsEmpty()) {
    // No preload ran in this document, so nothing listens.
    return;
  }
  v8::Isolate* isolate = IsolateOf(*render_frame()->GetWebFrame());
  v8::HandleScope handle_scope(isolate);
  v8::Local<v8::Value> argv[] = {gin::StringToV8(isolate, channel),
                                 gin::StringToV8(isolate, args_json)};
  Call("deliver", argv);
}

void ElectronPreload::DeliverPost(const std::string& channel,
                                  const std::string& message_json,
                                  const std::vector<std::string>& ports) {
  if (bootstrap_.IsEmpty()) {
    return;
  }
  v8::Isolate* isolate = IsolateOf(*render_frame()->GetWebFrame());
  v8::HandleScope handle_scope(isolate);
  v8::Local<v8::Value> argv[] = {
      gin::StringToV8(isolate, channel), gin::StringToV8(isolate, message_json),
      // Port names are letters and digits, so a
      // comma joins them, without a context.
      gin::StringToV8(isolate, base::JoinString(ports, ","))};
  Call("deliverPost", argv);
}

void ElectronPreload::DeliverToPort(const std::string& port,
                                    const std::string& data_json) {
  if (bootstrap_.IsEmpty()) {
    return;
  }
  v8::Isolate* isolate = IsolateOf(*render_frame()->GetWebFrame());
  v8::HandleScope handle_scope(isolate);
  v8::Local<v8::Value> argv[] = {gin::StringToV8(isolate, port),
                                 gin::StringToV8(isolate, data_json)};
  Call("toPort", argv);
}

void ElectronPreload::ClosePort(const std::string& port) {
  if (bootstrap_.IsEmpty()) {
    return;
  }
  v8::Isolate* isolate = IsolateOf(*render_frame()->GetWebFrame());
  v8::HandleScope handle_scope(isolate);
  v8::Local<v8::Value> argv[] = {gin::StringToV8(isolate, port)};
  Call("closePort", argv);
}

void ElectronPreload::ExecuteJavaScript(const std::string& code,
                                        bool user_gesture,
                                        ExecuteJavaScriptCallback callback) {
  // In the page's own world, as Electron runs it, with a promise awaited.
  // Blink drops the callback when the document goes first; the app hears
  // no result then, rather than waiting forever.
  const blink::WebScriptSource source(blink::WebString::FromUtf8(code));
  render_frame()->GetWebFrame()->RequestExecuteScript(
      blink::kMainDOMWorldId, base::span_from_ref(source),
      user_gesture ? blink::mojom::UserActivationOption::kActivate
                   : blink::mojom::UserActivationOption::kDoNotActivate,
      blink::mojom::EvaluationTiming::kAsynchronous,
      blink::mojom::LoadEventBlockingOption::kDoNotBlock,
      base::BindOnce(
          [](ExecuteJavaScriptCallback callback,
             std::optional<base::Value> result,
             base::TimeTicks) { std::move(callback).Run(std::move(result)); },
          mojo::WrapCallbackWithDefaultInvokeIfNotRun(
              std::move(callback), std::optional<base::Value>())),
      blink::BackForwardCacheAware::kAllow,
      blink::mojom::WantResultOption::kWantResult,
      blink::mojom::PromiseResultOption::kAwait, blink::WebString());
}

v8::Local<v8::Context> ElectronPreload::WorldContext(v8::Isolate* isolate) {
  blink::WebLocalFrame& frame = *render_frame()->GetWebFrame();
  return world_ == blink::kMainDOMWorldId
             ? frame.MainWorldScriptContext()
             : frame.GetScriptContextFromWorldId(isolate, world_);
}

bool ElectronPreload::Run(ToRun to_run) {
  blink::WebLocalFrame& frame = *render_frame()->GetWebFrame();
  v8::Isolate* isolate = IsolateOf(frame);
  v8::HandleScope handle_scope(isolate);
  const bool isolated = !to_run.node || to_run.node->context_isolation;
  world_ = isolated ? kElectronPreloadWorld : blink::kMainDOMWorldId;
  // Runs `source` in the preload's world.
  const auto execute = [&](const std::string& source, const char* url) {
    const blink::WebScriptSource script(blink::WebString::FromUtf8(source),
                                        GURL(url));
    return isolated ? frame.ExecuteScriptInIsolatedWorldAndReturnValue(
                          kElectronPreloadWorld, script,
                          blink::BackForwardCacheAware::kAllow)
                    : frame.ExecuteScriptAndReturnValue(script);
  };
  v8::Local<v8::Value> bootstrap =
      execute(kBootstrap, "domicile-electron:///bootstrap.js");
  // The bootstrap is ours, so its failing is the engine's bug.
  CHECK(!bootstrap.IsEmpty() && bootstrap->IsFunction())
      << "domicile: the Electron preload's bootstrap did not compile";
  // With Node, Node's require loads the preload from its file.
  v8::Local<v8::Value> preload = v8::Null(isolate);
  if (!to_run.node) {
    preload =
        execute(Wrapped(to_run.source), "domicile-electron:///preload.js");
  }
  if (!to_run.node && (preload.IsEmpty() || !preload->IsFunction())) {
    // The app's bug. Blink already put the syntax error on the console.
    LOG(ERROR) << "domicile: an Electron window's preload did not compile; "
                  "the page runs without it.";
    frame.AddMessageToConsole(blink::WebConsoleMessage(
        blink::mojom::ConsoleMessageLevel::kError,
        blink::WebString::FromUtf8(
            "Unable to load preload script: it did not compile.")));
    return true;
  }
  v8::Local<v8::Context> world = WorldContext(isolate);
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
  add("sendSync", &ElectronPreload::SendSync);
  add("post", &ElectronPreload::Post);
  add("portPost", &ElectronPreload::PortPost);
  add("portClose", &ElectronPreload::PortClose);
  add("insertCSS", &ElectronPreload::InsertCss);
  add("removeInsertedCSS", &ElectronPreload::RemoveInsertedCss);
  add("deviceScale", &ElectronPreload::DeviceScale);
  // What the renderer knows of itself and this frame, for process and
  // webFrame.
  v8::Local<v8::Object> facts = v8::Object::New(isolate);
  const auto fact = [&](const char* name, v8::Local<v8::Value> value) {
    facts->CreateDataProperty(world, gin::StringToSymbol(isolate, name), value)
        .Check();
  };
  std::vector<v8::Local<v8::Value>> process_argv = {gin::StringToV8(
      isolate, base::CommandLine::ForCurrentProcess()->GetProgram().value())};
  for (const std::string& argument : to_run.arguments) {
    process_argv.push_back(gin::StringToV8(isolate, argument));
  }
  fact("argv",
       v8::Array::New(isolate, process_argv.data(), process_argv.size()));
  fact("arch", gin::StringToV8(isolate, kArch));
  fact("chromeVersion",
       gin::StringToV8(isolate, std::string(version_info::GetVersionNumber())));
  fact("frameToken",
       gin::StringToV8(isolate, frame.GetLocalFrameToken().ToString()));
  fact("routingId", v8::Integer::New(isolate, routing_id_));
  v8::Local<v8::Value> argv[] = {natives, preload,
                                 v8::Boolean::New(isolate, isolated), facts};
  v8::Local<v8::Value> made;
  // The preload is the app's script, and may end the frame, this with it.
  base::WeakPtr<ElectronPreload> alive = weak_factory_.GetWeakPtr();
  const bool ran = frame
                       .CallFunctionEvenIfScriptDisabled(
                           bootstrap.As<v8::Function>(), v8::Undefined(isolate),
                           static_cast<int>(std::size(argv)), argv)
                       .ToLocal(&made);
  if (!alive) {
    return false;
  }
  if (!ran || !made->IsObject()) {
    // Only a frame torn down in the middle gets here.
    LOG(ERROR) << "domicile: an Electron window's preload stopped before it "
                  "finished starting.";
    return true;
  }
  v8::Local<v8::Object> calls = made.As<v8::Object>();
  // The bootstrap is ours, so a call missing from it is the engine's bug.
  for (const char* name :
       {"deliver", "deliverPost", "toPort", "closePort", "settle"}) {
    v8::Local<v8::Value> call;
    CHECK(
        calls->Get(world, gin::StringToSymbol(isolate, name)).ToLocal(&call) &&
        call->IsFunction())
        << "domicile: the Electron preload's bootstrap has no " << name;
  }
  bootstrap_.Reset(isolate, calls);
  if (to_run.node) {
    v8::Local<v8::Value> electron;
    CHECK(calls->Get(world, gin::StringToSymbol(isolate, "electron"))
              .ToLocal(&electron) &&
          electron->IsObject())
        << "domicile: the Electron preload's bootstrap has no electron";
    // Node runs the app's preload, which may end the frame, this with it.
    std::unique_ptr<ElectronNodeEnvironment> node =
        ElectronNodeEnvironment::Start(isolate, world, *to_run.node,
                                       to_run.arguments,
                                       electron.As<v8::Object>());
    if (!alive) {
      return false;
    }
    node_ = std::move(node);
  }
  return true;
}

void ElectronPreload::Call(const char* name,
                           base::span<v8::Local<v8::Value>> argv) {
  blink::WebLocalFrame& frame = *render_frame()->GetWebFrame();
  v8::Isolate* isolate = IsolateOf(frame);
  v8::Local<v8::Context> world = WorldContext(isolate);
  v8::Context::Scope scope(world);
  v8::Local<v8::Value> function =
      bootstrap_.Get(isolate)
          ->Get(world, gin::StringToSymbol(isolate, name))
          .ToLocalChecked();
  // What a listener throws, the bootstrap already reported.
  std::ignore = frame.CallFunctionEvenIfScriptDisabled(
      function.As<v8::Function>(), v8::Undefined(isolate),
      static_cast<int>(argv.size()), argv.data());
}

void ElectronPreload::Answered(uint64_t document,
                               double id,
                               bool ok,
                               const std::string& answer) {
  if (document != document_ || bootstrap_.IsEmpty()) {
    return;
  }
  blink::WebLocalFrame& frame = *render_frame()->GetWebFrame();
  v8::Isolate* isolate = IsolateOf(frame);
  v8::HandleScope handle_scope(isolate);
  v8::Local<v8::Value> argv[] = {v8::Number::New(isolate, id),
                                 v8::Boolean::New(isolate, ok),
                                 gin::StringToV8(isolate, answer)};
  Call("settle", argv);
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
void ElectronPreload::SendSync(
    const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  ElectronPreload* self = Of(isolate);
  std::string channel;
  std::string args_json;
  CHECK(gin::ConvertFromV8(isolate, info[0], &channel) &&
        gin::ConvertFromV8(isolate, info[1], &args_json));
  bool ok = false;
  std::string answer;
  if (self == nullptr || !self->host_.is_bound() ||
      !self->host_->SendSync(channel, args_json, &ok, &answer)) {
    answer = "this window's app is gone";
  }
  if (!ok) {
    isolate->ThrowException(v8::Exception::Error(gin::StringToV8(
        isolate, base::StrCat({"Error sending synchronous message '", channel,
                               "': ", answer}))));
    return;
  }
  info.GetReturnValue().Set(gin::StringToV8(isolate, answer));
}

// static
void ElectronPreload::Post(const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  ElectronPreload* self = Of(isolate);
  std::string channel;
  std::string message_json;
  std::vector<std::string> ports;
  // The bootstrap is the only caller: two strings and the ports' names.
  CHECK(gin::ConvertFromV8(isolate, info[0], &channel) &&
        gin::ConvertFromV8(isolate, info[1], &message_json) &&
        gin::ConvertFromV8(isolate, info[2], &ports));
  if (self == nullptr || !self->host_.is_bound()) {
    isolate->ThrowException(v8::Exception::Error(gin::StringToV8(
        isolate, "this window's app is gone, so ipcRenderer sends nothing")));
    return;
  }
  self->host_->Post(channel, message_json, ports);
}

// static
void ElectronPreload::PortPost(
    const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  ElectronPreload* self = Of(isolate);
  std::string port;
  std::string data_json;
  CHECK(gin::ConvertFromV8(isolate, info[0], &port) &&
        gin::ConvertFromV8(isolate, info[1], &data_json));
  // A port whose app is gone takes messages nowhere, as a closed one does.
  if (self != nullptr && self->host_.is_bound()) {
    self->host_->PostToPort(port, data_json);
  }
}

// static
void ElectronPreload::PortClose(
    const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  ElectronPreload* self = Of(isolate);
  std::string port;
  CHECK(gin::ConvertFromV8(isolate, info[0], &port));
  if (self != nullptr && self->host_.is_bound()) {
    self->host_->PortClosed(port);
  }
}

// static
void ElectronPreload::InsertCss(
    const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  ElectronPreload* self = Of(isolate);
  std::string css;
  // The bootstrap is the only caller: the CSS, and whether it is the user's.
  CHECK(gin::ConvertFromV8(isolate, info[0], &css) && info[1]->IsBoolean());
  if (self == nullptr) {
    isolate->ThrowException(v8::Exception::Error(gin::StringToV8(
        isolate, "this window's page is gone, so webFrame.insertCSS fails")));
    return;
  }
  const blink::WebStyleSheetKey key =
      self->render_frame()->GetWebFrame()->GetDocument().InsertStyleSheet(
          blink::WebString::FromUtf8(css), /*key=*/nullptr,
          info[1].As<v8::Boolean>()->Value() ? blink::WebCssOrigin::kUser
                                             : blink::WebCssOrigin::kAuthor);
  info.GetReturnValue().Set(gin::StringToV8(isolate, key.Utf8()));
}

// static
void ElectronPreload::RemoveInsertedCss(
    const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  ElectronPreload* self = Of(isolate);
  std::string key;
  CHECK(gin::ConvertFromV8(isolate, info[0], &key) && info[1]->IsBoolean());
  // A page that went took its style sheets with it.
  if (self == nullptr) {
    return;
  }
  self->render_frame()->GetWebFrame()->GetDocument().RemoveInsertedStyleSheet(
      blink::WebString::FromUtf8(key), info[1].As<v8::Boolean>()->Value()
                                           ? blink::WebCssOrigin::kUser
                                           : blink::WebCssOrigin::kAuthor);
}

// static
void ElectronPreload::DeviceScale(
    const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::Isolate* isolate = info.GetIsolate();
  ElectronPreload* self = Of(isolate);
  blink::WebFrameWidget* widget =
      self ? self->render_frame()->GetWebFrame()->FrameWidget() : nullptr;
  if (widget == nullptr) {
    isolate->ThrowException(v8::Exception::Error(gin::StringToV8(
        isolate, "this window's page is gone, so it has no zoom")));
    return;
  }
  info.GetReturnValue().Set(
      v8::Number::New(isolate, widget->GetOriginalDeviceScaleFactor()));
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
