import type { Meta, StoryObj } from "@storybook/react-vite";

import { Variants } from "../__test__/Variants";

import { AVATAR_SIZES, Avatar as AvatarComponent } from "./Avatar";
import { slowImageDecorator } from "./slowImageDecorator";

type AvatarCase = {
  label: string;
  name: string;
  src?: string | undefined;
};

const AVATAR_CASES: AvatarCase[] = [
  { label: "Ada Lovelace", name: "Ada Lovelace" },
  { label: "Grace Hopper", name: "Grace Hopper" },
  { label: "Alan Turing", name: "Alan Turing" },
  { label: "Linus Torvalds", name: "Linus Torvalds" },
  { label: "Margaret Hamilton", name: "Margaret Hamilton" },
  { label: "Connor Prussin", name: "Connor Prussin" },
  {
    label: "Loading → image",
    name: "Linus Torvalds",
    src: "https://i.pravatar.cc/200?img=33",
  },
  {
    label: "Loading → broken",
    name: "Margaret Hamilton",
    src: "https://invalid.example.com/missing.png",
  },
];

const meta = {
  args: {
    name: "Connor Prussin",
    size: "md",
  },
  argTypes: {
    alt: {
      control: "text",
      table: { category: "Contents" },
    },
    name: {
      control: "text",
      table: { category: "Contents" },
    },
    size: {
      control: "inline-radio",
      options: AVATAR_SIZES,
      table: { category: "Style" },
    },
    src: {
      control: "text",
      table: { category: "Contents" },
    },
  },
  component: AvatarComponent,
  parameters: {
    docs: {
      description: {
        component:
          "Circular avatar that displays an image when provided and falls back to white initials over a name-derived gradient when the image is missing or fails to load. Wraps the @base-ui/react Avatar primitive.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/Avatar",
} satisfies Meta<typeof AvatarComponent>;
export default meta;

export const Avatar: StoryObj<typeof AvatarComponent> = {};

export const WithImage: StoryObj<typeof AvatarComponent> = {
  args: {
    name: "Ada Lovelace",
    src: "https://i.pravatar.cc/200?img=47",
  },
};

export const LoadingImage: StoryObj<typeof AvatarComponent> = {
  args: {
    name: "Linus Torvalds",
    src: "https://i.pravatar.cc/200?img=33",
  },
  decorators: [slowImageDecorator],
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates the pulsing skeleton shown while an image is loading. A story-scoped decorator monkey-patches `window.Image` so any image created while this story is mounted defers its actual network request by 5 seconds, keeping the skeleton visible long enough to inspect before the image fades in.",
      },
    },
  },
};

export const BrokenImage: StoryObj<typeof AvatarComponent> = {
  args: {
    name: "Grace Hopper",
    src: "https://invalid.example.com/missing.png",
  },
  parameters: {
    docs: {
      description: {
        story:
          "When the image fails to load, the initials fallback is rendered automatically.",
      },
    },
  },
};

export const SlowBrokenImage: StoryObj<typeof AvatarComponent> = {
  args: {
    name: "Margaret Hamilton",
    src: "https://invalid.example.com/missing.png",
  },
  decorators: [slowImageDecorator],
  parameters: {
    docs: {
      description: {
        story:
          "Combines the slow-loading decorator with a broken `src`: the skeleton is shown for 5 seconds, then the image request fails and the avatar transitions to the initials fallback. Demonstrates that the initials/gradient appear only on real load errors, not while the request is still in flight.",
      },
    },
  },
};

export const AllVariations: StoryObj<typeof AvatarComponent> = {
  args: { name: "Connor Prussin" },
  decorators: [slowImageDecorator],
  parameters: {
    controls: { exclude: ["size", "name", "src", "alt"] },
    docs: {
      description: {
        story:
          "Cross-product of every avatar size against representative content cases. The `slowImageDecorator` is applied so the two image columns (one valid, one broken) sit in their pulsing skeleton state for 5 seconds before resolving — letting you see the loading state, then the image fade-in, then the eventual fade to the initials fallback on the broken column, all next to plain initials avatars at every size.",
      },
    },
  },
  render: () => (
    <Variants
      columnLabel={(column) => column.label}
      columns={AVATAR_CASES}
      rowLabel={(row) => row}
      rows={AVATAR_SIZES}
    >
      {(size, { name, src }) => (
        <AvatarComponent name={name} size={size} src={src} />
      )}
    </Variants>
  ),
};
