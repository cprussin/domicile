import { plugin } from "bun";

/**
 * Makes an imported SVG a `data:` URL, as Vite inlines one under its asset
 * size limit. Bun's default makes it a file path, which an app module cannot
 * load.
 */
export const registerSvgDataUrl = () => {
  plugin({
    name: "svg-data-url",
    setup: (build) => {
      build.onLoad({ filter: /\.svg$/ }, async ({ path }) => ({
        exports: {
          default: `data:image/svg+xml,${encodeURIComponent(await Bun.file(path).text())}`,
        },
        loader: "object",
      }));
    },
  });
};
