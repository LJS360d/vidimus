# Contributing

```sh
pnpm install
pnpm run check        # lint, types, knip, tests with coverage, build, publint, attw
pnpm run smoke        # pack, install in a scratch project without peers, run the CLI and tsc
pnpm changeset        # describe your change for the changelog
pnpm run docs:dev     # docs site (VitePress flavor) at localhost:5173/vidimus/
pnpm run build && pnpm run docs:build && pnpm run docs:audit   # build all six flavors, audit them with vidimus
```

Tool versions are pinned in `mise.toml`, including the non-npm docs generators (Hugo, Zola,
mdBook): `mise install`. The docs markdown in `docs/` is shared by all six flavors: keep it to
CommonMark, GFM tables and fenced code, and link pages as `./page` without `.md`; see
`docs/flavors.md`. Code has no comments by convention; biome formats it.
Every finding an audit reports needs a `fix`.

`schema.json` is generated from the config types by the build (`pnpm run schema` alone); it is not committed.

Releases are automatic: every push to `main` runs the checks, turns pending changesets into a
version bump and `CHANGELOG.md` entry, commits and tags that, and publishes to npm with
provenance. See `.changeset/README.md`.

To release by hand (needs `npm login`):

```sh
pnpm run bump         # apply pending changesets: version + CHANGELOG.md
git commit -am "chore(release): vX.Y.Z" && git push
pnpm run release      # smoke test, full check, publish to npm, push the tag
```
