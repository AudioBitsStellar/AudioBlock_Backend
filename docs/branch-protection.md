# Branch Protection Rules for `main`

This repository should enforce the following branch protection rules on `main`:

- Require at least 1 approval from a pull request reviewer.
- Require all CI checks to pass before merging, including `lint`, `test`, and `build`.
- Require branches to be up-to-date with `main` before merge.
- Prevent direct pushes to `main`; all changes must come through pull requests.
- Enable stale review dismissal so reviews are refreshed when code changes.
- Allow admin override only for emergency situations.

These rules are documented here and should be configured in GitHub repository settings under Branch Protection Rules.
