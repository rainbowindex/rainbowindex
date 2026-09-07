## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem it solves. For a behavior change, say what breaks and for whom. -->

## Checklist

- [ ] `pnpm check` passes locally
- [ ] Tests cover the change (a failing test first, where that makes sense)
- [ ] Changelog entry added under `## [Unreleased]` in `CHANGELOG.md`
- [ ] Docs updated (`docs/`, `README.md`) if the public surface moved
- [ ] Golden fixtures regenerated with `pnpm test:golden:update`, and the
      `expected.css` diff is intentional — or emitted CSS is unchanged
- [ ] No `version` bump (releases are the maintainer's)
