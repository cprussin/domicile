/** The Bluetooth icon's state: off, on, or on with a device connected. */
export const iconStateOf = (connected: boolean, on: boolean) => {
  if (on) {
    return connected ? "connected" : "on";
  } else {
    return "off";
  }
};
