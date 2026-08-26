// The command line that starts the compositor.
//
// The compositor reads nothing from the environment and defaults no path: it
// is started by a program now, and a program that meant to say something can
// say it. This is the half of that contract that does the saying, and it is
// its own module so it can be read against `domicile-launch`'s parser, which
// is the half that does the reading.

/** Where a run of the compositor keeps the files only it and the shell share. */
export type CompositorPaths = {
  /** The compositor binary — on `PATH`, or wherever the shell found one. */
  program: string;
  /** The Unix socket the host protocol will be served on. */
  chromeSocket: string;
  /** Where the compositor will publish its session once it is up. */
  sessionFile: string;
  /**
   * The compositor's own configuration, if the shell wrote one. Absent means
   * the compositor's defaults, which is not the same as an empty file.
   */
  configFile?: string | undefined;
  /** Draw client windows in a window of our own, rather than sending pixels. */
  present: boolean;
};

/** A program and the arguments to run it with. */
export type CompositorInvocation = {
  program: string;
  args: string[];
};

/** Build the command line for a run of the compositor. */
export const compositorCommand = ({
  chromeSocket,
  configFile,
  present,
  program,
  sessionFile,
}: CompositorPaths): CompositorInvocation => ({
  args: [
    "--chrome-socket",
    chromeSocket,
    "--session",
    sessionFile,
    ...(configFile === undefined ? [] : ["--config", configFile]),
    ...(present ? ["--present"] : []),
  ],
  program,
});
