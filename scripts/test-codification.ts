/**
 * Banc de test de la codification (COM-0) — src/lib/articles/codification.ts,
 * miroir de generate_variant_code() (migration 0076) — et des filtres de la
 * liste Articles (ART-A, src/lib/articles/filters.ts).
 *
 * Lancer : npm run test:codification
 */
import assert from "node:assert/strict";
import {
  DEFAULT_CODING,
  defaultShortCode,
  duplicateCodes,
  nextModelCode,
  stockArticleCode,
  variantCode,
  rollFullCode,
  CODING_NATURE_RULES,
} from "../src/lib/articles/codification";
import { applyArticleFilters, parseArticleFilters, articleSearchText, type ArticleRow } from "../src/lib/articles/filters";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n += 1;
  console.log(`✓ ${name}`);
}

const parts = { modele: "TS012", matiere: "JE", grammage: "165", couleur: "BLA", taille: "XL" };

test("format A7 : TS012JE165BLAXL", () => {
  assert.deepEqual(variantCode(parts), { code: "TS012JE165BLAXL" });
});

test("ordre des segments et séparateur paramétrables", () => {
  const r = variantCode(parts, { segments: ["modele", "couleur", "taille"], longueurMax: 18, separateur: "-" });
  assert.deepEqual(r, { code: "TS012-BLA-XL" });
});

test("longueur maximale : suffixe d'état compris", () => {
  // 15 + 1 = 16 ≤ 18
  assert.ok("code" in variantCode(parts, DEFAULT_CODING));
  // 17 caractères + suffixe = 18 : encore valide
  assert.ok("code" in variantCode({ ...parts, taille: "XXXL" }, DEFAULT_CODING));
  // 18 + suffixe = 19 : refusé
  const ko = variantCode({ ...parts, taille: "XXXXL" }, DEFAULT_CODING);
  assert.ok("error" in ko && ko.error.includes("dépasse 18"));
});

test("segment manquant refusé", () => {
  const r = variantCode({ ...parts, couleur: null });
  assert.ok("error" in r && r.error.includes("Couleur"));
});

test("suffixes d'état : vierge sans suffixe, P personnalisé, D 2e choix", () => {
  assert.equal(stockArticleCode("TS012JE165BLAXL", "vierge"), "TS012JE165BLAXL");
  assert.equal(stockArticleCode("TS012JE165BLAXL", "personnalise"), "TS012JE165BLAXLP");
  assert.equal(stockArticleCode("TS012JE165BLAXL", "deuxieme_choix"), "TS012JE165BLAXLD");
});

test("unicité : doublons détectés (deux « M » de groupes différents)", () => {
  const codes = ["TS012JE165BLAM", "TS012JE165BLAM", "TS012JE165BLAL"];
  assert.deepEqual(duplicateCodes(codes), ["TS012JE165BLAM"]);
  assert.deepEqual(duplicateCodes(["A", "B"]), []);
});

test("code du modèle : catégorie + numéro suivant sur 3 chiffres", () => {
  assert.equal(nextModelCode("TS", []), "TS001");
  assert.equal(nextModelCode("TS", ["TS001", "TS011", "PO003"]), "TS012");
});

test("codes courts par défaut : sans accents, majuscules", () => {
  assert.equal(defaultShortCode("Bleu clair", 3), "BLE");
  assert.equal(defaultShortCode("Écru", 3), "ECR");
  assert.equal(defaultShortCode("3XL", 4), "3XL");
});

const row = (r: Partial<ArticleRow> & { id: string; name: string }): ArticleRow => ({
  code: null,
  category: null,
  active: true,
  matiere: null,
  nature: "pf",
  typeAppro: "fabrique",
  familleId: null,
  sousFamilleId: null,
  famille: null,
  unite: "piece",
  grammages: [],
  couleurIds: [],
  grille: null,
  sage: false,
  declinaisons: 0,
  stockDisponible: null,
  prixAPartirDe: null,
  vignetteUrl: null,
  searchText: articleSearchText([r.name, r.category, r.matiere, r.code]),
  ...r,
});

test("liste Articles : recherche sans accents, filtres et tri", () => {
  const rows = [
    row({ id: "1", name: "Polo piqué", category: "Polo", matiere: "Piqué", code: "PO001", declinaisons: 4 }),
    row({ id: "2", name: "T-shirt col rond", category: "T-shirt", matiere: "Jersey", code: "TS001", declinaisons: 12 }),
    row({ id: "3", name: "Débardeur", category: "T-shirt", active: false }),
  ];
  const f = parseArticleFilters({ q: "PIQUE" });
  assert.deepEqual(applyArticleFilters(rows, f).map((r) => r.id), ["1"]);
  assert.deepEqual(applyArticleFilters(rows, parseArticleFilters({ categorie: "T-shirt" })).map((r) => r.id), ["2"]);
  assert.deepEqual(applyArticleFilters(rows, parseArticleFilters({ actif: "tous", categorie: "T-shirt" })).map((r) => r.id), ["3", "2"]);
  assert.deepEqual(applyArticleFilters(rows, parseArticleFilters({ tri: "declinaisons", ordre: "desc" })).map((r) => r.id), ["2", "1"]);
});

test("liste unique : filtres nature, type et famille (fiche article unique)", () => {
  const rows = [
    row({ id: "pf", name: "T-shirt", nature: "pf", familleId: "vet", sousFamilleId: "ts" }),
    row({ id: "mp", name: "Jersey 165", nature: "mp", typeAppro: "negoce", familleId: "tex" }),
    row({ id: "co", name: "Bouton 12 mm", nature: "consommable", typeAppro: "negoce", familleId: "merc" }),
  ];
  assert.deepEqual(applyArticleFilters(rows, parseArticleFilters({ nature: "mp" })).map((r) => r.id), ["mp"]);
  assert.deepEqual(applyArticleFilters(rows, parseArticleFilters({ type: "negoce" })).map((r) => r.id), ["co", "mp"]);
  assert.deepEqual(applyArticleFilters(rows, parseArticleFilters({ famille: "vet", sous_famille: "ts" })).map((r) => r.id), ["pf"]);
  assert.equal(parseArticleFilters({ nature: "inconnue" }).nature, "");
});

test("codification par nature : tissu sans suffixe d'état, consommable à axes facultatifs", () => {
  const mp = CODING_NATURE_RULES.mp;
  assert.deepEqual(
    variantCode({ matiere: "JE", grammage: "180", couleur: "BLA" }, { segments: ["matiere", "grammage", "couleur"], longueurMax: 8, separateur: "" }, { etatSuffix: mp.etatSuffix }),
    { code: "JE180BLA" }
  );
  const co = CODING_NATURE_RULES.consommable;
  const rule = { segments: co.segments, longueurMax: 18, separateur: "" };
  assert.deepEqual(variantCode({ modele: "COBO0001", couleur: "BLA", dimension: "12" }, rule, { etatSuffix: false, optional: co.optional }), { code: "COBO0001BLA12" });
  assert.deepEqual(variantCode({ modele: "COBO0001", dimension: "12" }, rule, { etatSuffix: false, optional: co.optional }), { code: "COBO000112" });
  // Axe présent mais sans code court : erreur.
  assert.ok("error" in variantCode({ modele: "COBO0001", couleur: null }, rule, { etatSuffix: false, optional: co.optional }));
});

test("code complet d'un rouleau : déclinaison, laize en cm, poids en hectogrammes", () => {
  assert.equal(rollFullCode("JE180BLA", 178, 22.4), "JE180BLA-178-224");
  assert.equal(rollFullCode("JE180BLA", 180.4, 21), "JE180BLA-180-210");
});

console.log(`\n${n} tests OK`);
