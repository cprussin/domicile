import { AppChooser } from "@domicile-desktop/component-library/AppChooser";
import type { AppsDesktop } from "@domicile-desktop/system-apps/apps-desktop";
import type { Openers } from "@domicile-desktop/system-apps/openers";
import { openers } from "@domicile-desktop/system-apps/openers";
import { useEffect, useState } from "react";

type Props = {
  onClose: () => void;
  /** Called with the argv that opens the file with the application picked. */
  onOpen: (argv: readonly string[]) => void;
  /** The file, relative to home or absolute. */
  path: string;
  screen: string | undefined;
  domicile: AppsDesktop;
};

/**
 * Pick the application to open a file with, from those `openers` offers. The
 * one Enter opens it with starts picked.
 */
export const OpenWith = ({
  onClose,
  onOpen,
  path,
  screen,
  domicile,
}: Props) => {
  const found = useOpeners(domicile, path);
  const apps = found?.apps ?? [];
  return (
    <AppChooser
      choices={apps.map(({ id }) => withoutSuffix(id))}
      contentType={found?.contentType.match({
        None: () => undefined,
        Some: (type) => type,
      })}
      domicile={domicile}
      onCancel={onClose}
      onChoose={(id) => {
        const app = apps.find((each) => withoutSuffix(each.id) === id);
        if (found === undefined || app === undefined) {
          throw new Error(`${id} was not offered to open ${path} with`);
        } else {
          onOpen(found.command(app));
        }
      }}
      opened={path.slice(path.lastIndexOf("/") + 1)}
      screen={screen}
    />
  );
};

/** What opens `path`, or `undefined` until read. */
const useOpeners = (
  domicile: AppsDesktop,
  path: string,
): Openers | undefined => {
  const [found, setFound] = useState<Openers | undefined>();

  useEffect(() => {
    let current = true;
    openers(domicile, path)
      .then((result) => {
        result.match({
          Err: (error) => {
            throw new Error(
              `could not find what opens ${path}: ${error.message}`,
            );
          },
          Ok: (read) => {
            if (current) {
              setFound(read);
            }
          },
        });
      })
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: reports why the dialog lists nothing
        console.error("Could not find what opens the file", error);
      });
    return () => {
      current = false;
    };
  }, [domicile, path]);

  return found;
};

const withoutSuffix = (id: string): string => id.replace(/\.desktop$/, "");
