#!/usr/bin/env bash
# Local test run recorded by adahandle-deployments/common/test-evidence.sh (replaces the old Actions tests).
set -euo pipefail
( set -e; npm ci )
( set -e; npm run lint )
( set -e; npm run build )
( set -e; npm test -- --coverage --runInBand --config scripts/jest-coverage.config.cjs
  node --test scripts/verify-npm-publish.test.cjs )
