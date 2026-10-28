---
"@domicile-desktop/builder": minor
"@domicile-desktop/manganese": minor
---

The shell builder loads the project's own `vite.config`, so a shell can add tools such as Tailwind. The builder's shell output settings and Domicile's packages override the config. Without one, it transpiles and bundles only. Manganese exports its Panda config, for a shell's own Panda setup.
