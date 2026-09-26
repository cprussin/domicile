//! The verifier behind `crate::lock::Verifier`: PAM, as the desk's own user.
//!
//! `pam_authenticate` against the user this process runs as, through the
//! service `lock.pam_service` names — which is what every other lock screen on
//! Linux does, and what makes the lock a secret rather than a string in a
//! world-readable file.
//!
//! **THE SERVICE IS THE MACHINE'S.** A lock screen gets a PAM service of its
//! own that the *system* declares — swaylock's `security.pam.services.swaylock`
//! is the pattern — and a home-manager module cannot declare one. So a desk
//! that names a service `/etc/pam.d` does not have does not come up: Linux-PAM
//! would answer it with the `other` stack, which is a deny on NixOS and the
//! ordinary login stack on Debian, and neither is what the config asked for.
//! The file is looked for again on every attempt, for the same reason.
//!
//! **LOADED, NOT LINKED**, the way libEGL and the engine are: a desk that does
//! not use PAM needs no libpam, and a desk that does learns at startup that it
//! has none, by name. The flake puts `pam` on the compositor's runpath.
//!
//! **WHAT IS NOT DONE.** Only `pam_authenticate`: no `pam_acct_mgmt`, no
//! `pam_setcred` — swaylock's set, minus its credential refresh. And every
//! prompt a module sends is answered with the one passphrase the page offered,
//! so a stack that asks two questions (a password and then a one-time code)
//! gets the same answer twice and refuses it; the protocol carries one.

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::ptr;

use domicile_protocol::Passphrase;
use libloading::Library;
use thiserror::Error;
use tracing::{info, warn};

use crate::lock::{CouldNotCheck, Verdict, Verifier};

/// Where Linux-PAM reads a service from. Handed to `pam_start_confdir`
/// explicitly rather than left to its default, so the directory this module
/// checks and the one PAM reads are the same one — the default would also try
/// `/etc/pam.conf` and a vendor directory this never looked in.
pub const SERVICES: &str = "/etc/pam.d";

/// Linux-PAM's soname. `pam_start_confdir` is 1.4 (2020) and later.
const LIBRARY: &str = "libpam.so.0";

// `security/_pam_types.h`, which is not on every machine this builds on — the
// numbers are Linux-PAM's ABI and have not moved.
const PAM_SUCCESS: c_int = 0;
const PAM_BUF_ERR: c_int = 5;
const PAM_AUTH_ERR: c_int = 7;
const PAM_CONV_ERR: c_int = 19;
const PAM_PROMPT_ECHO_OFF: c_int = 1;
const PAM_PROMPT_ECHO_ON: c_int = 2;
const PAM_ERROR_MSG: c_int = 3;
const PAM_TEXT_INFO: c_int = 4;

/// Why a desk that asked for PAM cannot have it. Each is fatal at startup: see
/// `crate::lock::chosen`.
#[derive(Debug, Error)]
pub enum NoPam {
    #[error(
        "lock.pam_service is {service:?}, and there is no {} for PAM to read it from, so \
         this desk has nothing to open it with. The machine has to declare the service -- \
         on NixOS, `security.pam.services.{service} = {{}};` in its system configuration, \
         which a home-manager module cannot do",
        file.display()
    )]
    Service { service: String, file: PathBuf },

    #[error(
        "lock.pam_service is set, and {library} would not load, so this desk has nothing \
         to open it with: {source}"
    )]
    Library {
        library: String,
        #[source]
        source: libloading::Error,
    },

    #[error(
        "{library} loaded but has no {symbol}: it is not Linux-PAM, or it is one older than \
         1.4"
    )]
    Symbol {
        library: String,
        symbol: &'static str,
        #[source]
        source: libloading::Error,
    },

    #[error(
        "this desk runs as uid {uid}, which the password database has no user for, so there \
         is nobody for PAM to authenticate"
    )]
    User { uid: libc::uid_t },
}

/// PAM, for the user this process runs as, through one service.
pub struct Pam {
    libpam: Libpam,
    service: CString,
    /// The service's file, looked for before every attempt — see this module's
    /// note.
    file: PathBuf,
    confdir: CString,
    user: CString,
}

impl Pam {
    /// PAM through `service`, read from `confdir` — [`SERVICES`] on a real
    /// desk — for the user this process runs as.
    ///
    /// **THE USER IS THE PROCESS'S**, from `getuid` and the password database,
    /// and never `$USER`: an environment is something whoever started this
    /// process chose, and a lock that authenticated the user it was told to
    /// would open to anybody who could start it with their own name.
    pub fn for_this_user(service: &str, confdir: &Path) -> Result<Pam, NoPam> {
        let file = service_file(service, confdir)?;
        // SAFETY: `getuid` cannot fail and touches nothing.
        let user = user_named_by(unsafe { libc::getuid() })?;
        Ok(Pam {
            libpam: Libpam::load(LIBRARY)?,
            service: CString::new(service)
                .expect("a service with a NUL in it has no file, which was refused above"),
            file,
            confdir: CString::new(confdir.as_os_str().as_encoded_bytes())
                .expect("a directory with a NUL in it has no file in it, which was refused above"),
            user,
        })
    }
}

impl Verifier for Pam {
    /// `pam_authenticate`, on the thread `crate::lock` checks on — it may sleep
    /// a couple of seconds on a wrong password, which is PAM's to decide.
    ///
    /// **ONLY `PAM_AUTH_ERR` IS A REFUSAL.** Every other failure — a module
    /// missing, a helper that would not run, a user PAM does not know — is a
    /// desk that cannot be opened, which is an error and not a person who
    /// mistyped.
    ///
    /// **THE PASSPHRASE IS COPIED ONCE**, into the `malloc` each prompt's
    /// answer is: PAM owns that copy, and Linux-PAM overwrites a password it
    /// is handed before it frees it. Nothing on this side makes another.
    fn opens_the_desk(&self, passphrase: &Passphrase) -> Verdict {
        let typed = passphrase.as_str();
        if typed.contains('\0') {
            // What C would see is the part before the NUL, which is a second
            // passphrase that opens the desk. No password has a NUL in it.
            Ok(false)
        } else if !self.file.exists() {
            Err(CouldNotCheck(format!(
                "there is no {} any more, and PAM would answer with its `other` service \
                 instead",
                self.file.display()
            )))
        } else {
            self.libpam.authenticate(self, typed)
        }
    }
}

/// The four entry points of libpam this uses, and the library that keeps them
/// valid.
struct Libpam {
    start: PamStartConfdir,
    authenticate: PamAuthenticate,
    end: PamEnd,
    strerror: PamStrerror,
    /// Held so the four above stay mapped. Never read.
    _library: Library,
}

type PamStartConfdir = unsafe extern "C" fn(
    service: *const c_char,
    user: *const c_char,
    conversation: *const PamConv,
    confdir: *const c_char,
    handle: *mut *mut c_void,
) -> c_int;
type PamAuthenticate = unsafe extern "C" fn(handle: *mut c_void, flags: c_int) -> c_int;
type PamEnd = unsafe extern "C" fn(handle: *mut c_void, status: c_int) -> c_int;
type PamStrerror = unsafe extern "C" fn(handle: *mut c_void, status: c_int) -> *const c_char;

impl Libpam {
    fn load(library: &str) -> Result<Libpam, NoPam> {
        // SAFETY: loading a library runs its initializers; libpam's are
        // Linux-PAM's own and this is the library every lock screen links.
        let loaded = unsafe { Library::new(library) }.map_err(|source| NoPam::Library {
            library: library.to_string(),
            source,
        })?;
        // SAFETY: each type above is the prototype in `security/pam_appl.h`.
        let (start, authenticate, end, strerror) = unsafe {
            (
                symbol::<PamStartConfdir>(&loaded, library, "pam_start_confdir")?,
                symbol::<PamAuthenticate>(&loaded, library, "pam_authenticate")?,
                symbol::<PamEnd>(&loaded, library, "pam_end")?,
                symbol::<PamStrerror>(&loaded, library, "pam_strerror")?,
            )
        };
        Ok(Libpam {
            start,
            authenticate,
            end,
            strerror,
            _library: loaded,
        })
    }

    /// One `pam_start_confdir`, `pam_authenticate` and `pam_end`.
    fn authenticate(&self, pam: &Pam, typed: &str) -> Verdict {
        let conversation = PamConv {
            conv: converse,
            appdata_ptr: &typed as *const &str as *mut c_void,
        };
        let mut handle = ptr::null_mut();
        // SAFETY: every pointer is a live NUL-terminated string or the
        // conversation above, which outlives the handle -- `pam_end` is below.
        let started = unsafe {
            (self.start)(
                pam.service.as_ptr(),
                pam.user.as_ptr(),
                &conversation,
                pam.confdir.as_ptr(),
                &mut handle,
            )
        };
        if started == PAM_SUCCESS {
            // SAFETY: a handle `pam_start_confdir` gave, ended once, here.
            let authenticated = unsafe { (self.authenticate)(handle, 0) };
            unsafe { (self.end)(handle, authenticated) };
            match authenticated {
                PAM_SUCCESS => Ok(true),
                PAM_AUTH_ERR => Ok(false),
                failed => Err(self.failure("pam_authenticate", failed)),
            }
        } else {
            // No handle to end: Linux-PAM frees its own on a failed start.
            Err(self.failure("pam_start_confdir", started))
        }
    }

    fn failure(&self, call: &str, status: c_int) -> CouldNotCheck {
        // SAFETY: Linux-PAM's `pam_strerror` ignores the handle and answers a
        // static string for every status, known or not.
        let said = unsafe { CStr::from_ptr((self.strerror)(ptr::null_mut(), status)) };
        CouldNotCheck(format!(
            "{call} failed with {status}: {}",
            said.to_string_lossy()
        ))
    }
}

/// One entry point out of `library`, or which one it lacks.
///
/// # Safety
///
/// `T` has to be the entry point's real type.
unsafe fn symbol<T: Copy>(loaded: &Library, library: &str, name: &'static str) -> Result<T, NoPam> {
    loaded
        .get::<T>(name.as_bytes())
        .map(|found| *found)
        .map_err(|source| NoPam::Symbol {
            library: library.to_string(),
            symbol: name,
            source,
        })
}

/// The file `service` is read from, or why a desk that named it does not come
/// up.
fn service_file(service: &str, confdir: &Path) -> Result<PathBuf, NoPam> {
    let file = confdir.join(service);
    if file.exists() {
        Ok(file)
    } else {
        Err(NoPam::Service {
            service: service.to_string(),
            file,
        })
    }
}

/// The name the password database gives `uid`.
fn user_named_by(uid: libc::uid_t) -> Result<CString, NoPam> {
    // SAFETY: all-zero is a valid `passwd` -- null pointers and zero ids -- and
    // it is only read after `getpwuid_r` has filled it.
    let mut entry: libc::passwd = unsafe { std::mem::zeroed() };
    let mut storage = vec![0 as c_char; 16 * 1024];
    let mut found = ptr::null_mut();
    // SAFETY: every pointer is to storage above that outlives the call, and
    // `storage.len()` is its length.
    unsafe {
        libc::getpwuid_r(
            uid,
            &mut entry,
            storage.as_mut_ptr(),
            storage.len(),
            &mut found,
        )
    };
    if found.is_null() {
        Err(NoPam::User { uid })
    } else {
        // SAFETY: a found entry's name points into `storage`, NUL-terminated.
        Ok(unsafe { CStr::from_ptr(entry.pw_name) }.to_owned())
    }
}

#[repr(C)]
struct PamConv {
    conv: extern "C" fn(
        count: c_int,
        messages: *mut *const PamMessage,
        responses: *mut *mut PamResponse,
        appdata: *mut c_void,
    ) -> c_int,
    appdata_ptr: *mut c_void,
}

#[repr(C)]
struct PamMessage {
    msg_style: c_int,
    msg: *const c_char,
}

#[repr(C)]
struct PamResponse {
    resp: *mut c_char,
    resp_retcode: c_int,
}

/// The conversation: what PAM asks the person at the desk, answered with what
/// they typed.
///
/// Every prompt, echoed or not, gets the passphrase. A message — an error or a
/// notice from a module, `"Your password expires in 3 days"` — gets no answer
/// and goes in the log, where somebody locked out of their desk will look. A
/// style this does not know ends the conversation before anything is
/// allocated, so there is nothing to hand back half-built.
///
/// `appdata` is a `&&str`: the passphrase, borrowed for as long as the handle
/// it was started with lives.
extern "C" fn converse(
    count: c_int,
    messages: *mut *const PamMessage,
    responses: *mut *mut PamResponse,
    appdata: *mut c_void,
) -> c_int {
    let count = usize::try_from(count).expect("PAM asks a non-negative number of questions");
    // SAFETY: Linux-PAM hands `count` pointers to messages, each with a
    // NUL-terminated text, and `appdata` is what `authenticate` put there.
    let (asked, typed) = unsafe {
        (
            (0..count)
                .map(|each| &**messages.add(each))
                .collect::<Vec<&PamMessage>>(),
            *(appdata as *const &str),
        )
    };
    let known = asked.iter().all(|message| {
        matches!(
            message.msg_style,
            PAM_PROMPT_ECHO_OFF | PAM_PROMPT_ECHO_ON | PAM_ERROR_MSG | PAM_TEXT_INFO
        )
    });
    if !known {
        PAM_CONV_ERR
    } else {
        // SAFETY: PAM frees what it is handed with `free`, so it is allocated
        // with `calloc` and `malloc`; each answer is `typed` and its NUL.
        unsafe {
            let answers =
                libc::calloc(count, std::mem::size_of::<PamResponse>()).cast::<PamResponse>();
            if answers.is_null() {
                PAM_BUF_ERR
            } else {
                for (each, message) in asked.iter().enumerate() {
                    let text = CStr::from_ptr(message.msg).to_string_lossy();
                    match message.msg_style {
                        PAM_ERROR_MSG => warn!(said = %text, "PAM, on unlocking this desktop"),
                        PAM_TEXT_INFO => info!(said = %text, "PAM, on unlocking this desktop"),
                        _ => (*answers.add(each)).resp = answer(typed),
                    }
                }
                *responses = answers;
                PAM_SUCCESS
            }
        }
    }
}

/// `typed` and a NUL, in a `malloc` for PAM to free. Null if there was no
/// memory, which PAM reads as no answer.
///
/// # Safety
///
/// `typed` has no NUL in it — `opens_the_desk` refuses one that does.
unsafe fn answer(typed: &str) -> *mut c_char {
    let copy = libc::malloc(typed.len() + 1).cast::<c_char>();
    if !copy.is_null() {
        ptr::copy_nonoverlapping(typed.as_ptr().cast::<c_char>(), copy, typed.len());
        *copy.add(typed.len()) = 0;
    }
    copy
}

#[cfg(test)]
mod tests {
    use std::ffi::{c_int, c_void, CStr};
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;
    use std::ptr;

    use domicile_protocol::Passphrase;
    use tempfile::TempDir;

    use super::{
        converse, user_named_by, Libpam, NoPam, Pam, PamMessage, PamResponse, LIBRARY,
        PAM_CONV_ERR, PAM_SUCCESS,
    };
    use crate::lock::{CouldNotCheck, Verifier};

    /// The one service every test here reads: its own, in a directory of its
    /// own, so nothing depends on what the machine's `/etc/pam.d` says.
    const SERVICE: &str = "domicile-test";

    /// A PAM service that takes one word, from this process's own user, and
    /// refuses everything else.
    ///
    /// **REAL PAM, WITH THE PASSWORD CHECK SWAPPED FOR A SCRIPT.** `pam_unix`
    /// would need a real user's real password, which no runner has; `pam_exec`
    /// with `expose_authtok` is the stock module that asks the conversation for
    /// a password exactly the way `pam_unix` does and hands it to a program.
    /// So what is proven here is everything but `pam_unix` itself: libpam
    /// loaded, the service read out of the directory given, the user this
    /// process is, the conversation answering the prompt with what was typed,
    /// and the verdict read back off `pam_authenticate`.
    ///
    /// The stack is Debian's `common-auth` in miniature: the script succeeding
    /// skips the deny, and anything else falls on it.
    fn a_service_that_takes(word: &str) -> (TempDir, Pam) {
        let confdir = tempfile::tempdir().expect("a directory");
        let script = confdir.path().join("check");
        // Builtins only: `pam_exec` runs this with no `PATH`. `read` sets the
        // variable and fails at an end with no newline, which is what
        // `pam_exec` sends, so its status is not the verdict -- the tests are.
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\nIFS= read -r typed\n[ \"$typed\" = '{word}' ] && [ \"$PAM_USER\" = '{}' ]\n",
                this_user_says_id()
            ),
        )
        .expect("the script");
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
            .expect("the script runs");
        std::fs::write(
            confdir.path().join(SERVICE),
            format!(
                "auth [success=1 default=ignore] pam_exec.so expose_authtok quiet {}\n\
                 auth requisite pam_deny.so\n\
                 auth required pam_permit.so\n",
                script.display()
            ),
        )
        .expect("the service");
        let pam = Pam::for_this_user(SERVICE, confdir.path()).expect("PAM, for this user");
        (confdir, pam)
    }

    /// Who this process runs as, asked of something other than the code under
    /// test.
    fn this_user_says_id() -> String {
        let ran = Command::new("id").arg("-un").output().expect("`id` runs");
        String::from_utf8(ran.stdout)
            .expect("a user name")
            .trim()
            .to_string()
    }

    #[test]
    fn the_word_the_service_takes_opens_the_desk_and_another_does_not() {
        let (_confdir, pam) = a_service_that_takes("friend");
        assert_eq!(pam.opens_the_desk(&Passphrase::from("friend")), Ok(true));
        assert_eq!(pam.opens_the_desk(&Passphrase::from("enemy")), Ok(false));
    }

    #[test]
    fn a_passphrase_with_a_nul_in_it_is_not_the_one_before_the_nul() {
        // PAM's side is C, so a passphrase reaches it as far as its first NUL.
        // Handed over as it is, `friend\0anything` would be `friend` -- a
        // second passphrase that opens the desk. No password has a NUL in it,
        // so one that does is not the password.
        let (_confdir, pam) = a_service_that_takes("friend");
        assert_eq!(
            pam.opens_the_desk(&Passphrase::from("friend\0anything")),
            Ok(false)
        );
    }

    #[test]
    fn a_stack_pam_cannot_run_is_an_error_and_not_a_refusal() {
        // A module that is not there is a desk nobody can open, which is not
        // the same thing as somebody who mistyped -- and the difference is the
        // line in the log that says which.
        let confdir = tempfile::tempdir().expect("a directory");
        std::fs::write(
            confdir.path().join(SERVICE),
            "auth required pam_domicile_no_such_module.so\n",
        )
        .expect("the service");
        let pam = Pam::for_this_user(SERVICE, confdir.path()).expect("PAM, for this user");

        let Err(CouldNotCheck(why)) = pam.opens_the_desk(&Passphrase::from("friend")) else {
            panic!("a stack that cannot run is not a verdict");
        };
        assert!(
            why.contains("pam_authenticate"),
            "it says what failed: {why}"
        );
    }

    #[test]
    fn a_service_removed_under_a_running_desk_is_an_error_and_not_pam_s_other() {
        // PAM READS THE SERVICE ON EVERY ATTEMPT, and one it cannot find is
        // answered with the `other` stack -- on NixOS a deny, which would be
        // reported here as a wrong passphrase to somebody who typed the right
        // one. So the file is looked for every time, and its absence is said.
        let (confdir, pam) = a_service_that_takes("friend");
        std::fs::remove_file(confdir.path().join(SERVICE)).expect("the service goes");
        std::fs::write(
            confdir.path().join("other"),
            "auth required pam_permit.so\n",
        )
        .expect("and `other` would let anybody in");

        let Err(CouldNotCheck(why)) = pam.opens_the_desk(&Passphrase::from("enemy")) else {
            panic!("a service that went away is not a verdict, and not `other`'s");
        };
        assert!(
            why.contains(&confdir.path().join(SERVICE).display().to_string()),
            "it names the file: {why}"
        );
    }

    #[test]
    fn a_machine_without_libpam_is_said_by_name() {
        let Err(NoPam::Library { library, .. }) = Libpam::load("libdomicile-no-such-pam.so.0")
        else {
            panic!("a library that is not there is refused");
        };
        assert_eq!(library, "libdomicile-no-such-pam.so.0");
    }

    #[test]
    fn a_library_that_is_not_libpam_is_said_by_what_it_lacks() {
        // libc is on every machine this runs on, and it is not PAM.
        let Err(NoPam::Symbol { symbol, .. }) = Libpam::load("libc.so.6") else {
            panic!("a library with no PAM in it is refused");
        };
        assert_eq!(symbol, "pam_start_confdir");
        assert!(Libpam::load(LIBRARY).is_ok(), "and the real one loads");
    }

    #[test]
    fn a_uid_with_no_user_is_said_rather_than_guessed() {
        // THE USER IS THE PROCESS'S, and never an environment variable a
        // caller could set -- so one the password database does not know is a
        // desk with nobody to authenticate, not a desk that asks for `$USER`.
        let nobody_has_this = 0xFFFF_FFF0;
        let Err(NoPam::User { uid }) = user_named_by(nobody_has_this) else {
            panic!("a uid with no entry has no name");
        };
        assert_eq!(uid, nobody_has_this);
        assert_eq!(
            user_named_by(0)
                .expect("uid 0 has a name")
                .to_str()
                .unwrap(),
            "root"
        );
    }

    #[test]
    fn a_prompt_is_answered_with_what_was_typed_and_a_message_is_not() {
        // Echoed or not, a prompt gets the passphrase -- `pam_exec` above asks
        // with echo off, and a module that asks with it on is asking the same
        // person the same question. A message is something to say, not a
        // question, and PAM wants no answer to it.
        let typed = "friend";
        let messages = [
            message(super::PAM_PROMPT_ECHO_OFF, text(b"Password: \0")),
            message(super::PAM_TEXT_INFO, text(b"Welcome\0")),
            message(super::PAM_ERROR_MSG, text(b"Your account is fine\0")),
            message(super::PAM_PROMPT_ECHO_ON, text(b"Token: \0")),
        ];
        let (said, answers) = conversation(&messages, typed);
        assert_eq!(said, PAM_SUCCESS);
        assert_eq!(
            answers,
            [Some(typed.into()), None, None, Some(typed.into())]
        );
    }

    #[test]
    fn a_question_this_cannot_answer_ends_the_conversation() {
        // `PAM_BINARY_PROMPT` is Linux-PAM's style for a module speaking to a
        // client-side agent, and there is none here to answer it.
        const PAM_BINARY_PROMPT: c_int = 7;
        let messages = [
            message(super::PAM_PROMPT_ECHO_OFF, text(b"Password: \0")),
            message(PAM_BINARY_PROMPT, text(b"\0")),
        ];
        let (said, answers) = conversation(&messages, "friend");
        assert_eq!(said, PAM_CONV_ERR);
        assert!(answers.is_empty(), "and nothing is handed back to free");
    }

    fn message(style: c_int, text: &'static CStr) -> PamMessage {
        PamMessage {
            msg_style: style,
            msg: text.as_ptr(),
        }
    }

    fn text(bytes: &'static [u8]) -> &'static CStr {
        CStr::from_bytes_with_nul(bytes).expect("a C string")
    }

    /// Run the conversation over `messages` the way libpam would, and take
    /// back what it answered -- freeing what it allocated, as libpam does.
    fn conversation(messages: &[PamMessage], typed: &str) -> (c_int, Vec<Option<String>>) {
        let mut pointers: Vec<*const PamMessage> =
            messages.iter().map(|m| m as *const PamMessage).collect();
        let mut responses: *mut PamResponse = ptr::null_mut();
        let typed: &str = typed;
        let said = converse(
            c_int::try_from(messages.len()).unwrap(),
            pointers.as_mut_ptr(),
            &mut responses,
            &typed as *const &str as *mut c_void,
        );
        let answers = if responses.is_null() {
            Vec::new()
        } else {
            // SAFETY: the conversation hands back one response per message,
            // each either null or a NUL-terminated `malloc`, in a `calloc`.
            let answers = (0..messages.len())
                .map(|each| unsafe {
                    let answer = (*responses.add(each)).resp;
                    let read = (!answer.is_null())
                        .then(|| CStr::from_ptr(answer).to_str().unwrap().to_string());
                    libc::free(answer.cast());
                    read
                })
                .collect();
            unsafe { libc::free(responses.cast()) };
            answers
        };
        (said, answers)
    }
}
