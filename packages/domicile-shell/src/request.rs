//! What a command line asks for by way of a shell.

use std::str::FromStr;

use domicile_config::ShellRef;

use crate::ShellError;

/// Whether to start a shell, and which.
///
/// Starting one is the default: a compositor is a desktop, and a desktop with
/// no chrome is a black window that says nothing about why. So the *absence* of
/// a flag means "the one the config names", and a run that wants no shell at
/// all has to say so — which is a real case, since every end-to-end check
/// drives a chrome-less compositor with a stand-in of its own on the socket,
/// but it is a case worth stating out loud rather than falling into.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellRequest {
    /// `--no-shell`: serve the socket and let something else connect to it.
    None,
    /// Nothing, or a bare `--shell`: whichever shell the config names.
    FromConfig,
    /// `--shell REF`: this one, whatever the config says.
    Named(ShellRef),
}

/// Read the shell request out of a command line.
///
/// Takes the arguments rather than reading `std::env::args` so it can be
/// tested; the caller passes the real ones.
pub fn shell_request(args: impl IntoIterator<Item = String>) -> Result<ShellRequest, ShellError> {
    let args: Vec<String> = args.into_iter().collect();
    // Scanned first, and anywhere, so `--shell x --no-shell` cannot start `x`.
    // The two together are a contradiction, and the reading of a contradiction
    // that starts no process is the safe one.
    if args.iter().any(|arg| arg == NONE_FLAG) {
        return Ok(ShellRequest::None);
    }
    // `--no-shell` takes no value, so a joined one is a mistyped command line
    // rather than a shape to interpret — and `--no-shell=1` is an easy thing to
    // type after reading `DOMICILE_PRESENT=1`. Refused for the reason
    // `--shell=` is: matching nothing and starting the config's shell in
    // silence is the failure both spellings exist to prevent.
    if let Some(joined) = args
        .iter()
        .find(|arg| arg.starts_with(&format!("{NONE_FLAG}=")))
    {
        return Err(ShellError::Invalid {
            path: NONE_FLAG.to_string(),
            message: format!("{NONE_FLAG} takes no value, got {joined:?}"),
        });
    }
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        // `--shell=REF` is the ordinary GNU spelling and the first thing many
        // people type. Scanning only for the bare flag left it matching
        // nothing, so the compositor came up with no chrome and said nothing
        // about the argument it had been handed.
        if let Some(reference) = arg.strip_prefix(JOINED) {
            return if reference.starts_with("--") {
                // Nothing names a shell `--foo`, so this is a mistyped command
                // line, and the loud version of it is the one that says which
                // flag was wrong rather than reporting a missing shell.
                //
                // The separated spelling cannot reach here: `--shell --foo`
                // sees the next argument start with `--` and reads the bare
                // flag as "use the config", which is the right answer for
                // *that* shape. Joined, there is no next argument to fall back
                // to and nothing sensible to mean.
                Err(ShellError::Invalid {
                    path: FLAG.to_string(),
                    message: format!("{reference:?} is a flag, not a shell"),
                })
            } else {
                named(reference)
            };
        } else if arg == FLAG {
            return match args.next() {
                // Every other flag the compositor takes is `--flag value`, so a
                // bare `--shell` followed by one of them would otherwise eat it
                // as a shell reference and start a shell called
                // `--chrome-socket`.
                Some(next) if next.starts_with("--") => Ok(ShellRequest::FromConfig),
                Some(reference) => named(&reference),
                None => Ok(ShellRequest::FromConfig),
            };
        }
    }
    // No flag at all is the ordinary way to start a desktop, so it means what
    // the config says rather than "start nothing".
    Ok(ShellRequest::FromConfig)
}

/// The flag that asks for a shell.
const FLAG: &str = "--shell";

/// The flag that asks for none.
const NONE_FLAG: &str = "--no-shell";

/// The same flag with its value attached.
const JOINED: &str = "--shell=";

/// A reference the command line named, or what is wrong with it.
fn named(reference: &str) -> Result<ShellRequest, ShellError> {
    ShellRef::from_str(reference)
        .map(ShellRequest::Named)
        .map_err(|err| ShellError::Invalid {
            path: FLAG.to_string(),
            message: err.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(args: &[&str]) -> Result<ShellRequest, ShellError> {
        shell_request(args.iter().map(|arg| (*arg).to_string()))
    }

    #[test]
    fn without_a_flag_the_config_decides() {
        // The default, and the reason this changed: a compositor that came up
        // with no chrome because nobody said the magic word is a black window
        // whose cause is invisible.
        assert_eq!(
            request(&["--chrome-socket", "/run/c.sock"]).unwrap(),
            ShellRequest::FromConfig
        );
    }

    #[test]
    fn no_shell_is_how_a_run_asks_for_none() {
        // Stated rather than fallen into. Every end-to-end check drives a
        // chrome-less compositor and now says so.
        assert_eq!(
            request(&["--chrome-socket", "/run/c.sock", "--no-shell"]).unwrap(),
            ShellRequest::None
        );
    }

    #[test]
    fn a_value_joined_to_no_shell_is_refused_rather_than_ignored() {
        // It matched neither flag and fell through to the config's shell — the
        // silent ignore that `--shell=` was refused to close, arriving through
        // the third door.
        for bad in ["--no-shell=true", "--no-shell=1", "--no-shell="] {
            let err = request(&[bad]).unwrap_err();
            assert!(
                matches!(err, ShellError::Invalid { .. }),
                "{bad:?} was ignored: {err:?}"
            );
        }
    }

    #[test]
    fn no_shell_wins_wherever_it_appears() {
        // Scanned before anything else, so `--shell x --no-shell` cannot end up
        // starting `x`. The two together are a contradiction, and the safe
        // reading of a contradiction is the one that starts no process.
        assert_eq!(
            request(&["--shell", "manganese", "--no-shell"]).unwrap(),
            ShellRequest::None
        );
    }

    #[test]
    fn the_bare_flag_defers_to_the_config() {
        assert_eq!(request(&["--shell"]).unwrap(), ShellRequest::FromConfig);
    }

    #[test]
    fn a_name_overrides_the_config() {
        assert_eq!(
            request(&["--shell", "manganese"]).unwrap(),
            ShellRequest::Named(ShellRef::Name("manganese".into()))
        );
    }

    #[test]
    fn a_path_overrides_the_config() {
        assert_eq!(
            request(&["--shell", "./packages/shell-simple"]).unwrap(),
            ShellRequest::Named(ShellRef::Path("./packages/shell-simple".into()))
        );
    }

    #[test]
    fn the_bare_flag_does_not_swallow_the_next_flag() {
        // `--shell --chrome-socket /run/c.sock` is an ordinary thing to type,
        // and without this it starts a shell named `--chrome-socket` and then
        // serves on the default socket — two wrong things, neither of which
        // mentions the flag that caused them.
        assert_eq!(
            request(&["--shell", "--chrome-socket", "/run/c.sock"]).unwrap(),
            ShellRequest::FromConfig
        );
    }

    #[test]
    fn the_value_may_be_joined_to_the_flag() {
        // `--shell=simple` used to match nothing at all: the compositor came up
        // headless, started no chrome, and said nothing about the flag. That is
        // the same failure `the_bare_flag_does_not_swallow_the_next_flag`
        // exists to prevent, arriving through the other door.
        assert_eq!(
            request(&["--shell=simple"]).unwrap(),
            ShellRequest::Named(ShellRef::Name("simple".into()))
        );
        assert_eq!(
            request(&["--shell=./my-shell"]).unwrap(),
            ShellRequest::Named(ShellRef::Path("./my-shell".into()))
        );
    }

    #[test]
    fn a_flag_joined_to_the_flag_is_refused() {
        let err = request(&["--shell=--chrome-socket"]).unwrap_err();
        assert!(matches!(err, ShellError::Invalid { .. }), "{err:?}");
    }

    #[test]
    fn an_empty_joined_reference_is_refused_rather_than_ignored() {
        let err = request(&["--shell="]).unwrap_err();
        assert!(matches!(err, ShellError::Invalid { .. }), "{err:?}");
    }

    #[test]
    fn an_empty_reference_is_refused() {
        let err = request(&["--shell", ""]).unwrap_err();
        assert!(matches!(err, ShellError::Invalid { .. }), "{err:?}");
    }
}
