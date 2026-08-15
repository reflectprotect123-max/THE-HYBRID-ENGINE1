/*
 * Which site is this deploy?
 *
 * ONE netlify.toml, at the repository root, for BOTH sites. The alternative —
 * a second config in a subdirectory, selected by that site's base directory —
 * is the documented Netlify pattern and it is what this repository tried
 * first. It failed for a reason no amount of correctness fixes: Netlify's
 * monorepo picker will not let you point a site's base directory at a folder
 * that does not look like a project, and adding a package.json to make it look
 * like one did not persuade it either. A deploy configuration you cannot
 * SELECT is not a deploy configuration.
 *
 * So the choice moved to the one control that has never fought anybody: an
 * environment variable, set per site in the Netlify UI.
 *
 *   HYBRID_SITE unset (or 'coach')   the coach workspace. The existing site
 *                                    sets nothing and is completely unchanged.
 *   HYBRID_SITE=conditioning         the branded athlete app, plus the
 *                                    conditioning lab at /lab.
 *
 * BOTH ASSEMBLE INTO `apps/web/dist`, and that is what makes one netlify.toml
 * enough: `publish` is a static string in that file and cannot branch, so the
 * branch has to happen in what gets WRITTEN there rather than in where Netlify
 * looks. `--emptyOutDir` on the conditioning build keeps the two from ever
 * layering over one another.
 *
 * The local consequence, stated because it will surprise someone: running the
 * conditioning build locally overwrites the coach `apps/web/dist`. That
 * directory is a build artefact, gitignored, and rebuilt by `pnpm run
 * build:site` — but `checks/deploy-smoke.mjs` reads it, so run the coach build
 * again before trusting that check after a local conditioning build.
 *
 * Run: node scripts/deploy-site.mjs      (from the repository root)
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), process.argv[2] || '.');
const raw = (process.env.HYBRID_SITE || 'coach').trim().toLowerCase();

/*
 * An unrecognised value FAILS rather than falling back. A typo'd
 * `HYBRID_SITE=condtioning` silently building and publishing the coach
 * workspace to the athlete's domain is the worst outcome available here, and
 * it is exactly what a default-on-unknown would produce.
 */
const SITES = ['coach', 'conditioning'];
if (!SITES.includes(raw)) {
  console.error(`HYBRID_SITE="${process.env.HYBRID_SITE}" is not a site.`);
  console.error(`Valid values: ${SITES.join(', ')} — or leave it unset for coach.`);
  process.exit(1);
}

const run = (cmd, args, env = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

console.log(`\n=== Building the ${raw.toUpperCase()} site ===\n`);

if (raw === 'coach') {
  // Unchanged from what the root netlify.toml used to run inline, moved here
  // so both sites go through one script and neither can drift.
  run('pnpm', ['run', 'build:site']);
  run('pnpm', ['run', 'check:csp']);
} else {
  /*
   * `--outDir dist`, not `dist-conditioning`: see the header. The publish
   * directory is fixed in netlify.toml, so the app has to be built where that
   * points rather than the other way round.
   */
  run('pnpm', ['-r', '--filter', './packages/*', 'build']);
  run(
    'pnpm',
    ['--filter', '@hybrid/web', 'exec', 'vite', 'build', '--outDir', 'dist', '--emptyOutDir'],
    { VITE_HYBRID_PRODUCT: 'conditioning' },
  );
  run('pnpm', ['--filter', '@hybrid/lab', 'build'], { HYBRID_LAB_BASE: '/lab/' });
  run('node', ['scripts/build-site.mjs'], { HYBRID_PUBLISH: 'apps/web/dist' });
  run('node', ['scripts/build-lab.mjs'], { HYBRID_PUBLISH: 'apps/web/dist' });
  run('pnpm', ['run', 'check:csp']);
}

if (!existsSync(resolve(root, 'apps/web/dist/index.html'))) {
  console.error('\napps/web/dist/index.html is missing after the build. Nothing to publish.');
  process.exit(1);
}

console.log(`\nOK — the ${raw} site is assembled in apps/web/dist.`);
