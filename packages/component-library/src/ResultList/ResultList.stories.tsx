import { FileIcon } from "@phosphor-icons/react/dist/ssr/File";
import { FolderIcon } from "@phosphor-icons/react/dist/ssr/Folder";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";

import { Marked } from "./Marked";
import { ResultList as ResultListComponent } from "./ResultList";
import { RowTile } from "./RowTile";

type Found = { isFolder: boolean; name: string; picture?: string };

// A row whose tile shows a picture in place of its glyph.
const PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#7cc4f0"/><rect y="5" width="16" height="4" fill="#4e8a3a"/><circle cx="12" cy="3" r="1.5" fill="#ffd56b"/></svg>',
)}`;

const meta = {
  args: {
    children: ({ isFolder, name, picture }) => (
      <>
        <RowTile icon={isFolder ? FolderIcon : FileIcon} picture={picture} />
        <span>
          <Marked query="notes" text={name} />
        </span>
      </>
    ),
    highlighted: 0,
    id: "results",
    items: [
      { isFolder: true, name: "Notes" },
      { isFolder: false, name: "notes.org" },
      { isFolder: false, name: "Quarterly notes.pdf" },
      { isFolder: false, name: "Notes from the hike.png", picture: PICTURE },
    ],
    keyOf: ({ name }) => name,
    label: "Results",
    onChoose: () => undefined,
    onHighlight: () => undefined,
  },
  argTypes: {
    children: { control: false, table: { category: "Contents" } },
    highlighted: {
      control: { max: 3, min: 0, type: "number" },
      table: { category: "State" },
    },
    id: { control: "text", table: { category: "Contents" } },
    items: { control: false, table: { category: "Contents" } },
    keyOf: { control: false, table: { category: "Contents" } },
    label: { control: "text", table: { category: "Contents" } },
    onChoose: { control: false, table: { category: "Events" } },
    onHighlight: { control: false, table: { category: "Events" } },
  },
  component: ResultListComponent<Found>,
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
          "The rows under a search box, with one highlight that the keyboard and the pointer both move.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/ResultList",
} satisfies Meta<typeof ResultListComponent<Found>>;
export default meta;

export const ResultList: StoryObj<typeof meta> = {};

const frameStyles = css({ inlineSize: 88 });
