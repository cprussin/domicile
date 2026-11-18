"""Prints a one-time link that signs the Slack desktop app in to a workspace.

Signs in on the web with a password once, keeping the session in
BENCH_SLACK_STATE, then asks Slack for the link its "open in the app" page
hands the desktop app. On failure, saves the page to BENCH_SLACK_DEBUG.
"""

import os
import re
import sys
from typing import NoReturn

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

WORKSPACE = os.environ["BENCH_SLACK_WORKSPACE"]
STATE = os.environ["BENCH_SLACK_STATE"]
DEBUG = os.environ.get("BENCH_SLACK_DEBUG", "slack-debug")
BASE = f"https://{WORKSPACE}.slack.com"


def fail(page, message) -> NoReturn:
    os.makedirs(DEBUG, exist_ok=True)
    page.screenshot(path=os.path.join(DEBUG, "page.png"), full_page=True)
    with open(os.path.join(DEBUG, "page.html"), "w") as file:
        file.write(page.content())
    sys.exit(f"{message} (at {page.url}; page saved to {DEBUG})")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    signed_in = os.path.exists(STATE)
    context = browser.new_context(storage_state=STATE if signed_in else None)
    page = context.new_page()
    if not signed_in:
        page.goto(f"{BASE}/sign_in_with_password")
        page.fill("input[type=email]", os.environ["BENCH_SLACK_EMAIL"])
        page.fill("input[type=password]", os.environ["BENCH_SLACK_PASSWORD"])
        page.click("button[type=submit]")
        try:
            page.wait_for_url(lambda url: "sign_in" not in url, timeout=60_000)
        except PlaywrightTimeout:
            fail(page, "the password sign-in didn't finish")
        context.storage_state(path=STATE)
    page.goto(f"{BASE}/ssb/redirect")
    page.wait_for_timeout(5_000)
    link = re.search(r"slack://[^\"'\s<>]*magic-login[^\"'\s<>]*", page.content())
    if link is None:
        fail(page, "Slack gave no magic-login link")
    print(link.group(0).replace("&amp;", "&"))
    browser.close()
