# Which of the two published engines `nix build .#engine` fetches.
#
# Every series is published twice. The CHECKED build (`engine-release.nix`) is
# the one a pull request proves and repins: DCHECKs on, no PGO, minutes to
# build. The OFFICIAL build (`engine-official.nix`) is what engine-release.yml
# makes nightly from main: PGO, ThinLTO, no DCHECKs, and noticeably faster. It is
# the one to run -- but it lands up to a day after a merge, and until it does the
# official pin still names the PREVIOUS series.
#
# So the official engine is taken only when it is of the checked pin's series,
# which is the series `scripts/test-the-pinned-engine-is-this-series.sh` holds
# to the fork in this tree. Otherwise the checked one: slower, and never
# missing a patch the tree has.
#
# The `stable` branch is the newest main for which this picks the official
# engine; stable.yml moves it (.github/scripts/promote-stable.sh).
{ checked, official ? null }:
if official != null && official.identity == checked.identity then official else checked
