#!/usr/bin/env bash
# Vercel's Ignored Build Step: exit 0 skips the deployment, 1 builds it.
# Builds production only, since every build costs. Checks the branch too, in
# case Vercel leaves `VERCEL_ENV` out of this step.
echo "VERCEL_ENV=${VERCEL_ENV:-} VERCEL_GIT_COMMIT_REF=${VERCEL_GIT_COMMIT_REF:-}"
if [ "${VERCEL_ENV:-}" = production ] || [ "${VERCEL_GIT_COMMIT_REF:-}" = stable ]; then
  echo "production: building"
  exit 1
fi
echo "not production: skipping"
exit 0
