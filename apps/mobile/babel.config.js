module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          jsxImportSource: 'nativewind',
          /*
           * @hybrid/config reads `import.meta.env`, so the web apps can point at
           * a different Supabase project per environment. That is the Vite
           * idiom, and the package is shared SOURCE rather than a built
           * artifact, so mobile compiles the same lines.
           *
           * Hermes has no `import.meta` and rejects it while PARSING — so the
           * try/catch the package wraps it in never gets a chance to run, and
           * the entire bundle fails to build. This rewrites it away before
           * Hermes sees it and leaves the web behaviour untouched.
           */
          unstable_transformImportMeta: true,
        },
      ],
      'nativewind/babel',
    ],
  };
};
