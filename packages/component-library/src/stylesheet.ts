/// <reference path="./css.d.ts" />

// The package's prebuilt stylesheet, from `panda cssgen` (`prepare`). Every
// component imports this module, so a shell with no Panda step gets its rules.
// The reference declares the import for every package that checks this file.
import "../styled-system/styles.css";
