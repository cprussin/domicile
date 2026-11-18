# Runs one desktop's benchmark: every workload, a fresh boot per run.
# Usage: benchmark <desktop> <driver> <output directory> [runs]
# Writes <output directory>/<desktop>-<workload>-<run>.run.json and each
# run's screenshots. Slack's workloads need BENCH_SLACK_WORKSPACE,
# BENCH_SLACK_EMAIL and BENCH_SLACK_PASSWORD.
desktop=$1
driver=$2
out=$(realpath -m "$3")
runs=${4:-3}

workloads=(rest chat-and-web chat-web-and-editor)
if [ "$desktop" = console ]; then
  workloads=(rest)
fi

mkdir -p "$out"
BENCH_SLACK_STATE="$(mktemp -d)/slack-state.json"
export BENCH_SLACK_STATE

# A failed run is reported at the end, so the other runs still measure.
failed=()
for workload in "${workloads[@]}"; do
  for run in $(seq "$runs"); do
    name="$desktop-$workload-$run"
    link=""
    if [ "$workload" != rest ]; then
      link=$(slack-magic-link)
    fi
    echo "=== $name"
    if ! BENCH_SLACK_LINK="$link" BENCH_WORKLOAD="$workload" BENCH_RUN="$run" \
      BENCH_RESULT="$out/$name.run.json" \
      "$driver/bin/nixos-test-driver" --output_directory "$out/$name"; then
      failed+=("$name")
    fi
  done
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "failed: ${failed[*]}" >&2
  exit 1
fi
