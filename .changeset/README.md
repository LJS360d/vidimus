# Changesets

Every change that users of the package can notice needs a changeset:

```sh
pnpm changeset
```

Pick the bump (`patch` for fixes, `minor` for features, `major` for breaking changes; while
the version is `0.x`, breaking changes are `minor`), write one or two sentences for the
changelog, and commit the generated file with the change.

On every push to `main`, the release workflow turns pending changesets into a version bump
and `CHANGELOG.md` entry, commits that, tags it and publishes the package to npm. To do the
same by hand: `pnpm run bump`, commit and push, then `pnpm run release`.
