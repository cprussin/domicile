---
"@domicile-desktop/component-library": patch
"@domicile-desktop/manganese-bar": patch
"@domicile-desktop/manganese-bar-module-workspace-switcher": patch
---

The workspace switcher's chip slides smoothly when a workspace comes or goes at the end of the row: the bar items beside its empty middle no longer clip while they resize (`FluidItem`'s new `overflow` prop), and the chip's clip no longer depends on the row's width.
