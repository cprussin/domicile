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

// The shell's part of the desk's config: its keybindings, each mode's, and the
// options the config keeps for a shell by name.
//
// Carried as the JSON line the compositor sent rather than as attributes, which
// no other event here does. A shell's options are whatever its config says, and
// WebIDL cannot type a value nobody has declared -- so the page parses `config`
// for itself, and the SDK is where its shape is read. See
// ControlChannelClient::ShellConfig.
//
// Pushed like DomicileThemeEvent: once to a page that has only just connected,
// and again whenever a reload of the compositor's config moved what it carries.
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

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;

 private:
  String config_;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHELL_CONFIG_EVENT_H_
