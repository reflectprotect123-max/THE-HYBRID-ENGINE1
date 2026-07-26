const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

/*
 * Monorepo Metro config. @hybrid/engine and @hybrid/design are workspace
 * packages that export TypeScript SOURCE, so Metro has to be told to watch the
 * repo root and to resolve out of the shared store — pnpm's symlinked
 * node_modules is not something Metro finds on its own.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// pnpm links packages rather than copying them; without this Metro follows the
// symlink and then cannot resolve React from the linked package's perspective.
config.resolver.unstable_enableSymlinks = true;

/*
 * Hierarchical lookup MUST stay on under pnpm.
 *
 * Turning it off is the usual advice for a yarn/npm monorepo, where it stops a
 * package accidentally resolving something it never declared. Under pnpm it is
 * actively wrong: a dependency of `expo` does not live in either directory
 * listed above, it lives beside `expo` inside the content-addressed store at
 * node_modules/.pnpm/expo@<ver>/node_modules/. The only way Metro reaches it is
 * by walking up from the resolved file's REAL path — which is precisely what
 * disabling this forbids.
 *
 * With it off, `import "expo"` fails on expo-modules-core and the app does not
 * bundle at all. Nothing else catches that: typecheck passes, because
 * TypeScript resolves through the symlink perfectly well.
 */
config.resolver.disableHierarchicalLookup = false;

module.exports = withNativeWind(config, { input: './src/global.css' });
