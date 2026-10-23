import "./globals.css";

import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";

import { cx } from "../../styled-system/css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  description: "Build a Wayland compositor with web technologies.",
  metadataBase: new URL("https://domicile-desktop.com"),
  title: { default: "Domicile", template: "%s · Domicile" },
};

/** Every page: the fonts, on the preset's dark theme. */
const RootLayout = ({ children }: { children: ReactNode }) => (
  <html
    className={cx(
      inter.variable,
      spaceGrotesk.variable,
      jetbrainsMono.variable,
    )}
    lang="en"
  >
    <body>{children}</body>
  </html>
);

export default RootLayout;
