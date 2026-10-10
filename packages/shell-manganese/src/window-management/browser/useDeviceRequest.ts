import {
  WEBVIEW_DEVICE_REQUEST_CHANGE_EVENT,
  WEBVIEW_DEVICE_REQUEST_EVENT,
  WEBVIEW_DEVICE_REQUEST_WITHDRAWN_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

/** A device a request offers. */
type Device = z.infer<typeof deviceSchema>;

/** A device request the page is waiting on. */
export type DeviceRequest = {
  /** Chrome's question, naming the site and the kind of device. */
  title: string;
  /** The devices on offer, or `undefined` until the engine has listed them. */
  devices: readonly Device[] | undefined;
  /** Give the page the device with this id. */
  choose: (id: number) => void;
  /** Give the page no device. */
  cancel: () => void;
};

/**
 * The device request the page in `view` is waiting on, if any, such as a
 * hardware wallet asking for its USB device.
 *
 * `preventDefault()` claims it; the engine cancels unclaimed ones when
 * dispatch returns (see `WEBVIEW_DEVICE_REQUEST_EVENT`). One device is chosen
 * at most: Chrome's WebHID, WebUSB and Web Serial each take one.
 *
 * The engine sends one at a time. Answering clears it, as does the engine
 * withdrawing it. Unmounting cancels an open one, since no chooser is drawn
 * for it any more.
 *
 * `view` is `null` when missing, as React's callback refs provide.
 */
export const useDeviceRequest = (
  view: HTMLElement | null,
): DeviceRequest | undefined => {
  const [request, setRequest] = useState<DeviceRequest | undefined>(undefined);
  // The open request, in a ref because cleanup cancels it after the last
  // render.
  const outstanding = useRef<DomicileDeviceRequestEvent | undefined>(undefined);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const cleared = () => {
        outstanding.current = undefined;
        setRequest(undefined);
      };
      const read = (event: DomicileDeviceRequestEvent) => {
        setRequest({
          cancel: () => {
            cleared();
            event.cancel();
          },
          choose: (id) => {
            cleared();
            event.choose([id]);
          },
          devices: event.listed
            ? devicesSchema.parse(event.devices())
            : undefined,
          title: event.title,
        });
      };
      const asked = (event: DomicileDeviceRequestEvent) => {
        event.preventDefault();
        outstanding.current = event;
        read(event);
      };
      const changed = () => {
        if (outstanding.current !== undefined) {
          read(outstanding.current);
        }
      };
      view.addEventListener(WEBVIEW_DEVICE_REQUEST_EVENT, asked);
      view.addEventListener(WEBVIEW_DEVICE_REQUEST_CHANGE_EVENT, changed);
      view.addEventListener(WEBVIEW_DEVICE_REQUEST_WITHDRAWN_EVENT, cleared);
      return () => {
        view.removeEventListener(WEBVIEW_DEVICE_REQUEST_EVENT, asked);
        view.removeEventListener(WEBVIEW_DEVICE_REQUEST_CHANGE_EVENT, changed);
        view.removeEventListener(
          WEBVIEW_DEVICE_REQUEST_WITHDRAWN_EVENT,
          cleared,
        );
        outstanding.current?.cancel();
        outstanding.current = undefined;
      };
    }
  }, [view]);

  return request;
};

const deviceSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
});

const devicesSchema = z.array(deviceSchema);
