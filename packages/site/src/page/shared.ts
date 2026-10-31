import type { Metadata } from "next";

type Page = { title: string; description: string; path: string };

/**
 * A landing page's metadata: its title in full, without the site's suffix,
 * and the same title and description on link previews. The preview image is
 * the page's `opengraph-image.png`.
 */
export const shared = ({ title, description, path }: Page): Metadata => ({
  alternates: { canonical: path },
  description,
  openGraph: {
    description,
    siteName: "Domicile",
    title,
    type: "website",
    url: path,
  },
  title: { absolute: title },
  twitter: { card: "summary_large_image", description, title },
});
