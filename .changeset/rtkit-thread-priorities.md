---
"domicile": minor
"@domicile-desktop/site": patch
---

The desktop stays smooth while the machine is busy without joining the `domicile` group: the engine asks rtkit to raise its drawing threads when the limits refuse. The NixOS module enables rtkit, and the packages recommend it. The group is optional and gives the most reliable result.
