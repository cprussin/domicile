---
"domicile": patch
---

An MCP session that calls nothing for two minutes lets go of the desktop, and the server tells agents to call `stop_using_desktop` before waiting on anything else. `browser_click` at a point, `browser_drag` and `browser_scroll` read the page's scale with `Page.getLayoutMetrics`, which agents are allowed, rather than `Runtime.evaluate`, which the engine refused.
