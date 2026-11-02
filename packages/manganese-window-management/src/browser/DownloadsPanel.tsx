import { Button } from "@domicile-desktop/component-library/Button";
import { IconButton } from "@domicile-desktop/component-library/IconButton";
import { List, ListRow } from "@domicile-desktop/component-library/ListRow";
import { PanelHeader } from "@domicile-desktop/component-library/PanelHeader";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { BroomIcon } from "@phosphor-icons/react/dist/ssr/Broom";
import { FileIcon } from "@phosphor-icons/react/dist/ssr/File";
import { FileAudioIcon } from "@phosphor-icons/react/dist/ssr/FileAudio";
import { FileImageIcon } from "@phosphor-icons/react/dist/ssr/FileImage";
import { FilePdfIcon } from "@phosphor-icons/react/dist/ssr/FilePdf";
import { FileVideoIcon } from "@phosphor-icons/react/dist/ssr/FileVideo";
import { FileZipIcon } from "@phosphor-icons/react/dist/ssr/FileZip";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/ssr/FolderOpen";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";

import { vstack } from "../../styled-system/patterns";
import { FileKind, fileKind } from "./file-kind";

type Props = {
  /** How many finished. */
  count: number;
  onClearAll: () => void;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
  onShowInFolder: (path: string) => void;
  /**
   * Where they were saved, absolute, in the order they started. `undefined`
   * from an engine without it, which lists none.
   */
  paths: readonly string[] | undefined;
};

/**
 * A browser window's finished downloads, newest first, as Chrome's download
 * bubble lists them. Each file's buttons show while the pointer is on it.
 */
export const DownloadsPanel = ({
  count,
  onClearAll,
  onOpen,
  onRemove,
  onShowInFolder,
  paths,
}: Props) => (
  <section aria-labelledby={TITLE_ID} className={panelStyles}>
    <PanelHeader
      action={
        <Button
          beforeIcon={<BroomIcon aria-hidden size={14} />}
          onClick={onClearAll}
          rounded
          size="xs"
          variant="ghost"
        >
          Clear all
        </Button>
      }
      title={count === 1 ? "Download finished" : `${count} downloads finished`}
      titleId={TITLE_ID}
    />
    {paths === undefined ? undefined : (
      <List>
        {paths.toReversed().map((path) => (
          <ListRow
            detail={`Saved to ${folderName(path)}`}
            end={
              <>
                <IconButton
                  label="Open"
                  onClick={() => {
                    onOpen(path);
                  }}
                >
                  <ArrowSquareOutIcon aria-hidden size={14} />
                </IconButton>
                <IconButton
                  label="Show in folder"
                  onClick={() => {
                    onShowInFolder(path);
                  }}
                >
                  <FolderOpenIcon aria-hidden size={14} />
                </IconButton>
                <IconButton
                  label="Remove from list"
                  onClick={() => {
                    onRemove(path);
                  }}
                >
                  <XIcon aria-hidden size={14} />
                </IconButton>
              </>
            }
            endOnHover
            icon={<FileKindIcon kind={fileKind(path)} />}
            key={path}
            label={path.slice(path.lastIndexOf("/") + 1)}
          />
        ))}
      </List>
    )}
  </section>
);

const TITLE_ID = "downloads-panel-title";

/** The name of the folder `path` is in. */
const folderName = (path: string): string => {
  const folder = path.slice(0, path.lastIndexOf("/"));
  return folder.slice(folder.lastIndexOf("/") + 1);
};

/** The icon for a file of `kind`. */
const FileKindIcon = ({ kind }: { kind: FileKind }) => {
  switch (kind) {
    case FileKind.Archive: {
      return <FileZipIcon size={16} />;
    }
    case FileKind.Audio: {
      return <FileAudioIcon size={16} />;
    }
    case FileKind.Image: {
      return <FileImageIcon size={16} />;
    }
    case FileKind.Other: {
      return <FileIcon size={16} />;
    }
    case FileKind.Pdf: {
      return <FilePdfIcon size={16} />;
    }
    case FileKind.Video: {
      return <FileVideoIcon size={16} />;
    }
  }
};

// Wide enough for a long file name beside its buttons.
const panelStyles = vstack({
  alignItems: "stretch",
  gap: 1,
  inlineSize: 80,
  maxInlineSize: "100%",
});
