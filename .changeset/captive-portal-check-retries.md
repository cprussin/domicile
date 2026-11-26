---
"@domicile-desktop/system-network": patch
"@domicile-desktop/manganese-bar-module-network": patch
"@domicile-desktop/manganese": patch
---

A captive portal check gives each try 15 seconds, so a name lookup can wait out a dead nameserver, and manganese repeats a check that got no answer, backing off to a minute, instead of giving up on the network.
