import panda from "@pandacss/dev/postcss";
import { defineConfig } from "vite";

export default defineConfig({
  css: { postcss: { plugins: [panda({ cwd: import.meta.dirname })] } },
});
