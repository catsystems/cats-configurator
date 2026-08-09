# CATS Configurator repository instructions

## Commit and publishing discipline

- Use a descriptive, imperative subject that explains the outcome of the
  change. Do not use a version-only release subject.
- For every non-trivial or release commit, include a body that explains the
  motivation, the important user-visible or architectural changes, and the
  verification performed.
- Inspect the complete staged diff before committing and stage only intended
  repository files.
- When rewriting local history, retarget affected local tags and verify that
  commit trees remain unchanged.
- Never force-push, push, publish, or create a public release unless the user
  explicitly authorizes that action.
