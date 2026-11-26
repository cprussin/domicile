// The shell guard-engine-stays-quiet.sh drives. Says it ran, then leaves the
// engine idle while the guard records its network log.

export const HostShell = () => {
  console.log("GUARD quiet ready");
};
