# The captions a recording shows: a pill at the foot of the video naming each
# key a scene pressed, as `caption` in `lib.sh` wrote them down. Sourced by
# `docs-media.sh`, which compresses the recordings.

# Seconds a caption shows before the key it names takes effect: the recording
# starts a moment after `record_start` notes the time, and the desktop answers
# a key a moment after it is pressed.
CAPTION_LEAD=0.3
# Longest a caption stays.
CAPTION_SECONDS=2.2
# Gap between one caption going and the next coming.
CAPTION_GAP=0.15

# Prints the ffmpeg filter that draws the captions in `$1` (lines of
# `<seconds>\t<text>`) in the font `$2`, writing each text to `$3`, since
# drawtext reads it from a file unescaped.
caption_filter() { # captions file, font file, directory
  awk -F '\t' -v font="$2" -v dir="$3" -v lead="$CAPTION_LEAD" \
    -v seconds="$CAPTION_SECONDS" -v gap="$CAPTION_GAP" '
    { at[NR] = $1 - lead < 0 ? 0 : $1 - lead; text[NR] = $2 }
    END {
      for (i = 1; i <= NR; i++) {
        file = dir "/caption-" i ".txt"
        printf "%s", text[i] > file
        close(file)
        start = at[i]
        end = start + seconds
        if (i < NR && at[i + 1] - gap < end) end = at[i + 1] - gap
        fade = "if(lt(t," start + 0.15 "),(t-" start ")/0.15,if(gt(t," end - 0.15 "),(" end "-t)/0.15,1))"
        printf "%sdrawtext=fontfile=%s:textfile=%s:expansion=none:fontsize=34:fontcolor=white:box=1:boxcolor=0x16161e@0.85:boxborderw=18|30:x=(w-text_w)/2:y=h-text_h-72:alpha=%s:enable=%s", \
          (i > 1 ? "," : ""), font, file, \
          "'\''" fade "'\''", \
          "'\''between(t," sprintf("%.2f", start) "," sprintf("%.2f", end) ")'\''"
      }
    }
  ' "$1"
}
