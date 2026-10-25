#!/usr/bin/env python3
# Copyright 2026 Connor Prussin
# SPDX-License-Identifier: MIT
"""Lists the string ids every locale but en-US is packed with.

    foreign_allowlist.py <output> <en-US .pak.info>...

Each .pak.info line is `name,id,source`, as grit writes it. The output is
every id except Chrome's own UI: pages, bubbles and menus a desk never shows,
because the shell draws its own. Web-facing strings (Blink's, error pages,
interstitials, the PDF viewer, accessibility) stay in every language.
ResourceBundle reads en-US for an id a locale lacks.
"""

import sys

# Sources whose every string is Chrome's own UI.
DROPPED_SOURCES = frozenset([
    "chrome/app/actor_strings.grdp",
    "chrome/app/app_management_strings.grdp",
    "chrome/app/glic_strings.grdp",
    "chrome/app/gmc_strings.grdp",
    "chrome/app/nearby_share_strings.grdp",
    "chrome/app/password_manager_ui_strings.grdp",
    "chrome/app/profiles_strings.grdp",
    "chrome/app/settings_chromium_strings.grdp",
    "chrome/app/settings_strings.grdp",
    "chrome/app/shared_settings_strings.grdp",
    "chrome/app/skills_strings.grdp",
    "chrome/app/support_tool_strings.grdp",
    "chrome/app/vr_strings.grdp",
    "components/arc_strings.grdp",
    "components/autofill_payments_strings.grdp",
    "components/collaboration_strings.grdp",
    "components/commerce_strings.grdp",
    "components/compose_strings.grdp",
    "components/contextual_cueing_strings.grdp",
    "components/contextual_tasks_strings.grdp",
    "components/history_clusters_strings.grdp",
    "components/management_strings.grdp",
    "components/omnibox/resources/omnibox_pedal_synonyms.grd",
    "components/omnibox_pedal_ui_strings.grdp",
    "components/omnibox_strings.grdp",
    "components/policy_strings.grdp",
    "components/privacy_sandbox_strings.grd",
    "components/reset_password_strings.grdp",
    "components/saved_tab_groups_strings.grdp",
    "components/search_engine_choice_strings.grdp",
    "components/send_tab_to_self_strings.grdp",
    "components/smart_tab_sharing.grdp",
    "components/supervised_user_strings.grdp",
    "components/sync_ui_strings.grdp",
    "components/wallet_strings.grdp",
])

# Name prefixes of Chrome's own UI in sources that mix it with other strings,
# chiefly generated_resources.grd.
DROPPED_PREFIXES = (
    "IDS_COMPOSE_",
    "IDS_FEEDBACK_",
    "IDS_GLIC_",
    "IDS_IOS_",
    "IDS_LENS_",
    "IDS_NTP_",
    "IDS_READING_LIST_",
    "IDS_SETTINGS_",
    "IDS_SYNC_",
    "IDS_TAB_SEARCH_",
    "IDS_TIPS_",
    "IDS_TUTORIAL_",
    "IDS_WHATS_NEW_",
)


def source_path(source):
  """`../../chrome/app/x.grdp`, relative to the build directory, from src/."""
  while source.startswith("../"):
    source = source[len("../"):]
  return source


def kept_ids(lines):
  """The ids of the info lines that are not Chrome's own UI."""
  kept = []
  for line in lines:
    name, resource_id, source = line.rstrip("\n").split(",", 2)
    if (source_path(source) not in DROPPED_SOURCES and
        not name.startswith(DROPPED_PREFIXES)):
      kept.append(int(resource_id))
  return kept


def main(output, infos):
  lines = []
  for info in infos:
    with open(info, encoding="utf-8") as f:
      lines.extend(f)
  with open(output, "w", encoding="utf-8") as f:
    f.write("".join(f"{resource_id}\n" for resource_id in kept_ids(lines)))


if __name__ == "__main__":
  main(sys.argv[1], sys.argv[2:])
