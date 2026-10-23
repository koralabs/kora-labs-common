# Kora Labs Common Utilities

## Contributor test policy

All tests are local-only by owner directive. Preserve local test scripts. GitHub Actions must not run tests directly or indirectly through lifecycle hooks, composites, shared helpers, or renamed commands. Build, lint, publish, deployment, and production dispatch guards remain allowed; obsolete test-only required checks must be removed without weakening unrelated protections.

## Documentation
- [Docs Index](./docs/index.md)
- [Product Docs](./docs/product/index.md)
- [Spec Docs](./docs/spec/index.md)

## Local Validation
- `npm test`
- `./test_coverage.sh`
