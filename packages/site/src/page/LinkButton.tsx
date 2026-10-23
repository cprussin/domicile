"use client";

import { Button } from "@domicile-desktop/component-library/Button";

type Props = {
  href: string;
  children: string;
  variant?: "accent" | "outline" | undefined;
  size?: "md" | "lg" | undefined;
};

/**
 * The component library's `Button` as a link. A client component, since
 * `Button` measures itself.
 */
export const LinkButton = ({
  href,
  children,
  variant = "accent",
  size = "md",
}: Props) => (
  <Button href={href} size={size} variant={variant}>
    {children}
  </Button>
);
