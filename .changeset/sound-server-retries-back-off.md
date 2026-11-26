---
"@domicile-desktop/system-audio": major
---

Without a sound server, the watch waits twice as long before each try, up to `Timing.reopenMaxMs` (a minute), and goes back to `reopenMs` after a subscription that read the server. Each try ran `pactl` three times every 5 seconds.
