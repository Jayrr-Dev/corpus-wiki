"use strict";

// Next loads this adapter synchronously from its CommonJS ESLint plugin.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { globSync } = require("tinyglobby");

// The pinned Next ESLint plugin only uses globSync for settings.next.rootDir.
// Disable directory expansion to preserve fast-glob's literal-root behavior.
exports.globSync = (patterns, options) => globSync(patterns, {
  ...options,
  expandDirectories: false,
});
