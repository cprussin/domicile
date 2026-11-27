# Tab completion for `domicile` in fish, from `domicile completions fish`.
# `domicile completions --complete` says what can go where the cursor is.
function __domicile_complete
    set -l words (commandline -opc)[2..]
    set -l current (commandline -ct)
    set -l said (domicile completions "--complete=$current" $words 2>/dev/null)
    switch "$said[1]"
        case files
            __fish_complete_path $current
        case directories
            __fish_complete_directories $current
        case values
            printf '%s\n' $said[2..]
    end
end
complete -c domicile -f -a '(__domicile_complete)'
