# Tab completion for `domicile` in elvish, from `domicile completions elvish`.
# `domicile completions --complete` says what can go where the cursor is.
use path
use str
set edit:completion:arg-completer[domicile] = {|@words|
  var current = $words[-1]
  var before = $words[1..(- (count $words) 1)]
  var said = [(domicile completions '--complete='$current $@before 2>/dev/null)]
  if (== (count $said) 0) {
    return
  }
  if (eq $said[0] files) {
    edit:complete-filename $current
  } elif (eq $said[0] directories) {
    edit:complete-filename $current | each {|candidate|
      if (path:is-dir $candidate[stem]) { put $candidate }
    }
  } else {
    for line $said[1..] {
      var value about = (str:split &max=2 "\t" $line)
      edit:complex-candidate $value &display=(styled-segment $value)' '(styled-segment $about &dim)
    }
  }
}
