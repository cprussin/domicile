// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_PARTITION_H_
#define COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_PARTITION_H_

#include <optional>
#include <string>
#include <string_view>

#include "base/types/expected.h"

namespace domicile {

// The StoragePartitionConfig domain every <webview> partition is in.
inline constexpr char kWebViewPartitionDomain[] = "domicile";

// A <webview>'s own storage partition, named by its `partition` attribute. See
// docs/SHELL-BROWSER-WINDOWS.md.
struct WebViewPartition {
  // Never empty.
  std::string name;
  // Kept on disk across restarts; otherwise in memory until the browser exits.
  bool persist = false;

  friend bool operator==(const WebViewPartition&,
                         const WebViewPartition&) = default;
};

// Reads a `partition` attribute, as Electron does: "persist:<name>" is kept on
// disk, any other name in memory. Empty is the profile's own partition, which
// is nothing. Refuses "persist:" with no name.
base::expected<std::optional<WebViewPartition>, std::string>
ParseWebViewPartition(std::string_view attribute);

// The attribute that names `partition`.
std::string WebViewPartitionAttribute(const WebViewPartition& partition);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_PARTITION_H_
