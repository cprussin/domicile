//! A shell command's usage, as `list-shell-commands` prints it, read for
//! completion: `focus left|right|up|down`, `fullscreen toggle [global]`,
//! `workspace <name>`. Words are split on spaces; `a|b` is a choice, `[...]`
//! an optional word and `<name>` a value to fill in.

/// One choice for a word of a usage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Word {
    /// Typed as it is.
    Literal(String),
    /// A value, by the name between its angle brackets: `name` for `<name>`,
    /// `width` for `<width>x<height>`.
    Placeholder(String),
}

/// A word of a usage: its choices, and whether it may be left out.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Slot {
    optional: bool,
    choices: Vec<Word>,
}

/// The words of `usage`.
fn slots(usage: &str) -> Vec<Slot> {
    usage
        .split_whitespace()
        .map(|said| {
            let inner = said
                .strip_prefix('[')
                .and_then(|said| said.strip_suffix(']'));
            Slot {
                optional: inner.is_some(),
                choices: inner.unwrap_or(said).split('|').map(word).collect(),
            }
        })
        .collect()
}

/// One choice, as said in a usage.
fn word(said: &str) -> Word {
    match said
        .split_once('<')
        .and_then(|(_, after)| after.split_once('>'))
    {
        Some((name, _)) => Word::Placeholder(name.to_string()),
        None => Word::Literal(said.to_string()),
    }
}

/// What can come after `typed` in a command `usage` describes, or nothing
/// when `typed` is not the start of one.
pub fn next_words(usage: &str, typed: &[String]) -> Vec<Word> {
    let mut next = Vec::new();
    follow(&slots(usage), typed, &mut next);
    next
}

/// Adds to `next` what can come after `typed` in `slots`.
fn follow(slots: &[Slot], typed: &[String], next: &mut Vec<Word>) {
    let Some((slot, later)) = slots.split_first() else {
        return;
    };
    match typed.split_first() {
        None => {
            for choice in &slot.choices {
                if !next.contains(choice) {
                    next.push(choice.clone());
                }
            }
        }
        Some((said, rest)) => {
            if slot.choices.iter().any(|choice| fits(choice, said)) {
                follow(later, rest, next);
            }
        }
    }
    if slot.optional {
        follow(later, typed, next);
    }
}

/// `said` is `choice`, or a value for it.
fn fits(choice: &Word, said: &str) -> bool {
    match choice {
        Word::Literal(word) => word == said,
        Word::Placeholder(_) => true,
    }
}
