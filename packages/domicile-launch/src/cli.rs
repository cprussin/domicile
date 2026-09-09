//! What `domicile` was asked to do.

/// What the bridge prefixes the one line that is an interface with.
const SERVING: &str = "domicile: serving ";

/// A command line `domicile` will not run.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CliError {
    #[error(
        "which shell? Give the directory your shell built, or the entry point \
         inside it:\n\n    domicile ./my-desktop/dist\n"
    )]
    NoShell,
    #[error(
        "too many arguments: {extra}. A desktop is one shell, and which one is \
         the whole command line."
    )]
    TooMany { extra: String },
}

/// What to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invocation {
    /// Run a desktop on this shell.
    Run { shell: String },
}

/// Read the command line, or refuse it and say what to type instead.
///
/// Refused rather than defaulted, both ways. There is no shell a bare
/// `domicile` could mean, and a second argument is somebody saying two things:
/// quietly dropping the word they typed is how a run serves one page while
/// they read another on their own command line.
pub fn invocation(args: impl IntoIterator<Item = String>) -> Result<Invocation, CliError> {
    let mut args = args.into_iter();
    let shell = args.next().ok_or(CliError::NoShell)?;
    match args.next() {
        None => Ok(Invocation::Run { shell }),
        Some(extra) => Err(CliError::TooMany { extra }),
    }
}

/// The URL out of the bridge\'s own line, or nothing.
///
/// The bridge says where it is serving on one line, in a shape a caller can
/// read, because the port is the kernel\'s choice and nothing else knows it.
/// Matched from the start of the line rather than searched for: the bridge
/// logs, and taking the first line that happens to contain a URL is how a
/// desktop opens a window on a message.
pub fn serving_url(line: &str) -> Option<&str> {
    line.strip_prefix(SERVING)
}
