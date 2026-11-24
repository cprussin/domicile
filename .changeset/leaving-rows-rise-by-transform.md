---
"@domicile-desktop/component-library": major
"@domicile-desktop/manganese-notifications": patch
"@domicile-desktop/manganese-bar-module-downloads": patch
---

A cleared notification or removed download slides out, then the rows below rise over its place on a spring, all by transform instead of animating the list's height.

- `useLeavingRows` gives each row its `motion` for `LeavingRow`, and `onLeft` drops a row at once. `RowMotion` takes `rise`, `onSlid` and `onClosed` in place of `onLeft`, and `Row.leaving` is a `Leaving` in place of the row's order.
