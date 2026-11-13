/**
 * Tests du moteur d'imbrication (Phase 1).
 *
 *  A. Contrat : l'entrée est validée strictement (champ inconnu, mauvaise version).
 *  B. Contours : un contour qui se croise est refusé avec le nom de la pièce.
 *  C. Validation indépendante, sur des tracés construits à la main :
 *     tracé correct, contact sans espacement, chevauchement, pièce incluse
 *     dans une autre, espacement insuffisant, rotation interdite, pièce hors
 *     de la largeur, pièce manquante, retournement non respecté, convention
 *     de transformation (miroir puis rotation puis translation).
 *  D. Moteur réel (WebAssembly, comme en production) :
 *     tracé complet et valide, reproductibilité (même entrée + même graine +
 *     même effort = même tracé), pièce plus large que le tissu, contour
 *     invalide, annulation en cours de calcul.
 *
 * Lancer : npm run test:imbrication
 */
import { entreeSchema, sortieSchema, type EntreeImbrication, type SortieImbrication } from "../src/lib/imbrication/contrat";
import { lancerImbrication, imbriquer } from "../src/lib/imbrication/moteur";
import { controlerContours, transformerContour, validerTrace, type Point } from "../src/lib/imbrication/validation";
import { normalizeShape } from "../src/lib/patronnage/geometry";
import { parseDxfContours } from "../src/lib/patronnage/dxf";
import { construireEntree, dxfContientDesArcs, nettoyerContour, retrouverContour, type PatronCharge } from "../src/lib/imbrication/patrons";
import { executerTranche, traiterCalculs, type CalculReserve, type MiseAJourCalcul, type StoreCalculs } from "../src/lib/imbrication/execution";
import type { CalculImbrication, ResultatMoteur } from "../src/lib/imbrication/moteur";
import { corps, dxfModaris, entreeTshirt, manche } from "./imbrication-fixtures";

let echecs = 0;
let total = 0;
function verifier(nom: string, condition: boolean, detail?: unknown) {
  total++;
  if (condition) console.log(`  ✓ ${nom}`);
  else {
    echecs++;
    console.log(`  ✗ ${nom}`, detail ?? "");
  }
}

const carre = (c: number): Point[] => [[0, 0], [c, 0], [c, c], [0, c]];

function entreeCarres(espacement = 0): ReturnType<typeof entreeSchema.parse> {
  return entreeSchema.parse({
    version: "seritex.imbrication/v1",
    tissu: { largeur_utile: 300, marge_lisiere: 0 },
    espacement,
    calcul: { temps_max_s: 10, graine: 1 },
    pieces: [
      { id: "a", contour: carre(100), quantite: 1, rotations: [0, 180] },
      { id: "b", contour: carre(100), quantite: 1, rotations: [0, 180] },
    ],
  });
}

function sortie(placements: SortieImbrication["placements"]): SortieImbrication {
  return sortieSchema.parse({
    version: "seritex.imbrication/v1",
    statut: "termine",
    arret: "budget_effort",
    longueur: 0,
    largeur_utile: 300,
    taux_utilisation: 0,
    depasse_longueur_max: false,
    temps_calcul_s: 0,
    effort_utilise: 0,
    reproductible: true,
    graine: 1,
    moteur: { nom: "sparrow", version: "0.3.0", jagua_rs: "1.0.0", wrapper: "test" },
    placements,
  });
}

const pl = (piece_id: string, x: number, y: number, rotation = 0, miroir = false) => ({ piece_id, x, y, rotation, miroir });
const codes = (r: ReturnType<typeof validerTrace>) => r.problemes.map((p) => p.code);

async function main() {
  console.log("A. Contrat");
  const base = entreeTshirt({ tailles: ["M"], paquets: 1, tempsMaxS: 10 });
  verifier("entrée valide acceptée", entreeSchema.safeParse(base).success);
  verifier("champ inconnu refusé", !entreeSchema.safeParse({ ...base, inconnu: 1 }).success);
  verifier("mauvaise version refusée", !entreeSchema.safeParse({ ...base, version: "seritex.imbrication/v0" }).success);
  verifier("valeurs par défaut (marge, effort)", entreeSchema.parse({ ...base, tissu: { largeur_utile: 1000 } }).tissu.marge_lisiere === 0);

  console.log("B. Contours");
  // Contour en huit asymétrique (surface non nulle, bords qui se croisent).
  const huit: Point[] = [[0, 0], [200, 100], [200, 0], [0, 60]];
  const pb = controlerContours([{ id: "dos-M", contour: huit }, { id: "ok", contour: carre(10) }]);
  verifier("contour en huit refusé", pb.length === 1 && pb[0].pieceId === "dos-M" && pb[0].message.includes("se croise"), pb);
  verifier("contours du t-shirt acceptés", controlerContours(base.pieces).length === 0, controlerContours(base.pieces));

  console.log("C. Validation indépendante");
  const e0 = entreeCarres();
  verifier("tracé correct", validerTrace(e0, sortie([pl("a", 0, 0), pl("b", 150, 0)])).valide);
  verifier("contact bord à bord sans espacement = valide", validerTrace(e0, sortie([pl("a", 0, 0), pl("b", 100, 0)])).valide);
  verifier("bruit flottant de 0,001 mm toléré", validerTrace(e0, sortie([pl("a", 0, 0), pl("b", 99.999, 0)])).valide);
  verifier("chevauchement détecté", codes(validerTrace(e0, sortie([pl("a", 0, 0), pl("b", 60, 30)]))).includes("chevauchement"));
  const eInclus = entreeSchema.parse({
    ...e0,
    pieces: [
      { id: "a", contour: carre(100), quantite: 1, rotations: [0] },
      { id: "b", contour: carre(20), quantite: 1, rotations: [0] },
    ],
  });
  verifier("pièce entièrement incluse détectée", codes(validerTrace(eInclus, sortie([pl("a", 0, 0), pl("b", 40, 40)]))).includes("chevauchement"));
  const e5 = entreeCarres(5);
  verifier("espacement insuffisant détecté", codes(validerTrace(e5, sortie([pl("a", 0, 0), pl("b", 102, 0)]))).includes("espacement"));
  verifier("espacement respecté", validerTrace(e5, sortie([pl("a", 0, 0), pl("b", 105, 0)])).valide);
  verifier("rotation interdite détectée", codes(validerTrace(e0, sortie([pl("a", 100, 0, 90), pl("b", 150, 0)]))).includes("rotation"));
  verifier("rotation 180° acceptée", validerTrace(e0, sortie([pl("a", 100, 100, 180), pl("b", 150, 0)])).valide);
  verifier("hors largeur détecté", codes(validerTrace(e0, sortie([pl("a", 0, 250), pl("b", 150, 0)]))).includes("hors_largeur"));
  verifier("pièce manquante détectée", codes(validerTrace(e0, sortie([pl("a", 0, 0)]))).includes("quantite"));
  verifier("retournement non demandé détecté", codes(validerTrace(e0, sortie([pl("a", 0, 100, 0, true), pl("b", 150, 0)]))).includes("miroir"));
  const t = transformerContour([[10, 20]], { x: 5, y: 7, rotation: 90, miroir: true });
  // (10, 20) → miroir (10, -20) → rotation 90° (20, 10) → translation (25, 17)
  verifier("convention miroir → rotation → translation", Math.abs(t[0][0] - 25) < 1e-9 && Math.abs(t[0][1] - 17) < 1e-9, t);
  const m = validerTrace(e0, sortie([pl("a", 0, 0), pl("b", 150, 0)]));
  verifier("longueur et taux recalculés", m.longueurMm === 250 && Math.abs(m.tauxUtilisation - 20000 / (250 * 300)) < 1e-12, m);

  console.log("D. Moteur réel (WebAssembly)");
  const entree = entreeTshirt({ tailles: ["S", "M", "L"], paquets: 1, tempsMaxS: 120, effort: 150, graine: 7 });
  const t0 = Date.now();
  const r1 = await imbriquer(entree);
  const duree = (Date.now() - t0) / 1000;
  if (!r1.ok) {
    verifier("tracé calculé", false, r1);
  } else {
    const nb = entree.pieces.reduce((s, p) => s + p.quantite, 0);
    verifier(`tracé calculé (${r1.sortie.placements.length}/${nb} pièces, ${duree.toFixed(1)} s)`, r1.sortie.placements.length === nb);
    verifier("tracé validé par Seritex", r1.validation.valide, r1.validation.problemes);
    verifier("arrêt sur budget d'effort, déclaré reproductible", r1.sortie.arret === "budget_effort" && r1.sortie.reproductible, r1.sortie.arret);
    verifier("manches droites posées retournées", r1.sortie.placements.filter((p) => p.piece_id.startsWith("manche-d")).every((p) => p.miroir));
    verifier(
      "longueur du moteur = longueur recalculée (±0,5 mm)",
      Math.abs(r1.sortie.longueur - r1.validation.longueurMm) < 0.5,
      [r1.sortie.longueur, r1.validation.longueurMm]
    );
    console.log(
      `    longueur ${(r1.validation.longueurMm / 10).toFixed(1)} cm, utilisation ${(r1.validation.tauxUtilisation * 100).toFixed(2)} %, espacement min ${r1.validation.espacementMinMm?.toFixed(2)} mm`
    );
    const r2 = await imbriquer(entree);
    verifier("même entrée + même graine = même tracé", r2.ok && JSON.stringify(r2.sortie.placements) === JSON.stringify(r1.sortie.placements));
    const r3 = await imbriquer({ ...entree, calcul: { ...entree.calcul, graine: 8 } });
    verifier("autre graine = autre tracé", r3.ok && JSON.stringify(r3.sortie.placements) !== JSON.stringify(r1.sortie.placements));
  }

  const large: EntreeImbrication = {
    ...entree,
    tissu: { largeur_utile: 400, marge_lisiere: 5 },
  };
  const r4 = await imbriquer(large);
  verifier(
    "pièce plus large que le tissu : message clair",
    !r4.ok && r4.code === "piece_trop_large" && !!r4.pieceId && r4.message.includes("ne tient pas"),
    r4
  );

  const r5 = await imbriquer({ ...entree, pieces: [{ id: "dos-XL", contour: huit, quantite: 1, rotations: [0] }] });
  verifier("contour invalide refusé avant calcul", !r5.ok && r5.code === "contour_invalide" && r5.pieceId === "dos-XL", r5);

  const r6 = await imbriquer({ ...entree, tissu: { largeur_utile: 1600, marge_lisiere: 900 } });
  verifier("marge de lisière incohérente refusée", !r6.ok && r6.code === "marge_invalide", r6);

  const longue = entreeTshirt({ tailles: ["S", "M", "L", "XL"], paquets: 2, tempsMaxS: 120 });
  const calcul = lancerImbrication(longue);
  const t1 = Date.now();
  setTimeout(() => void calcul.annuler(), 3000);
  const r7 = await calcul.resultat;
  const arret = (Date.now() - t1) / 1000;
  verifier(
    `annulation : arrêt en ${arret.toFixed(1)} s avec un tracé valide`,
    r7.ok && r7.sortie.statut === "annule" && r7.validation.valide && arret < 15,
    r7.ok ? [r7.sortie.statut, r7.validation.problemes] : r7
  );

  // Moteur natif (serveur Seritex) : même contrat, même contrôle. Testé si le binaire est compilé.
  const natif = "rust/imbrication/target/release/seritex-imbrication";
  if (require("node:fs").existsSync(natif)) {
    const rn = await imbriquer(entree, { binaireNatif: natif });
    verifier("moteur natif : tracé valide, même contrat", rn.ok && rn.validation.valide && rn.sortie.placements.length === entree.pieces.reduce((s, p) => s + p.quantite, 0), rn);
    const rw = await imbriquer(entree, { binaireNatif: null });
    verifier("natif et WebAssembly : même tracé (même graine, même effort)", rn.ok && rw.ok && JSON.stringify(rn.sortie.placements) === JSON.stringify(rw.sortie.placements));
  } else {
    console.log("  (moteur natif non compilé : vérifications natives sautées)");
  }

  await sectionPreparation();
  await sectionExecution();

  console.log(`\n${total - echecs}/${total} vérifications réussies.`);
  if (echecs > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// E. Préparation des pièces depuis la bibliothèque (gabarit au format Modaris)
// ---------------------------------------------------------------------------
async function sectionPreparation() {
  console.log("E. Préparation depuis la bibliothèque");
  const formes = [{ contourMm: corps(1, 85) }, { contourMm: manche(1) }];
  const dxf = dxfModaris(formes);
  const contours = parseDxfContours(dxf);
  verifier("gabarit Modaris : 2 pièces lues (coupe réassemblée, couture et crans écartés)", contours.length === 2, contours.length);
  // Ce que la bibliothèque a enregistré : contour normalisé (recentré, tourné).
  const enBibliotheque = contours.map((c) => normalizeShape(c.points));
  const patron = (semiFiniId: string, i: number, extra: Partial<PatronCharge> = {}, piece: Partial<PatronCharge["pieces"][number]> = {}): PatronCharge => ({
    semiFiniId,
    semiFiniNom: semiFiniId === "sf-corps" ? "Corps avant" : "Manche courte",
    coupeOuvert: true,
    piecesContourOuvert: 1,
    articleCode: semiFiniId === "sf-corps" ? "TSM01-CAV" : "TSM01-MC",
    taille: "Homme/M",
    patternId: `pat-${semiFiniId}`,
    dxfNom: "GABARIT-M.dxf",
    dxf,
    pieces: [
      {
        id: `pp-${semiFiniId}`,
        nom: semiFiniId,
        expectedCount: 1,
        rotations: [0, 180],
        symetrie: "aucune",
        points: enBibliotheque[i].points,
        area: enBibliotheque[i].area,
        perimeter: enBibliotheque[i].perimeter,
        ...piece,
      },
    ],
    ...extra,
  });
  const contourCorps = retrouverContour(dxf, patron("sf-corps", 0).pieces[0]);
  verifier("pièce retrouvée dans son DXF, orientation d'origine (droit-fil selon X)", !!contourCorps && contourCorps.length === contours[0].points.length);

  const tissu = { largeurUtileMm: 1600, margeLisiereMm: 5, espacementMm: 2 };
  const calcul = { tempsS: 20, graine: 3 };
  const p = construireEntree([patron("sf-corps", 0), patron("sf-manche", 1)], [
    { semiFiniId: "sf-corps", taille: "Homme/M", quantite: 2 },
    { semiFiniId: "sf-manche", taille: "Homme/M", quantite: 3 },
    { semiFiniId: "sf-manche", taille: "Homme/M", quantite: 1 },
  ], tissu, calcul);
  if (!p.ok) {
    verifier("entrée construite", false, p.message);
    return;
  }
  const corpsMm = p.entree.pieces.find((x) => x.id === "TSM01-CAV · Homme/M")!;
  const xs = corpsMm.contour.map((q) => q[0]);
  verifier("unités converties en mm (0,1 mm → mm), cotes du dessin conservées", Math.abs(Math.max(...xs) - Math.min(...xs) - 700) < 1e-6);
  verifier("demandes en double additionnées (manche : 3 + 1)", p.entree.pieces.find((x) => x.id === "TSM01-MC · Homme/M")?.quantite === 4);
  verifier("rotations de la pièce reprises ({0, 180})", JSON.stringify(corpsMm.rotations) === "[0,180]");
  verifier("correspondance pièce ↔ patron conservée", p.pieces.every((x) => x.patternPieceId.startsWith("pp-") && x.taille === "Homme/M"));
  verifier("entrée conforme au contrat", entreeSchema.safeParse(p.entree).success);

  const paire = construireEntree([patron("sf-manche", 1, {}, { symetrie: "paire", expectedCount: 2 })], [{ semiFiniId: "sf-manche", taille: "Homme/M", quantite: 3 }], tissu, calcul);
  verifier(
    "pièce par paire : moitié posée retournée (3 vêtements × 2 = 3 + 3)",
    paire.ok && paire.entree.pieces.length === 2 && paire.entree.pieces.every((x) => x.quantite === 3) && paire.entree.pieces[1].miroir === true,
    paire
  );
  const impair = construireEntree([patron("sf-manche", 1, {}, { symetrie: "paire" })], [{ semiFiniId: "sf-manche", taille: "Homme/M", quantite: 3 }], tissu, calcul);
  verifier("pièce par paire en nombre impair : refusée", !impair.ok && impair.message.includes("nombre pair"), impair);

  const tub = construireEntree([patron("sf-corps", 0, { coupeOuvert: false })], [{ semiFiniId: "sf-corps", taille: "Homme/M", quantite: 1 }], tissu, calcul);
  verifier("semi-fini tubulaire seulement : refusé (v1 = tissu ouvert)", !tub.ok && tub.message.includes("tubulaire"), tub);
  const sansTaille = construireEntree([patron("sf-corps", 0)], [{ semiFiniId: "sf-corps", taille: "Homme/XL", quantite: 1 }], tissu, calcul);
  verifier("taille sans patron : message qui nomme le semi-fini et la taille", !sansTaille.ok && sansTaille.message.includes("Corps avant") && sansTaille.message.includes("Homme/XL"), sansTaille);
  const remplace = construireEntree([patron("sf-corps", 0, { dxf: dxfModaris([{ contourMm: manche(1.1) }]) })], [{ semiFiniId: "sf-corps", taille: "Homme/M", quantite: 1 }], tissu, calcul);
  verifier("DXF remplacé (pièce introuvable) : refusé avec le nom du fichier", !remplace.ok && remplace.message.includes("GABARIT-M.dxf"), remplace);
  // Cas réel (corps arrière XL) : jonction de deux moitiés avec un point à 0,018 mm du premier.
  const noeud: Point[] = [[756.195, 881.077], [756.485, 851.719], [1500, 800], [1500, 950], [756.485, 910.417], [756.195, 881.06]];
  verifier("contour réel en « nœud papillon » de 0,018 mm : refusé tel quel", controlerContours([{ id: "x", contour: noeud }]).length === 1);
  const propre = nettoyerContour(noeud);
  verifier("… nettoyé (doublon retiré) puis accepté", propre.length === 5 && controlerContours([{ id: "x", contour: propre }]).length === 0, propre);
  const aligne: Point[] = [[0, 0], [50, 0.001], [100, 0], [100, 100], [0, 100]];
  verifier("points alignés retirés, angles conservés", nettoyerContour(aligne).length === 4);
  const avecArc = dxfModaris(formes, { bulge: true });
  verifier("arcs (bulges) détectés", dxfContientDesArcs(avecArc) && !dxfContientDesArcs(dxf));
  const arc = construireEntree([patron("sf-corps", 0, { dxf: avecArc })], [{ semiFiniId: "sf-corps", taille: "Homme/M", quantite: 1 }], tissu, calcul);
  verifier("fichier avec arcs : refusé (jamais approché en silence)", !arc.ok && arc.message.includes("arcs"), arc);

  const r = await imbriquer(p.entree);
  verifier("calcul de bout en bout sur les pièces préparées : tracé valide", r.ok && r.validation.valide, r.ok ? r.validation.problemes : r);
}

// ---------------------------------------------------------------------------
// F. Exécution par tranches (faux stockage, moteur réel ou simulé)
// ---------------------------------------------------------------------------
function fauxStore(calculs: CalculReserve[], annulerApresMs: number | null = null) {
  const enregistres: { id: string; maj: MiseAJourCalcul }[] = [];
  const debut = Date.now();
  const store: StoreCalculs = {
    async prendre() {
      return calculs.shift() ?? null;
    },
    async signeDeVie() {
      return annulerApresMs !== null && Date.now() - debut > annulerApresMs;
    },
    async enregistrer(id, maj) {
      enregistres.push({ id, maj });
    },
  };
  return { store, enregistres };
}

function calculReserve(entree: EntreeImbrication, tempsTotal: number, extra: Partial<CalculReserve> = {}): CalculReserve {
  return { id: "c1", entree: entreeSchema.parse(entree), temps_total_s: tempsTotal, temps_consomme_s: 0, tranches: 0, meilleur: null, validation: null, annulation_demandee_le: null, ...extra };
}

const lanceurReel = (entree: EntreeImbrication): CalculImbrication => lancerImbrication(entree);
const lanceurFixe = (r: ResultatMoteur) => (): CalculImbrication => ({ resultat: Promise.resolve(r), annuler: async () => {} });

async function sectionExecution() {
  console.log("F. Exécution par tranches");
  const entree = entreeTshirt({ tailles: ["S", "M", "L"], paquets: 1, tempsMaxS: 1 });
  const opts = { dureeTrancheS: 4, intervalleSigneDeVieMs: 200 };

  const { store } = fauxStore([]);
  const t1 = await executerTranche(calculReserve(entree, 10), store, lanceurReel, opts);
  verifier("tranche 1 sur 10 s (tranches de 4 s) : tracé valide gardé, calcul remis en attente", t1.statut === "en_attente" && !!t1.meilleur && t1.validation?.valide === true && t1.tranches === 1, t1.statut);
  const t2 = await executerTranche(
    calculReserve(entree, 10, { temps_consomme_s: t1.temps_consomme_s, tranches: 1, meilleur: t1.meilleur, validation: t1.validation }),
    store,
    lanceurReel,
    opts
  );
  verifier("tranche 2 : reprise du meilleur tracé, jamais plus long", t2.validation?.valide === true && (t2.longueur_mm ?? Infinity) <= (t1.longueur_mm ?? 0) + 0.01, [t1.longueur_mm, t2.longueur_mm]);
  verifier("temps consommé cumulé", t2.temps_consomme_s > t1.temps_consomme_s && t2.tranches === 2);

  const fin = await executerTranche(calculReserve(entree, 3), store, lanceurReel, opts);
  verifier("temps total atteint : « terminé » avec longueur et taux", fin.statut === "termine" && !!fin.longueur_mm && !!fin.taux_utilisation, fin.statut);

  const effort = entreeTshirt({ tailles: ["M"], paquets: 1, tempsMaxS: 30, effort: 60 });
  const te = await executerTranche(calculReserve(effort, 30), store, lanceurReel, { ...opts, dureeTrancheS: 30 });
  verifier("budget d'effort : une seule tranche, « terminé » et reproductible", te.statut === "termine" && te.reproductible === true, [te.statut, te.reproductible]);

  const { store: storeAnnule } = fauxStore([], 1500);
  const longue = entreeTshirt({ tailles: ["S", "M", "L", "XL"], paquets: 2, tempsMaxS: 1 });
  const ta = await executerTranche(calculReserve(longue, 60), storeAnnule, lanceurReel, { dureeTrancheS: 60, intervalleSigneDeVieMs: 200 });
  verifier("annulation demandée en cours de tranche : « annulé », meilleur tracé valide gardé", ta.statut === "annule" && ta.validation?.valide === true, ta.statut);
  const avant = await executerTranche(calculReserve(entree, 10, { annulation_demandee_le: new Date().toISOString() }), store, lanceurReel, opts);
  verifier("annulation demandée avant la tranche : rien n'est calculé", avant.statut === "annule" && avant.meilleur === null);

  const panne = await executerTranche(calculReserve(entree, 10), store, lanceurFixe({ ok: false, code: "moteur_plante", message: "Le moteur s'est arrêté." }), opts);
  verifier("panne du moteur sans tracé antérieur : « échec » expliqué", panne.statut === "echec" && panne.erreur_code === "moteur_plante" && !!panne.erreur_message);
  const panneApres = await executerTranche(calculReserve(entree, 10, { tranches: 1, temps_consomme_s: 4, meilleur: t1.meilleur, validation: t1.validation }), store, lanceurFixe({ ok: false, code: "moteur_plante", message: "x" }), opts);
  verifier("panne après une tranche réussie : le tracé valide déjà trouvé est conservé", panneApres.statut === "termine" && panneApres.meilleur === t1.meilleur);

  const faux = t1.meilleur!;
  const invalide: ResultatMoteur = {
    ok: true,
    entree: entreeSchema.parse(entree),
    sortie: faux,
    validation: { valide: false, problemes: [{ code: "chevauchement", message: "Les pièces « a » et « b » se chevauchent." }], longueurMm: 1, tauxUtilisation: 1, surfacePiecesMm2: 1, espacementMinMm: 0 },
  };
  const ti = await executerTranche(calculReserve(entree, 10), store, lanceurFixe(invalide), opts);
  verifier("tracé refusé par le contrôle : jamais « terminé », échec qui donne la raison", ti.statut === "echec" && ti.erreur_code === "trace_invalide" && ti.meilleur === null && !!ti.erreur_message?.includes("chevauchent"));

  const { store: s2, enregistres } = fauxStore([calculReserve(entree, 2, { id: "a" }), calculReserve(entree, 2, { id: "b" })]);
  await traiterCalculs(s2, lanceurReel, { dureeTrancheS: 2, tempsDisponibleS: 300, intervalleSigneDeVieMs: 200 });
  verifier("boucle de traitement : chaque calcul réservé est enregistré", enregistres.map((e) => e.id).join() === "a,b");
  const { store: s3, enregistres: e3 } = fauxStore([calculReserve(entree, 2)]);
  await traiterCalculs(s3, lanceurReel, { dureeTrancheS: 2, tempsDisponibleS: 35 });
  verifier("plus assez de temps dans la fonction : aucun calcul commencé", e3.length === 0);
}

void main();
