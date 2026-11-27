# Tab completion for `domicile` in nushell, from `domicile completions nushell`.
# `domicile completions --complete` says what can go where the cursor is.
# Packages put it in a vendor autoload directory, so nushell loads it itself.
#
# It is an external completer, wrapping any completer set before it, since
# nushell only offers a command's declared flags to a custom completer.
let domicile_completer_before = ($env.config.completions?.external?.completer?)

$env.config.completions.external.enable = true
$env.config.completions.external.completer = {|spans|
  if ($spans | first) != "domicile" {
    if $domicile_completer_before == null { null } else { do $domicile_completer_before $spans }
  } else {
    let said = (
      ^domicile completions $"--complete=($spans | last)" ...($spans | skip 1 | drop 1)
      | complete | get stdout | lines
    )
    match ($said | first) {
      "values" => ($said | skip 1 | each {|line|
        let parts = ($line | split row -n 2 "\t")
        { value: ($parts | first), description: ($parts | get -o 1 | default "") }
      })
      # Files and directories: nushell completes paths itself.
      _ => null
    }
  }
}
