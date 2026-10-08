// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/command_protocol.h"

#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include "base/check.h"
#include "base/files/file_path.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/values.h"

namespace domicile {
namespace {

// The command names.
constexpr char kLoadShell[] = "load_shell";
constexpr char kOpenUrl[] = "open_url";

std::string Line(base::DictValue reply) {
  std::string line;
  // Replies hold only strings, so a write failure is a bug.
  CHECK(base::JSONWriter::Write(reply, &line));
  line.push_back('\n');
  return line;
}

std::string Done(std::string_view type) {
  base::DictValue reply;
  reply.Set("type", type);
  return Line(std::move(reply));
}

std::string AnswerLoadShell(const base::DictValue& request,
                            LoadShell load_shell);
std::string AnswerOpenUrl(const base::DictValue& request, OpenUrl open_url);

}  // namespace

std::string RefusedCommand(std::string_view why) {
  base::DictValue reply;
  reply.Set("type", "refused");
  reply.Set("why", why);
  return Line(std::move(reply));
}

void AnswerCommand(std::string_view line,
                   LoadShell load_shell,
                   OpenUrl open_url,
                   CommandReply reply) {
  const std::optional<base::DictValue> request =
      base::JSONReader::ReadDict(line, base::JSON_PARSE_RFC);
  if (!request) {
    std::move(reply).Run(RefusedCommand(
        "a command is one JSON object on one line, and this is not one"));
    return;
  }

  // Check the version before `type`: an unknown version means the rest of the
  // request cannot be trusted either.
  const std::optional<int> version = request->FindInt("version");
  if (version != kCommandVersion) {
    std::move(reply).Run(RefusedCommand(base::StrCat(
        {"this engine speaks version ", base::NumberToString(kCommandVersion),
         " of the command protocol and the request says ",
         version ? base::NumberToString(*version) : std::string("nothing"),
         ". The supervisor and the engine are published separately, so this "
         "is two different releases talking rather than a typo: "
         "packages/domicile-engine/engine-release.nix is which engine this "
         "desktop is running."})));
    return;
  }

  const std::string* type = request->FindString("type");
  if (type == nullptr) {
    std::move(reply).Run(RefusedCommand("a command needs a \"type\""));
    return;
  }
  if (*type == kLoadShell) {
    std::move(reply).Run(AnswerLoadShell(*request, load_shell));
    return;
  }
  if (*type == kOpenUrl) {
    std::move(reply).Run(AnswerOpenUrl(*request, open_url));
    return;
  }
  std::move(reply).Run(RefusedCommand(base::StrCat(
      {"\"", *type, "\" is not a command this engine knows; it takes \"",
       kLoadShell, "\" and \"", kOpenUrl, "\""})));
}

namespace {

std::string AnswerLoadShell(const base::DictValue& request,
                            LoadShell load_shell) {
  // Requires both `root` and `module`: changing only one would serve a 404 or
  // the wrong shell.
  const std::string* root = request.FindString("root");
  if (root == nullptr || root->empty()) {
    return RefusedCommand(
        "load_shell needs a \"root\": the directory the shell is served out "
        "of");
  }
  const base::FilePath shell_root = base::FilePath::FromUTF8Unsafe(*root);
  if (!shell_root.IsAbsolute()) {
    return RefusedCommand(base::StrCat(
        {"\"", *root,
         "\" is not an absolute path. The root is resolved in the engine's "
         "process, whose working directory the sender does not know -- a "
         "relative one would serve some other directory without saying so."}));
  }

  const std::string* module = request.FindString("module");
  if (module == nullptr || module->empty()) {
    return RefusedCommand(
        "load_shell needs a \"module\": the one JavaScript file a shell is, "
        "as a name under \"root\"");
  }

  // The root and module are not checked here. `domicile load-shell` validates
  // the path first (`shell_path` in domicile-launch), and the shell document
  // shows an error if the module fails to load.
  if (!load_shell(shell_root, *module)) {
    return RefusedCommand(
        "this engine has no shell window to load a shell into");
  }
  return Done("loaded");
}

std::string AnswerOpenUrl(const base::DictValue& request, OpenUrl open_url) {
  const std::string* url = request.FindString("url");
  if (url == nullptr) {
    return RefusedCommand("open_url needs a \"url\": the address to open");
  }
  // Validated here so an invalid URL is refused instead of opening an empty
  // window and reporting success.
  const GURL parsed(*url);
  if (!parsed.is_valid()) {
    return RefusedCommand(
        base::StrCat({"\"", *url, "\" is not a URL this engine can open"}));
  }
  if (!open_url(parsed)) {
    return RefusedCommand("this engine has no shell page to open it in");
  }
  return Done("opened");
}

}  // namespace
}  // namespace domicile
