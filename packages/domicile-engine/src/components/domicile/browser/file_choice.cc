// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/file_choice.h"

#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "net/base/mime_util.h"

namespace domicile {

std::optional<base::FilePath> PathInHome(const base::FilePath& home,
                                         std::string_view relative) {
  const base::FilePath path =
      base::FilePath::FromUTF8Unsafe(relative).StripTrailingSeparators();
  if (path.empty() || path.IsAbsolute() || path.ReferencesParent()) {
    return std::nullopt;
  }
  return home.Append(path);
}

bool IsAnswerFor(mojom::WebViewFileChooserMode mode, size_t count) {
  switch (mode) {
    case mojom::WebViewFileChooserMode::kOpen:
    case mojom::WebViewFileChooserMode::kOpenFolder:
    case mojom::WebViewFileChooserMode::kSave:
      return count == 1;
    case mojom::WebViewFileChooserMode::kOpenMultiple:
      return count >= 1;
  }
}

std::vector<std::string> AcceptedExtensions(
    const std::vector<std::u16string>& accept_types) {
  std::vector<std::string> extensions;
  for (const std::u16string& type : accept_types) {
    const std::string lowered = base::ToLowerASCII(base::UTF16ToUTF8(type));
    if (lowered.starts_with('.')) {
      extensions.push_back(lowered.substr(1));
    } else {
      std::vector<base::FilePath::StringType> named;
      net::GetExtensionsForMimeType(lowered, &named);
      extensions.insert(extensions.end(), named.begin(), named.end());
    }
  }
  return extensions;
}

}  // namespace domicile
