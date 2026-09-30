// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/file_choice.h"

#include "base/files/file_enumerator.h"
#include "base/files/file_util.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "net/base/mime_util.h"

namespace domicile {

std::optional<base::FilePath> ResolvedPath(const base::FilePath& home,
                                           std::string_view path) {
  const base::FilePath named =
      base::FilePath::FromUTF8Unsafe(path).StripTrailingSeparators();
  if (named.ReferencesParent()) {
    return std::nullopt;
  }
  if (named.IsAbsolute()) {
    return named;
  }
  return named.empty() ? home : home.Append(named);
}

std::optional<std::vector<std::string>> DirectoryEntries(
    const base::FilePath& directory) {
  if (!base::DirectoryExists(directory)) {
    return std::nullopt;
  }
  std::vector<std::string> entries;
  // Not SHOW_SYM_LINKS, so a link is what it points at: a link to a directory
  // is one to walk into. STOP_ENUMERATION, so a directory that cannot be read
  // says so rather than listing as empty.
  base::FileEnumerator walk(
      directory, /*recursive=*/false,
      base::FileEnumerator::FILES | base::FileEnumerator::DIRECTORIES,
      base::FilePath::StringType(),
      base::FileEnumerator::FolderSearchPolicy::MATCH_ONLY,
      base::FileEnumerator::ErrorPolicy::STOP_ENUMERATION);
  for (base::FilePath entry = walk.Next(); !entry.empty();
       entry = walk.Next()) {
    const std::string name = entry.BaseName().AsUTF8Unsafe();
    entries.push_back(walk.GetInfo().IsDirectory() ? name + "/" : name);
  }
  if (walk.GetError() != base::File::FILE_OK) {
    return std::nullopt;
  }
  return entries;
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
