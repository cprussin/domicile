---
"domicile": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/react": minor
---

Shells see agents' seats: `domicile.seats` lists each agent seat (name, pointer, focused window, held and taken windows) and takes a window from an agent or gives it back, and each window's `heldBy` names the agent seat holding it. `useSeats()` follows the list in React. A window the user takes from an agent stays theirs until given back.
