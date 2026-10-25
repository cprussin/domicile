// Shell module for guard-notification-server-late.sh. Shows a notification as
// soon as it runs, which starts the browser's notification bridge before the
// guard's notification server exists.

export const HostShell = () => {
  const notification = new Notification("guard-notification-server-late");
  console.log(`GUARD notified ${notification.title}`);
};
