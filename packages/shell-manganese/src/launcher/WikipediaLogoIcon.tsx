// Wikipedia's serifed W, drawn the way a Phosphor icon is so it sits in a
// row beside them: Phosphor draws no Wikipedia logo of its own.

import SSRBase from "@phosphor-icons/react/dist/lib/SSRBase";
import type {
  IconProps,
  IconWeight,
} from "@phosphor-icons/react/dist/lib/types";
import type { ReactElement } from "react";
import { forwardRef } from "react";

export const WikipediaLogoIcon = forwardRef<SVGSVGElement, IconProps>(
  (props, ref) => <SSRBase ref={ref} {...props} weights={WEIGHTS} />,
);
WikipediaLogoIcon.displayName = "WikipediaLogoIcon";

/** The W at a stroke width, as Phosphor's weights are strokes of a width. */
const w = (strokeWidth: number): ReactElement => (
  <g
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={strokeWidth}
  >
    <path d="M44,64 L92,200 L128,104 L164,200 L212,64" />
    <path d="M16,64 H72 M100,64 H156 M184,64 H240" />
    <path d="M128,104 L112,64 M128,104 L144,64" />
  </g>
);

const WEIGHTS = new Map<IconWeight, ReactElement>([
  ["thin", w(8)],
  ["light", w(12)],
  ["regular", w(16)],
  ["bold", w(24)],
  ["fill", w(24)],
  ["duotone", w(16)],
]);
