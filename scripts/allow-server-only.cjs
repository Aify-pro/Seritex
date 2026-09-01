/**
 * Neutralise le garde `server-only` le temps d'un script exécuté hors Next.
 *
 * `server-only` lève volontairement une erreur dès qu'il est chargé en dehors
 * d'un Server Component. Le banc de test du moteur importe `dxf.ts`, qui
 * conserve ce garde (utile : il empêche le parseur de partir dans un bundle
 * client). On se contente donc de le rendre inerte pour ce process de test,
 * sans toucher au code de production.
 *
 * Usage : npx tsx --require ./scripts/allow-server-only.cjs <script>
 */
const Module = require("module");
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") {
    return require.resolve("./noop-server-only.cjs");
  }
  return originalResolve.call(this, request, ...rest);
};
