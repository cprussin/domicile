#!/usr/bin/env python3
"""Takes a command's key out of a stopped profile, for guard-extension-kept-key.sh.

Leaves the profile as Chrome leaves it when it kept a suggested key from an
extension at install: no binding in `extensions.commands`, and no
`was_assigned` for the command. With --cleared, it marks the command
`was_assigned` instead, as Chrome does when the person clears a key.

Prints `took` when the binding was there and is gone, `none` when the profile
held no binding for the command, and `unwritten` when it has no preferences.
"""

import argparse
import json
import os


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, help="the user data dir")
    parser.add_argument("--id", required=True, help="the extension's id")
    parser.add_argument("--command", required=True, help="the command's name")
    parser.add_argument(
        "--cleared",
        action="store_true",
        help="leave the key as one the person cleared",
    )
    arguments = parser.parse_args()

    # Chrome keeps an extension's settings in either file, depending on
    # whether the platform protects them.
    files = [
        os.path.join(arguments.profile, "Default", name)
        for name in ("Preferences", "Secure Preferences")
    ]
    read = {path: json.load(open(path)) for path in files if os.path.exists(path)}
    if not read:
        print("unwritten", flush=True)
        return

    took = False
    for prefs in read.values():
        bindings = prefs.get("extensions", {}).get("commands", {})
        for key in [
            key
            for key, binding in bindings.items()
            if binding.get("extension") == arguments.id
            and binding.get("command_name") == arguments.command
        ]:
            del bindings[key]
            took = True
        command = (
            prefs.get("extensions", {})
            .get("settings", {})
            .get(arguments.id, {})
            .get("commands", {})
            .get(arguments.command)
        )
        if command is not None:
            if arguments.cleared:
                command["was_assigned"] = True
            else:
                command.pop("was_assigned", None)

    for path, prefs in read.items():
        with open(path, "w") as file:
            json.dump(prefs, file)
    print("took" if took else "none", flush=True)


if __name__ == "__main__":
    main()
