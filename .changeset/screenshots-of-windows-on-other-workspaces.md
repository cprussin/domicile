---
"@domicile-desktop/engine": patch
"@domicile-desktop/manganese-window-management": patch
"@domicile-desktop/manganese": patch
"domicile": patch
---

Screenshots and screen casts of a browser window on another workspace work. Manganese lays a captured window on a workspace no screen shows out under the wallpaper, as it lays a captured tab out under the tab in front of it, so its page keeps drawing. An agent's `devtools` `Page.captureScreenshot` lists its window as captured until it answers, in place of being refused for a window nobody draws, and the MCP server's `browser_screenshot` takes a window on another workspace.
