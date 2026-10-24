---
"@domicile-desktop/component-library": patch
---

Elements draw an outline only while it can show: on keyboard focus, and always on controls so their focus ring still fades. A transparent outline on every element made Chromium repaint anything that moved, every frame.
