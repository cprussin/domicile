// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/command_protocol.h"

#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include "base/check.h"
#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/values.h"

namespace domicile {
namespace {

// The commands there are. No dispatch table: three rows are an `if` each.
constexpr char kLoadShell[] = "load_shell";
constexpr char kOpenUrl[] = "open_url";
constexpr char kScreenshot[] = "screenshot";

std::string Line(base::DictValue reply) {
  std::string line;
  // An unrepresentable reply is this file having built one out of something
  // other than the strings it writes, which is a bug rather than a refusal.
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
void AnswerScreenshot(const base::DictValue& request,
                      Screenshot screenshot,
                      CommandReply reply);

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
                   Screenshot screenshot,
                   CommandReply reply) {
  const std::optional<base::DictValue> request =
      base::JSONReader::ReadDict(line, base::JSON_PARSE_RFC);
  if (!request) {
    std::move(reply).Run(RefusedCommand(
        "a command is one JSON object on one line, and this is not one"));
    return;
  }

  // THE VERSION IS READ FIRST, BEFORE THE COMMAND IT QUALIFIES. It says how
  // the rest of this object is to be read, so a request in a version this
  // engine does not speak is one whose `type` this engine has no business
  // believing either.
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
  if (*type == kScreenshot) {
    AnswerScreenshot(*request, screenshot, std::move(reply));
    return;
  }
  std::move(reply).Run(RefusedCommand(base::StrCat(
      {"\"", *type, "\" is not a command this engine knows; it takes \"",
       kLoadShell, "\", \"", kOpenUrl, "\" and \"", kScreenshot, "\""})));
}

namespace {

std::string AnswerLoadShell(const base::DictValue& request,
                            LoadShell load_shell) {
  // BOTH HALVES OR NEITHER. A shell is one module and the directory it is
  // served out of: a new module name against the old root is a 404 and an old
  // name against a new root is the wrong desktop. `ShellSource::Set` takes the
  // pair for the same reason, and this is where a request that carries one of
  // them stops.
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

  // Nothing here checks that the root exists or that the module is in it, and
  // that is deliberate rather than missing. `domicile load-shell` resolves a
  // path in front of the person who typed it -- `shell_path` in
  // domicile-launch, which has the rules and the tests -- so a typo is
  // answered at the terminal it was made at. Beyond that the document the
  // engine writes reports a module that did not load, on the screen, which is
  // the same failure a shell can reach without this command at all.
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
  // Parsed here rather than by the shell, because a shell handed an address
  // that is not one opens a window with nothing in it, and whoever ran the
  // command is told it worked. `domicile open-url` has already made a path a
  // `file://` URL in front of them; what reaches here unparseable is theirs.
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

void AnswerScreenshot(const base::DictValue& request,
                      Screenshot screenshot,
                      CommandReply reply) {
  const std::string* file = request.FindString("file");
  if (file == nullptr || file->empty()) {
    std::move(reply).Run(RefusedCommand(
        "screenshot needs a \"file\": the path to write the PNG to"));
    return;
  }
  const base::FilePath path = base::FilePath::FromUTF8Unsafe(*file);
  // For load_shell's reason: the engine's working directory is not the
  // sender's.
  if (!path.IsAbsolute()) {
    std::move(reply).Run(RefusedCommand(
        base::StrCat({"\"", *file, "\" is not an absolute path"})));
    return;
  }
  screenshot(
      path, base::BindOnce(
                [](CommandReply reply, base::expected<void, std::string> done) {
                  std::move(reply).Run(done.has_value()
                                           ? Done("captured")
                                           : RefusedCommand(done.error()));
                },
                std::move(reply)));
}

}  // namespace
}  // namespace domicile
