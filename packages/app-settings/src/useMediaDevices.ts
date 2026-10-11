import { useCallback, useEffect, useState } from "react";

import type { Report } from "./config-editor";
import type { MediaDevices, MediaKind, SettingsHost } from "./host";

/** The engine's cameras and microphones, listed again after each change. */
export const useMediaDevices = (host: SettingsHost, report: Report) => {
  const [devices, setDevices] = useState<MediaDevices | undefined>(undefined);

  const reload = useCallback(() => {
    host
      .mediaDevices()
      .then(setDevices, report("Couldn't list cameras and microphones"));
  }, [host, report]);

  useEffect(() => {
    reload();
  }, [reload]);

  const prefer = useCallback(
    (kind: MediaKind, id: string) => {
      host
        .setMediaDevice(kind, id)
        .then(reload, report("Couldn't change the device"));
    },
    [host, reload, report],
  );

  return { devices, prefer };
};
