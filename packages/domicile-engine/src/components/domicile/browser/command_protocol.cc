// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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

// The one command there is. A second would be another `if` here and another
// file beside this one; there is no dispatch table, because a table with one
// row is a table nobody can read the shape of.
constexpr char kLoadShell[] = "load_shell";

std::string Line(base::DictValue reply) {
  std::string line;
  // An unrepresentable reply is this file having built one out of something
  // other than the strings it writes, which is a bug rather than a refusal.
  CHECK(base::JSONWriter::Write(reply, &line));
  line.push_back('\n');
  return line;
}

std::string Loaded() {
  base::DictValue reply;
  reply.Set("type", "loaded");
  return Line(std::move(reply));
}

}  // namespace

std::string RefusedCommand(std::string_view why) {
  base::DictValue reply;
  reply.Set("type", "refused");
  reply.Set("why", why);
  return Line(std::move(reply));
}

std::string AnswerCommand(std::string_view line, LoadShell load_shell) {
  const std::optional<base::DictValue> request =
      base::JSONReader::ReadDict(line, base::JSON_PARSE_RFC);
  if (!request) {
    return RefusedCommand(
        "a command is one JSON object on one line, and this is not one");
  }

  // THE VERSION IS READ FIRST, BEFORE THE COMMAND IT QUALIFIES. It says how
  // the rest of this object is to be read, so a request in a version this
  // engine does not speak is one whose `type` this engine has no business
  // believing either.
  const std::optional<int> version = request->FindInt("version");
  if (version != kCommandVersion) {
    return RefusedCommand(base::StrCat(
        {"this engine speaks version ", base::NumberToString(kCommandVersion),
         " of the command protocol and the request says ",
         version ? base::NumberToString(*version) : std::string("nothing"),
         ". The supervisor and the engine are published separately, so this "
         "is two different releases talking rather than a typo: "
         "packages/domicile-engine/engine-release.nix is which engine this "
         "desktop is running."}));
  }

  const std::string* type = request->FindString("type");
  if (type == nullptr) {
    return RefusedCommand("a command needs a \"type\"");
  }
  if (*type != kLoadShell) {
    return RefusedCommand(base::StrCat({"\"", *type,
                                        "\" is not a command this engine "
                                        "knows; it takes \"",
                                        kLoadShell, "\""}));
  }

  // BOTH HALVES OR NEITHER. A shell is one module and the directory it is
  // served out of: a new module name against the old root is a 404 and an old
  // name against a new root is the wrong desktop. `ShellSource::Set` takes the
  // pair for the same reason, and this is where a request that carries one of
  // them stops.
  const std::string* root = request->FindString("root");
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

  const std::string* module = request->FindString("module");
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
  return Loaded();
}

}  // namespace domicile
