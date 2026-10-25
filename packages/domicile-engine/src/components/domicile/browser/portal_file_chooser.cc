// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/portal_file_chooser.h"

#include <cstdint>
#include <limits>
#include <utility>

#include "base/atomic_sequence_num.h"
#include "base/functional/bind.h"
#include "base/strings/string_number_conversions.h"
#include "components/dbus/thread_linux/dbus_thread_linux.h"
#include "dbus/bus.h"
#include "dbus/message.h"
#include "dbus/object_path.h"
#include "dbus/object_proxy.h"
#include "net/base/filename_util.h"
#include "url/gurl.h"

namespace domicile {

namespace {

constexpr char kBackend[] = "org.freedesktop.impl.portal.desktop.domicile";
constexpr char kBackendPath[] = "/org/freedesktop/portal/desktop";
constexpr char kInterface[] = "org.freedesktop.impl.portal.FileChooser";
// The backend exports a Request here while it asks.
constexpr char kRequestPrefix[] =
    "/org/freedesktop/portal/desktop/request/domicile/";

void AppendBool(dbus::MessageWriter& options, const char* key, bool value) {
  dbus::MessageWriter entry(nullptr);
  options.OpenDictEntry(&entry);
  entry.AppendString(key);
  entry.AppendVariantOfBool(value);
  options.CloseContainer(&entry);
}

void AppendString(dbus::MessageWriter& options,
                  const char* key,
                  const std::string& value) {
  dbus::MessageWriter entry(nullptr);
  options.OpenDictEntry(&entry);
  entry.AppendString(key);
  entry.AppendVariantOfString(value);
  options.CloseContainer(&entry);
}

// A path as the portal's NUL-terminated byte string.
void AppendPath(dbus::MessageWriter& options,
                const char* key,
                const base::FilePath& path) {
  std::vector<uint8_t> bytes(path.value().begin(), path.value().end());
  bytes.push_back(0);
  dbus::MessageWriter entry(nullptr);
  options.OpenDictEntry(&entry);
  entry.AppendString(key);
  dbus::MessageWriter variant(nullptr);
  entry.OpenVariant("ay", &variant);
  variant.AppendArrayOfBytes(bytes);
  entry.CloseContainer(&variant);
  options.CloseContainer(&entry);
}

// One filter of glob patterns, `a(sa(us))`.
void AppendFilter(dbus::MessageWriter& options,
                  const std::vector<std::string>& extensions) {
  dbus::MessageWriter entry(nullptr);
  options.OpenDictEntry(&entry);
  entry.AppendString("filters");
  dbus::MessageWriter variant(nullptr);
  entry.OpenVariant("a(sa(us))", &variant);
  dbus::MessageWriter filters(nullptr);
  variant.OpenArray("(sa(us))", &filters);
  dbus::MessageWriter filter(nullptr);
  filters.OpenStruct(&filter);
  filter.AppendString("Accepted files");
  dbus::MessageWriter patterns(nullptr);
  filter.OpenArray("(us)", &patterns);
  for (const std::string& extension : extensions) {
    dbus::MessageWriter pattern(nullptr);
    patterns.OpenStruct(&pattern);
    // 0: a glob.
    pattern.AppendUint32(0);
    pattern.AppendString("*." + extension);
    patterns.CloseContainer(&pattern);
  }
  filter.CloseContainer(&patterns);
  filters.CloseContainer(&filter);
  variant.CloseContainer(&filters);
  entry.CloseContainer(&variant);
  options.CloseContainer(&entry);
}

}  // namespace

std::unique_ptr<dbus::MethodCall> PortalFileChooserCall(
    mojom::WebViewFileChooserMode mode,
    const std::vector<std::string>& extensions,
    const base::FilePath& suggested) {
  static base::AtomicSequenceNumber requests;
  const bool save = mode == mojom::WebViewFileChooserMode::kSave;
  auto call = std::make_unique<dbus::MethodCall>(
      kInterface, save ? "SaveFile" : "OpenFile");
  dbus::MessageWriter writer(call.get());
  writer.AppendObjectPath(dbus::ObjectPath(
      kRequestPrefix + base::NumberToString(requests.GetNext())));
  // No app: the desk asks for itself.
  writer.AppendString("");
  writer.AppendString("");
  writer.AppendString(save ? "Save" : "Open");
  dbus::MessageWriter options(nullptr);
  writer.OpenArray("{sv}", &options);
  switch (mode) {
    case mojom::WebViewFileChooserMode::kOpen:
      break;
    case mojom::WebViewFileChooserMode::kOpenMultiple:
      AppendBool(options, "multiple", true);
      break;
    case mojom::WebViewFileChooserMode::kOpenFolder:
      AppendBool(options, "directory", true);
      break;
    case mojom::WebViewFileChooserMode::kSave:
      if (!suggested.BaseName().empty()) {
        AppendString(options, "current_name",
                     suggested.BaseName().AsUTF8Unsafe());
      }
      break;
  }
  if (suggested.IsAbsolute() && !suggested.DirName().empty()) {
    AppendPath(options, "current_folder",
               save ? suggested.DirName() : suggested);
  }
  if (!extensions.empty() &&
      mode != mojom::WebViewFileChooserMode::kOpenFolder) {
    AppendFilter(options, extensions);
  }
  writer.CloseContainer(&options);
  return call;
}

std::optional<std::vector<base::FilePath>> PortalFileChooserPaths(
    dbus::Response* response) {
  if (response == nullptr) {
    return std::nullopt;
  }
  dbus::MessageReader reader(response);
  uint32_t answer = 0;
  dbus::MessageReader results(nullptr);
  // 0 is a choice; 1 a cancel and 2 anything else.
  if (!reader.PopUint32(&answer) || answer != 0 || !reader.PopArray(&results)) {
    return std::nullopt;
  }
  while (results.HasMoreData()) {
    dbus::MessageReader entry(nullptr);
    std::string key;
    if (!results.PopDictEntry(&entry) || !entry.PopString(&key)) {
      return std::nullopt;
    }
    if (key != "uris") {
      continue;
    }
    dbus::MessageReader variant(nullptr);
    std::vector<std::string> uris;
    if (!entry.PopVariant(&variant) || !variant.PopArrayOfStrings(&uris)) {
      return std::nullopt;
    }
    std::vector<base::FilePath> paths;
    for (const std::string& uri : uris) {
      base::FilePath path;
      if (!net::FileURLToFilePath(GURL(uri), &path)) {
        return std::nullopt;
      }
      paths.push_back(path);
    }
    if (paths.empty()) {
      return std::nullopt;
    }
    return paths;
  }
  return std::nullopt;
}

void AskThePortalForFiles(mojom::WebViewFileChooserMode mode,
                          const std::vector<std::string>& extensions,
                          const base::FilePath& suggested,
                          PortalFilesChosen chosen) {
  dbus::ObjectProxy* const backend =
      dbus_thread_linux::GetSharedSessionBus()->GetObjectProxy(
          kBackend, dbus::ObjectPath(kBackendPath));
  std::unique_ptr<dbus::MethodCall> call =
      PortalFileChooserCall(mode, extensions, suggested);
  // The user answers in their own time: libdbus reads INT_MAX as no timeout.
  backend->CallMethod(
      call.get(), std::numeric_limits<int>::max(),
      base::BindOnce(
          [](PortalFilesChosen chosen, dbus::Response* response) {
            std::move(chosen).Run(PortalFileChooserPaths(response));
          },
          std::move(chosen)));
}

}  // namespace domicile
