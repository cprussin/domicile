import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";

import { DetailList as DetailListComponent } from "./DetailList";

const meta = {
  args: {
    rows: [
      ["Speed", "867 Mb/s"],
      [
        "Address",
        ["10.42.0.17/24", "2600:1702:4b80:438f:2a0c:50ff:fe33:91aa/64"],
        { copyable: true },
      ],
      ["Gateway", "10.42.0.1", { copyable: true }],
      ["Hardware address", "28:0c:50:ab:cd:ef", { copyable: true }],
    ],
  },
  argTypes: {
    rows: { control: "object", table: { category: "Contents" } },
  },
  component: DetailListComponent,
  decorators: [
    (Story) => (
      <div className={frameStyles}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "Terms and their values in two columns. A long value wraps within its column, so it never widens the panel. Values can be selected; a copyable one shows a copy button on the line under the pointer.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Panels/DetailList",
} satisfies Meta<typeof DetailListComponent>;
export default meta;

export const DetailList: StoryObj<typeof DetailListComponent> = {};

const frameStyles = css({ inlineSize: 72 });
