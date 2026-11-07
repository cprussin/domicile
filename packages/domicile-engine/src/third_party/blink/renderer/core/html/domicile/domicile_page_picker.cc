// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/domicile_page_picker.h"

#include <utility>

#include "third_party/blink/public/mojom/choosers/color_chooser.mojom-blink.h"
#include "third_party/blink/public/platform/browser_interface_broker_proxy.h"
#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/core/frame/local_frame.h"
#include "third_party/blink/renderer/core/html/forms/color_chooser_client.h"
#include "third_party/blink/renderer/core/html/forms/date_time_chooser_client.h"
#include "third_party/blink/renderer/core/html/forms/html_data_list_element.h"
#include "third_party/blink/renderer/core/html/forms/html_data_list_options_collection.h"
#include "third_party/blink/renderer/core/html/forms/html_input_element.h"
#include "third_party/blink/renderer/core/html/forms/html_option_element.h"
#include "third_party/blink/renderer/core/html/forms/input_type.h"
#include "third_party/blink/renderer/core/html_names.h"
#include "third_party/blink/renderer/core/page/chrome_client.h"
#include "third_party/blink/renderer/core/page/page.h"
#include "third_party/blink/renderer/platform/graphics/color.h"
#include "third_party/blink/renderer/platform/runtime_enabled_features.h"
#include "third_party/blink/renderer/platform/wtf/functional.h"
#include "ui/gfx/geometry/rect_conversions.h"

namespace blink {

namespace {

using Kind = domicile::mojom::blink::WebViewPickerKind;

// Mojo's strings can't be null; an absent attribute or label is empty.
String NotNull(const String& s) {
  return s.IsNull() ? String("") : s;
}

// A picker of `kind` for `input`, with its value and limits.
domicile::mojom::blink::WebViewPickerPtr PickerFor(Kind kind,
                                                  HTMLInputElement& input) {
  auto picker = domicile::mojom::blink::WebViewPicker::New();
  picker->kind = kind;
  picker->value = input.Value();
  picker->min = input.FastGetAttribute(html_names::kMinAttr);
  picker->max = input.FastGetAttribute(html_names::kMaxAttr);
  picker->step = input.FastGetAttribute(html_names::kStepAttr);
  return picker;
}

// Holds `input` while the shell shows its <datalist>. Kept alive by the
// answer's callback alone.
class DataListPicker final : public GarbageCollected<DataListPicker> {
 public:
  explicit DataListPicker(HTMLInputElement& input) : input_(&input) {}

  void Open(domicile::mojom::blink::WebViewPickerPtr picker) {
    picker_ = MakeGarbageCollected<DomicilePagePicker>(
        *input_->GetDocument().GetFrame());
    picker_->Open(std::move(picker), input_->VisibleBoundsInLocalRoot(),
                  BindOnce(&DataListPicker::Answered, WrapPersistent(this)));
  }

  void Trace(Visitor* visitor) const {
    visitor->Trace(input_);
    visitor->Trace(picker_);
  }

 private:
  void Answered(bool picked, const String& value) {
    // As typing it would: the page hears `input` and `change`.
    if (picked && input_->isConnected()) {
      input_->SetValue(value,
                       TextFieldEventBehavior::kDispatchInputAndChangeEvent);
    }
  }

  Member<HTMLInputElement> input_;
  Member<DomicilePagePicker> picker_;
};

}  // namespace

// static
bool DomicilePagePicker::IsShellsFor(const LocalFrame* frame) {
  // The shell's document is the one with <app> and <webview>.
  return frame && frame->DomWindow() &&
         !RuntimeEnabledFeatures::DomicileExternalSurfaceEnabled(
             frame->DomWindow());
}

DomicilePagePicker::DomicilePagePicker(LocalFrame& frame)
    : frame_(&frame), remote_(frame.DomWindow()) {}

void DomicilePagePicker::Open(domicile::mojom::blink::WebViewPickerPtr picker,
                              const gfx::Rect& anchor,
                              Answered answered) {
  answered_ = std::move(answered);
  picker->value = NotNull(picker->value);
  picker->min = NotNull(picker->min);
  picker->max = NotNull(picker->max);
  picker->step = NotNull(picker->step);
  for (auto& option : picker->options) {
    option->value = NotNull(option->value);
    option->label = NotNull(option->label);
  }
  // The local root's pixels are device pixels; the guest's are DIPs.
  const float scale = frame_->GetPage()->GetChromeClient().WindowToViewportScalar(
      frame_.Get(), 1.0f);
  picker->anchor = gfx::ScaleToEnclosingRect(anchor, 1.0f / scale);
  frame_->GetBrowserInterfaceBroker().GetInterface(
      remote_.BindNewPipeAndPassReceiver(
          frame_->DomWindow()->GetTaskRunner(TaskType::kUserInteraction)));
  // A dropped pipe, as outside any guest, is kept.
  remote_.set_disconnect_handler(BindOnce(
      &DomicilePagePicker::Done, WrapWeakPersistent(this), false, String()));
  remote_->Pick(std::move(picker),
                BindOnce(&DomicilePagePicker::Done, WrapWeakPersistent(this)));
}

void DomicilePagePicker::Close() {
  remote_.reset();
  answered_.Reset();
}

void DomicilePagePicker::Done(bool picked, const String& value) {
  if (!remote_.is_bound()) {
    return;
  }
  remote_.reset();
  if (answered_) {
    std::move(answered_).Run(picked, value);
  }
}

void DomicilePagePicker::Trace(Visitor* visitor) const {
  visitor->Trace(frame_);
  visitor->Trace(remote_);
}

DomicileColorChooser::DomicileColorChooser(LocalFrame& frame,
                                           ColorChooserClient* client)
    : client_(client),
      picker_(MakeGarbageCollected<DomicilePagePicker>(frame)) {}

void DomicileColorChooser::Open() {
  auto picker = domicile::mojom::blink::WebViewPicker::New();
  picker->kind = Kind::kColor;
  picker->value = client_->CurrentColor().SerializeAsCanvasColor();
  if (client_->ShouldShowSuggestions()) {
    for (const auto& suggestion : client_->Suggestions()) {
      picker->options.push_back(
          domicile::mojom::blink::WebViewPickerOption::New(
              Color::FromRGBA32(suggestion->color).SerializeAsCanvasColor(),
              suggestion->label));
    }
  }
  picker_->Open(
      std::move(picker), client_->ElementRectRelativeToLocalRoot(),
      BindOnce(&DomicileColorChooser::Answered, WrapWeakPersistent(this)));
}

void DomicileColorChooser::Answered(bool picked, const String& value) {
  if (!client_) {
    return;
  }
  Color color;
  // "#rrggbb"; anything else keeps the old color.
  if (picked && value.starts_with("#") &&
      Color::ParseHexColor(StringView(value, 1), color)) {
    client_->DidChooseColor(color);
  }
  ColorChooserClient* client = client_.Get();
  client_ = nullptr;
  client->DidEndChooser();
}

void DomicileColorChooser::EndChooser() {
  picker_->Close();
  if (client_) {
    ColorChooserClient* client = client_.Get();
    client_ = nullptr;
    client->DidEndChooser();
  }
}

AXObject* DomicileColorChooser::RootAXObject(Element*) {
  return nullptr;
}

bool DomicileColorChooser::IsPickerVisible() const {
  return picker_->IsOpen();
}

void DomicileColorChooser::Trace(Visitor* visitor) const {
  visitor->Trace(client_);
  visitor->Trace(picker_);
  ColorChooser::Trace(visitor);
}

DomicileDateTimeChooser::DomicileDateTimeChooser(
    LocalFrame& frame,
    DateTimeChooserClient* client,
    const DateTimeChooserParameters& parameters)
    : client_(client),
      picker_(MakeGarbageCollected<DomicilePagePicker>(frame)) {
  switch (parameters.type) {
    case InputType::Type::kTime:
      kind_ = Kind::kTime;
      break;
    case InputType::Type::kDateTimeLocal:
      kind_ = Kind::kDateTimeLocal;
      break;
    case InputType::Type::kMonth:
      kind_ = Kind::kMonth;
      break;
    case InputType::Type::kWeek:
      kind_ = Kind::kWeek;
      break;
    default:
      kind_ = Kind::kDate;
      break;
  }
}

void DomicileDateTimeChooser::Open() {
  auto& input = To<HTMLInputElement>(client_->OwnerElement());
  picker_->Open(
      PickerFor(kind_, input), input.VisibleBoundsInLocalRoot(),
      BindOnce(&DomicileDateTimeChooser::Answered, WrapWeakPersistent(this)));
}

void DomicileDateTimeChooser::Answered(bool picked, const String& value) {
  if (!client_) {
    return;
  }
  if (picked) {
    client_->DidChooseValue(value);
  }
  DateTimeChooserClient* client = client_.Get();
  client_ = nullptr;
  client->DidEndChooser();
}

void DomicileDateTimeChooser::EndChooser() {
  picker_->Close();
  if (client_) {
    DateTimeChooserClient* client = client_.Get();
    client_ = nullptr;
    client->DidEndChooser();
  }
}

AXObject* DomicileDateTimeChooser::RootAXObject(Element*) {
  return nullptr;
}

bool DomicileDateTimeChooser::IsPickerVisible() const {
  return picker_->IsOpen();
}

void DomicileDateTimeChooser::Trace(Visitor* visitor) const {
  visitor->Trace(client_);
  visitor->Trace(picker_);
  DateTimeChooser::Trace(visitor);
}

void OpenDomicileDataList(HTMLInputElement& input) {
  HTMLDataListElement* list = input.DataList();
  if (!list || !input.GetDocument().GetFrame()) {
    return;
  }
  auto picker = PickerFor(Kind::kList, input);
  HTMLDataListOptionsCollection* options = list->options();
  for (unsigned i = 0; HTMLOptionElement* option = options->Item(i); ++i) {
    if (option->IsDisabledFormControl() || option->value().empty()) {
      continue;
    }
    picker->options.push_back(domicile::mojom::blink::WebViewPickerOption::New(
        option->value(), option->label() == option->value()
                             ? String(g_empty_string)
                             : option->label()));
  }
  if (picker->options.empty()) {
    return;
  }
  MakeGarbageCollected<DataListPicker>(input)->Open(std::move(picker));
}

}  // namespace blink
