# Changesets

Add one changeset for every pull request that changes the published package:

```bash
npm run changeset
```

Choose patch, minor, or major and write a user-facing summary. Documentation,
CI, and repository-only changes may use the `release:skip` pull-request label.

The repository is currently in Changesets prerelease mode with the `next` tag.
Merging feature pull requests updates the automated version PR.
Merging that release PR publishes npm, pushes the version tag, and creates the
GitHub release.
