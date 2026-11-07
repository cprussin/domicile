// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_PAGE_PICKER_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_PAGE_PICKER_H_

#include "base/functional/callback.h"
#include "components/domicile/mojom/web_view_guest.mojom-blink.h"
#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/html/forms/color_chooser.h"
#include "third_party/blink/renderer/core/html/forms/date_time_chooser.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/heap/member.h"
#include "third_party/blink/renderer/platform/mojo/heap_mojo_remote.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

class ColorChooserClient;
class DateTimeChooserClient;
class HTMLInputElement;
class LocalFrame;
struct DateTimeChooserParameters;

// The pickers Chrome draws for a page's form controls, asked of the shell
// instead: the color picker, the date and time pickers, and a text input's
// <datalist>. See PagePicker in components/domicile/mojom/web_view_guest.mojom.
//
// - Each picker binds a pipe of its own; closing it withdraws the shell's.
// - A frame outside every guest has its pipe dropped, which reads as kept.
class CORE_EXPORT DomicilePagePicker
    : public GarbageCollected<DomicilePagePicker> {
 public:
  // Whether `frame`'s pickers are the shell's: every page but the shell's
  // own document, whose controls keep Chrome's.
  static bool IsShellsFor(const LocalFrame* frame);

  explicit DomicilePagePicker(LocalFrame& frame);

  // Asks for `picker`, anchored at `anchor` in the local root's pixels.
  // `answered` gets the picked value, or nothing when kept; it never runs
  // after Close. Once only.
  using Answered = base::OnceCallback<void(bool picked, const String& value)>;
  void Open(domicile::mojom::blink::WebViewPickerPtr picker,
            const gfx::Rect& anchor,
            Answered answered);

  // Withdraws the picker, unanswered.
  void Close();
  bool IsOpen() const { return remote_.is_bound(); }

  void Trace(Visitor*) const;

 private:
  void Done(bool picked, const String& value);

  Member<LocalFrame> frame_;
  HeapMojoRemote<domicile::mojom::blink::PagePicker> remote_;
  Answered answered_;
};

// `<input type="color">`'s chooser.
class DomicileColorChooser final : public GarbageCollected<DomicileColorChooser>,
                                   public ColorChooser {
 public:
  DomicileColorChooser(LocalFrame& frame, ColorChooserClient* client);

  // Asks the shell. Separate from the constructor, which may not hand out
  // `this`.
  void Open();

  // ColorChooser:
  void EndChooser() override;
  AXObject* RootAXObject(Element* popup_owner) override;
  bool IsPickerVisible() const override;

  void Trace(Visitor*) const override;

 private:
  void Answered(bool picked, const String& value);

  Member<ColorChooserClient> client_;
  Member<DomicilePagePicker> picker_;
};

// The date and time inputs' chooser.
class DomicileDateTimeChooser final : public DateTimeChooser {
 public:
  DomicileDateTimeChooser(LocalFrame& frame,
                          DateTimeChooserClient* client,
                          const DateTimeChooserParameters& parameters);

  // As DomicileColorChooser's.
  void Open();

  // DateTimeChooser:
  void EndChooser() override;
  AXObject* RootAXObject(Element* popup_owner) override;
  bool IsPickerVisible() const override;

  void Trace(Visitor*) const override;

 private:
  void Answered(bool picked, const String& value);

  Member<DateTimeChooserClient> client_;
  Member<DomicilePagePicker> picker_;
  domicile::mojom::blink::WebViewPickerKind kind_ =
      domicile::mojom::blink::WebViewPickerKind::kDate;
};

// Opens `input`'s <datalist> as a list the shell draws. Picking an option sets
// the input's value as typing it would, with `input` and `change` events.
// Does nothing for an input with no options.
CORE_EXPORT void OpenDomicileDataList(HTMLInputElement& input);

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_PAGE_PICKER_H_
