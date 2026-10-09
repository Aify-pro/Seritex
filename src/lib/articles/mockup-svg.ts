import "server-only";
import sanitizeHtml from "sanitize-html";

/**
 * Nettoyage des mockups SVG déposés dans la fiche article (migration 0121).
 *
 * Un SVG peut embarquer du script (balise <script>, attributs on…, liens
 * javascript:, <foreignObject> contenant du HTML). Le mockup est ensuite
 * inséré tel quel dans les pages de la plateforme et du site public : on ne
 * garde donc qu'une liste blanche d'éléments et d'attributs de dessin, et les
 * références internes (#id) seulement.
 */

export const TAILLE_MAX_SVG = 1_500_000;

const ELEMENTS = [
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "use",
  "title", "desc", "text", "tspan", "style", "symbol",
];

const ATTRIBUTS = [
  "id", "class", "style", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy",
  "width", "height", "points", "transform", "viewBox", "preserveAspectRatio", "xmlns", "xmlns:xlink", "version",
  "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "clip-path",
  "clip-rule", "mask", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform",
  "patternUnits", "patternTransform", "clipPathUnits", "maskUnits", "maskContentUnits", "spreadMethod",
  "href", "xlink:href", "data-zone", "font-family", "font-size", "font-weight", "text-anchor", "letter-spacing",
  "display", "visibility", "mix-blend-mode", "isolation",
];

/** CSS dangereuse dans <style> ou style="…" : imports, URL externes, expressions. */
const CSS_INTERDITE = /@import|url\(\s*['"]?(?!#)|expression\s*\(|javascript:|behavior\s*:/i;

export type SvgNettoye = { svg: string; viewBox: [number, number, number, number]; elements: string[] };

export function nettoyerSvg(source: string): { ok: true; resultat: SvgNettoye } | { ok: false; erreur: string } {
  if (source.length > TAILLE_MAX_SVG) return { ok: false, erreur: "Fichier SVG trop lourd (1,5 Mo maximum) : simplifiez le dessin." };
  if (!/<svg[\s>]/i.test(source)) return { ok: false, erreur: "Ce fichier n'est pas un SVG." };

  // Retire prologue, doctype et commentaires avant le nettoyage.
  const brut = source.replace(/<\?xml[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "").replace(/<!--[\s\S]*?-->/g, "");

  const svg = sanitizeHtml(brut, {
    allowedTags: ELEMENTS,
    allowedAttributes: { "*": ATTRIBUTS },
    allowedSchemes: [],
    allowedSchemesAppliedToAttributes: ["href", "xlink:href"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    // Mode XML : conserve la casse (linearGradient, viewBox, clipPath…).
    parser: { xmlMode: true, lowerCaseTags: false, lowerCaseAttributeNames: false },
    nonTextTags: ["script", "foreignObject", "iframe", "noscript", "textarea"],
    exclusiveFilter: (frame) => {
      const href = frame.attribs?.href ?? frame.attribs?.["xlink:href"];
      return href !== undefined && !href.startsWith("#");
    },
    // <style> n'est accepté qu'avec de simples règles de classe (contrôle ci-dessous),
    // et ses classes sont isolées par un préfixe à l'affichage (scoperSvg).
    allowVulnerableTags: true,
  }).trim();

  if (!svg.startsWith("<svg")) return { ok: false, erreur: "Le fichier doit commencer par un élément <svg>." };
  const feuilles = [...svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  if (CSS_INTERDITE.test(feuilles) || /style="[^"]*(@import|url\(\s*['"]?(?!#)|expression\s*\()/i.test(svg)) {
    return { ok: false, erreur: "Le SVG contient des styles qui chargent des ressources externes : exportez-le sans lien externe." };
  }
  // Seules des règles de classe sont admises (.cls-1, .a, .b { propriété: valeur; … }).
  const regle = /^\s*(\.[A-Za-z_][\w-]*\s*,\s*)*\.[A-Za-z_][\w-]*\s*\{[^{}@<>]*\}\s*/;
  let reste = feuilles.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  while (reste) {
    const m = reste.match(regle);
    if (!m) {
      return {
        ok: false,
        erreur: "Les styles du SVG ne sont pas pris en charge : exportez-le avec l'option « attributs de présentation » (Illustrator) ou des styles en ligne.",
      };
    }
    reste = reste.slice(m[0].length).trim();
  }

  // Cadre de dessin : viewBox, sinon largeur × hauteur.
  const ouverture = svg.slice(0, svg.indexOf(">") + 1);
  const vb = ouverture.match(/viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*"/i);
  let viewBox: [number, number, number, number] | null = vb ? [Number(vb[1]), Number(vb[2]), Number(vb[3]), Number(vb[4])] : null;
  if (!viewBox) {
    const w = Number.parseFloat(ouverture.match(/\swidth="([\d.]+)/)?.[1] ?? "");
    const h = Number.parseFloat(ouverture.match(/\sheight="([\d.]+)/)?.[1] ?? "");
    if (w > 0 && h > 0) viewBox = [0, 0, w, h];
  }
  if (!viewBox || !(viewBox[2] > 0 && viewBox[3] > 0)) {
    return { ok: false, erreur: "Le SVG n'a pas de cadre (viewBox) : réexportez-le avec ses dimensions." };
  }

  // Éléments identifiés (calques nommés dans Illustrator / Inkscape) : candidats aux zones.
  const elements = [...new Set([...svg.matchAll(/<(?:g|path|rect|circle|ellipse|polygon|polyline)\b[^>]*\sid="([^"]+)"/g)].map((m) => m[1]))];

  return { ok: true, resultat: { svg, viewBox, elements } };
}

