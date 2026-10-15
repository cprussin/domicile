// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_WINDOW_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_WINDOW_H_

#include <optional>

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_cursor_shape.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// What the compositor has said about one window, which DomicileHost edits as
// messages arrive and copies into a DomicileWindow each time `windows` is
// rebuilt.
struct DomicileWindowState {
  String app_id;
  String title = g_empty_string;
  String desktop_id = g_empty_string;
  // Null for a popup, or a window the compositor named no owner for.
  std::optional<int32_t> pid;
  std::optional<uint32_t> uid;
  std::optional<uint32_t> gid;
  std::optional<uint64_t> pidfd_inode;
  std::optional<bool> sandboxed;
  // Null where the sandbox engine said nothing, or for no sandbox.
  String sandbox_engine;
  String sandbox_app_id;
  String sandbox_instance_id;
  std::optional<double> width;
  std::optional<double> height;
  std::optional<double> min_width;
  std::optional<double> min_height;
  std::optional<double> max_width;
  std::optional<double> max_height;
  bool dialog = false;
  bool client_frame = false;
  // The synced frame `<app frame>` shows. See
  // docs/architecture/WINDOW-COMPOSITING.md#synced-frames in the Domicile
  // repository.
  uint32_t frame = 0;
  // Null for no parent.
  String transient_for;
  bool urgent = false;
  bool inhibits_shortcuts = false;
  V8DomicileCursorShape cursor =
      V8DomicileCursorShape(V8DomicileCursorShape::Enum::kDefault);
  // Null for a toplevel.
  String parent;
  std::optional<double> x;
  std::optional<double> y;
  bool grab = false;
};

class MODULES_EXPORT DomicileWindow final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  explicit DomicileWindow(const DomicileWindowState& state);
  ~DomicileWindow() override;

  const String& appId() const { return state_.app_id; }
  const String& title() const { return state_.title; }
  const String& desktopId() const { return state_.desktop_id; }
  std::optional<int32_t> pid() const { return state_.pid; }
  std::optional<uint32_t> uid() const { return state_.uid; }
  std::optional<uint32_t> gid() const { return state_.gid; }
  std::optional<uint64_t> pidfdInode() const { return state_.pidfd_inode; }
  std::optional<bool> sandboxed() const { return state_.sandboxed; }
  const String& sandboxEngine() const { return state_.sandbox_engine; }
  const String& sandboxAppId() const { return state_.sandbox_app_id; }
  const String& sandboxInstanceId() const {
    return state_.sandbox_instance_id;
  }
  std::optional<double> width() const { return state_.width; }
  std::optional<double> height() const { return state_.height; }
  std::optional<double> minWidth() const { return state_.min_width; }
  std::optional<double> minHeight() const { return state_.min_height; }
  std::optional<double> maxWidth() const { return state_.max_width; }
  std::optional<double> maxHeight() const { return state_.max_height; }
  bool dialog() const { return state_.dialog; }
  bool clientFrame() const { return state_.client_frame; }
  uint32_t frame() const { return state_.frame; }
  const String& transientFor() const { return state_.transient_for; }
  bool urgent() const { return state_.urgent; }
  bool inhibitsShortcuts() const { return state_.inhibits_shortcuts; }
  V8DomicileCursorShape cursor() const { return state_.cursor; }
  const String& parent() const { return state_.parent; }
  std::optional<double> x() const { return state_.x; }
  std::optional<double> y() const { return state_.y; }
  bool grab() const { return state_.grab; }

  void Trace(Visitor*) const override;

 private:
  const DomicileWindowState state_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_WINDOW_H_
