# Legacy test suites

The `*.legacy.mjs` files are retained as migration references and are not part
of the active Node test suite. They target an earlier Prisma-based application
and depend on Mocha, Chai, or Jest packages that the current PostgreSQL/Node
implementation does not use.

Do not re-enable these files by renaming them to `*.test.mjs` until their data
access, schemas, assertions, and test-runner APIs have been migrated to the
current implementation. Current exchange behavior is covered by the active
`*.test.mjs` suites discovered by `server/test-runner.mjs`.
