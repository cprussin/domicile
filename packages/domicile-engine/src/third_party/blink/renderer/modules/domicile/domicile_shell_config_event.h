// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHELL_CONFIG_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHELL_CONFIG_EVENT_H_

#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

class DomicileShellConfigEventInit;

// The shell's part of the desktop config: keybindings per mode, and the
// options set for this shell by name.
//
// Carried as the compositor's JSON line rather than as attributes, because a
// shell's options are arbitrary and WebIDL cannot type them. The SDK parses
// `config`; see ControlChannelClient::ShellConfig.
//
// Pushed to a newly connected page, and again when a config reload changes
// it.
class MODULES_EXPORT DomicileShellConfigEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileShellConfigEvent* Create(
      const AtomicString& type,
      const DomicileShellConfigEventInit* initializer);

  DomicileShellConfigEvent(const AtomicString& type,
                           const DomicileShellConfigEventInit* initializer);
  DomicileShellConfigEvent(const AtomicString& type,
                           const String& config,
                           DOMHighResTimeStamp arrival);
  ~DomicileShellConfigEvent() override;

  const String& config() const { return config_; }

  // When the browser process received this, on `performance.now()`'s clock.
  // See DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;

 private:
  String config_;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHELL_CONFIG_EVENT_H_
