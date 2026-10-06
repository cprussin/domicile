import type { Meta, StoryObj } from "@storybook/react-vite";

import { css } from "../../styled-system/css";
import { FilePicker as FilePickerComponent } from "./FilePicker";
import type { FileRequest } from "./file-request";
import { ChooserMode } from "./file-request";

const HOME = "/home/someone";

/** A small home to walk. Directory names end in `/`. */
const FOLDERS = new Map<string, readonly string[]>([
  ["/", ["home/", "tmp/"]],
  ["/home", ["someone/"]],
  [HOME, ["Documents/", "Downloads/", "Pictures/", "notes.txt", ".bashrc"]],
  [`${HOME}/Documents`, ["report.pdf", "budget.csv", "talk.md"]],
  [`${HOME}/Downloads`, ["backup.tar.gz", "song.flac", "clip.mp4"]],
  [`${HOME}/Pictures`, ["cat.png", "dog.jpg", "trips/"]],
  [`${HOME}/Pictures/trips`, []],
  ["/tmp", []],
]);

const list = (path: string): Promise<readonly string[]> => {
  const entries = FOLDERS.get(path);
  return entries === undefined
    ? Promise.reject(new DOMException(path, "NotReadableError"))
    : Promise.resolve(entries);
};

const request = (overrides: Partial<FileRequest>): FileRequest => ({
  accept: [],
  cancel: () => {
    /* no-op */
  },
  choose: () => {
    /* no-op */
  },
  currentFolder: undefined,
  filters: undefined,
  home: HOME,
  list,
  mode: ChooserMode.Open,
  suggestedName: "",
  title: undefined,
  ...overrides,
});

const meta = {
  argTypes: {
    ref: {
      control: false,
      table: { category: "Behavior" },
    },
    request: {
      control: "object",
      table: { category: "Contents" },
    },
  },
  component: FilePickerComponent,
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
          "A keyboard-first file picker drawn over its positioned parent. It lists one folder at a time through the request's `list`, and answers through `choose` or `cancel`.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/FilePicker",
} satisfies Meta<typeof FilePickerComponent>;
export default meta;

type Story = StoryObj<typeof FilePickerComponent>;

export const Open: Story = {
  args: { ref: undefined, request: request({}) },
};

export const OpenMultiple: Story = {
  args: {
    ref: undefined,
    request: request({ mode: ChooserMode.OpenMultiple }),
  },
};

export const OpenFolder: Story = {
  args: { ref: undefined, request: request({ mode: ChooserMode.OpenFolder }) },
};

export const Save: Story = {
  args: {
    ref: undefined,
    request: request({ mode: ChooserMode.Save, suggestedName: "photo.png" }),
  },
};

export const WithFilters: Story = {
  args: {
    ref: undefined,
    request: request({
      currentFolder: `${HOME}/Documents`,
      filters: [
        { extensions: ["pdf"], name: "PDF documents" },
        { extensions: ["csv", "md"], name: "Text" },
      ],
      title: "Attach a document",
    }),
  },
};

const frameStyles = css({
  blockSize: "100vh",
  position: "relative",
});
