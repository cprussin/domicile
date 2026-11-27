# Tab completion for `domicile` in bash, from `domicile completions bash`.
# `domicile completions --complete` says what can go where the cursor is.
_domicile() {
  local current="${COMP_WORDS[COMP_CWORD]}" kind line
  local -a said values
  mapfile -t said < <(domicile completions "--complete=$current" "${COMP_WORDS[@]:1:COMP_CWORD-1}" 2>/dev/null)
  kind="${said[0]}"
  case "$kind" in
    files)
      compopt -o filenames 2>/dev/null
      mapfile -t COMPREPLY < <(compgen -f -- "$current")
      ;;
    directories)
      compopt -o filenames 2>/dev/null
      mapfile -t COMPREPLY < <(compgen -d -- "$current")
      ;;
    values)
      for line in "${said[@]:1}"; do
        values+=("${line%%$'\t'*}")
      done
      COMPREPLY=("${values[@]}")
      ;;
  esac
}
complete -F _domicile domicile
