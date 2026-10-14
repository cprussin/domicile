/** A URL to the SVG; Vite and the test preload both make it a `data:` URL. */
declare module "*.svg" {
  const url: string;
  export default url;
}
