import manganese from "@domicile-desktop/manganese/panda.config";
import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  ...manganese,
  importMap: "@domicile-desktop/manganese",
  include: ["./*.tsx"],
  outdir: "styled-system",
  preflight: false,
});
