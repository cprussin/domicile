---
"@domicile-desktop/engine": minor
"domicile": minor
"@domicile-desktop/manganese-window-management": minor
"@domicile-desktop/manganese-bar-module-sharing": minor
---

An agent seat's pointer and keyboard reach browser windows at desk positions. The compositor sends each step to the browser as `agent_input`, which hit tests the desk point to the page under it, refuses the shell's own page, carries drags between pages, and answers `agent_input_reached`. The user's own press or key in a browser window an agent holds takes it. Manganese draws an agent's ring, name and pointer on browser windows too, and its agent pill lists the browser windows an agent uses.
