// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/context_menu.h"

#include "base/strings/utf_string_conversions.h"
#include "content/public/browser/context_menu_params.h"
#include "third_party/blink/public/common/context_menu_data/edit_flags.h"
#include "third_party/blink/public/mojom/context_menu/context_menu.mojom.h"
#include "ui/gfx/geometry/point.h"

namespace domicile {
namespace {

using blink::mojom::ContextMenuDataMediaType;

// No default arm, so a media type Blink adds fails the build.
mojom::WebViewMediaType AsWebViewMediaType(ContextMenuDataMediaType type) {
  switch (type) {
    case ContextMenuDataMediaType::kNone:
      return mojom::WebViewMediaType::kNone;
    case ContextMenuDataMediaType::kImage:
      return mojom::WebViewMediaType::kImage;
    case ContextMenuDataMediaType::kVideo:
      return mojom::WebViewMediaType::kVideo;
    case ContextMenuDataMediaType::kAudio:
      return mojom::WebViewMediaType::kAudio;
    case ContextMenuDataMediaType::kCanvas:
      return mojom::WebViewMediaType::kCanvas;
    case ContextMenuDataMediaType::kFile:
      return mojom::WebViewMediaType::kFile;
    case ContextMenuDataMediaType::kPlugin:
      return mojom::WebViewMediaType::kPlugin;
  }
}

bool Can(const content::ContextMenuParams& params,
         blink::ContextMenuDataEditFlags flag) {
  return (params.edit_flags & flag) != 0;
}

// An image that loaded, or a canvas.
bool HasPixels(const content::ContextMenuParams& params) {
  return (params.media_type == ContextMenuDataMediaType::kImage ||
          params.media_type == ContextMenuDataMediaType::kCanvas) &&
         params.has_image_contents;
}

// An image, video or audio with an address.
bool HasSource(const content::ContextMenuParams& params) {
  return (params.media_type == ContextMenuDataMediaType::kImage ||
          params.media_type == ContextMenuDataMediaType::kVideo ||
          params.media_type == ContextMenuDataMediaType::kAudio) &&
         params.src_url.is_valid();
}

}  // namespace

mojom::WebViewContextMenuPtr AsWebViewContextMenu(
    int id,
    const content::ContextMenuParams& params,
    const gfx::Point& in_page) {
  auto menu = mojom::WebViewContextMenu::New();
  menu->id = id;
  menu->x = in_page.x();
  menu->y = in_page.y();
  menu->link_url = params.link_url;
  menu->link_text = base::UTF16ToUTF8(params.link_text);
  menu->src_url = params.src_url;
  menu->media_type = AsWebViewMediaType(params.media_type);
  menu->has_image_contents = params.has_image_contents;
  menu->selection_text = base::UTF16ToUTF8(params.selection_text);
  menu->is_editable = params.is_editable;
  menu->can_undo = Can(params, blink::ContextMenuDataEditFlags::kCanUndo);
  menu->can_redo = Can(params, blink::ContextMenuDataEditFlags::kCanRedo);
  menu->can_cut = Can(params, blink::ContextMenuDataEditFlags::kCanCut);
  menu->can_copy = Can(params, blink::ContextMenuDataEditFlags::kCanCopy);
  menu->can_paste = Can(params, blink::ContextMenuDataEditFlags::kCanPaste);
  menu->can_delete = Can(params, blink::ContextMenuDataEditFlags::kCanDelete);
  menu->can_select_all =
      Can(params, blink::ContextMenuDataEditFlags::kCanSelectAll);
  return menu;
}

bool Offers(const content::ContextMenuParams& params,
            mojom::WebViewContextMenuAction action) {
  switch (action) {
    case mojom::WebViewContextMenuAction::kUndo:
    case mojom::WebViewContextMenuAction::kRedo:
    case mojom::WebViewContextMenuAction::kCut:
    case mojom::WebViewContextMenuAction::kCopy:
    case mojom::WebViewContextMenuAction::kPaste:
    case mojom::WebViewContextMenuAction::kPasteAndMatchStyle:
    case mojom::WebViewContextMenuAction::kDelete:
    case mojom::WebViewContextMenuAction::kSelectAll:
    case mojom::WebViewContextMenuAction::kInspect:
      return true;
    case mojom::WebViewContextMenuAction::kCopyLinkAddress:
      return params.unfiltered_link_url.is_valid();
    case mojom::WebViewContextMenuAction::kSaveLinkAs:
      return params.link_url.is_valid();
    case mojom::WebViewContextMenuAction::kCopyImage:
      return HasPixels(params);
    case mojom::WebViewContextMenuAction::kCopyMediaAddress:
      return HasSource(params);
    case mojom::WebViewContextMenuAction::kSaveMediaAs:
      return HasPixels(params) || HasSource(params);
  }
}

}  // namespace domicile
