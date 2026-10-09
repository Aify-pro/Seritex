/** Partagé navigateur + serveur (pas de « server-only »). */
/**
 * Rend un mockup insérable plusieurs fois dans une même page : préfixe ses
 * identifiants, ses références (#id, url(#id)) et ses classes, pour qu'aucune
 * règle ni aucun identifiant ne déborde sur le reste de la page.
 */
export function scoperSvg(svg: string, prefixe: string): string {
  return svg
    .replace(/\sid="([^"]+)"/g, ` id="${prefixe}-$1"`)
    .replace(/(href|xlink:href)="#([^"]+)"/g, `$1="#${prefixe}-$2"`)
    .replace(/url\(\s*#([^)\s]+)\s*\)/g, `url(#${prefixe}-$1)`)
    .replace(/\sclass="([^"]+)"/g, (_m, c: string) => ` class="${c.split(/\s+/).filter(Boolean).map((x) => `${prefixe}-${x}`).join(" ")}"`)
    .replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (_m, a: string, css: string) => `<style${a}>${css.replace(/\.([A-Za-z_][\w-]*)/g, `.${prefixe}-$1`)}</style>`);
}
