# Next ESLint directory-glob compatibility adapter

This local development dependency replaces only the `fast-glob` dependency
used by the pinned Next ESLint plugin, which calls the named `globSync`
export with `onlyDirectories: true` to resolve `settings.next.rootDir`.
It is not a general replacement for fast-glob.

The implementation uses tinyglobby with directory expansion disabled.
Tests in `test/dependencyOverrides.test.ts` exercise Next's actual root
resolver and Mammoth's actual CLI to check the dependency overrides.

The root package.json overrides avoid two unpatched dependency chains:

- https://github.com/advisories/GHSA-vfj7-8cjw-p6xm (braces via fast-glob)
- https://github.com/advisories/GHSA-hp3w-g68c-fv3c (sprintf-js via argparse)

Mammoth uses argparse 2.0.1, which retains its legacy CLI API without sprintf-js.
Remove these overrides when upstream no longer needs the affected packages.
