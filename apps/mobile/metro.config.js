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
config.resolver.disableHierarchicalLookup = true;

module.exports = withNativeWind(config, { input: './src/global.css' });
