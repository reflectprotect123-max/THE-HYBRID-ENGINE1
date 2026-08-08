import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const buildDir = resolve(process.argv[2] || 'apps/web/dist-single');
const output = resolve(process.argv[3] || 'coach-pwa-demo.html');
const assets = resolve(buildDir, 'assets');
const files = readdirSync(assets);
const jsFile = files.find((file) => file.endsWith('.js'));
const cssFile = files.find((file) => file.endsWith('.css'));

if (!jsFile || !cssFile) throw new Error('The single-file build must contain exactly one JavaScript and one CSS asset.');

const javascript = readFileSync(resolve(assets, jsFile), 'utf8').replaceAll('</script', '<\\/script');
const css = readFileSync(resolve(assets, cssFile), 'utf8').replaceAll('</style', '<\\/style');
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
  <meta name="theme-color" content="#070706">
  <meta name="description" content="The Hybrid Engine coach demonstration — Strength, Conditioning and Nutrition.">
  <title>THE Hybrid Engine · Coach</title>
  <style>${css}</style>
</head>
<body>
  <div id="root"></div>
  <script>
    const keepCoachOnly = () => {
      if (!location.hash.startsWith('#/coach')) location.replace('#/coach');
    };
    addEventListener('hashchange', keepCoachOnly);
    keepCoachOnly();
  </script>
  <script type="module">${javascript}</script>
</body>
</html>`;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html, 'utf8');
console.log(`Wrote ${basename(output)} (${Buffer.byteLength(html).toLocaleString()} bytes)`);
