/**
 * Tests du planificateur de coupe (phase 4) : invariants vérifiés sur des
 * cas construits et sur 300 cas tirés au hasard (graine fixe).
 *  - rien n'est coupé en trop, tout est coupé (coupé = demandé, couleur par couleur) ;
 *  - chaque couche tient dans la longueur de table, chaque matelas dans le maximum de plis ;
 *  - même entrée (même dans un autre ordre) = même plan.
 *
 * Lancer : npm run test:planification
 */
import { planifierCoupe, type BesoinPlan, type OptionsPlan, type PlanCoupe } from "../src/lib/imbrication/planification";

let echecs = 0;
let total = 0;
function verifier(nom: string, condition: boolean, detail?: unknown) {
  total++;
  if (condition) console.log(`  ✓ ${nom}`);
  else {
    echecs++;
    console.log(`  ✗ ${nom}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 800));
  }
}

const TAILLES = ["S", "M", "L", "XL", "XXL"];
const surfaceTaille = (t: string) => 300_000 + 40_000 * TAILLES.indexOf(t); // mm² d'un corps
const besoin = (sf: string, t: string, c: string, n: number, s: number | null = surfaceTaille(t)): BesoinPlan => ({
  semiFiniId: sf,
  semiFiniNom: sf,
  taille: t,
  couleur: c,
  reste: n,
  surfaceMm2: s,
});
const opts = (o: Partial<OptionsPlan> = {}): OptionsPlan => ({ laizeUtileMm: 1600, longueurMaxMm: 12_000, maxPlis: 100, efficience: 0.85, ...o });

function invariants(nom: string, besoins: BesoinPlan[], o: OptionsPlan, plan: PlanCoupe | { erreur: string }) {
  if ("erreur" in plan) return verifier(`${nom} : plan calculé`, false, plan.erreur);
  const demande = new Map<string, number>();
  for (const b of besoins) if (b.surfaceMm2) demande.set(`${b.semiFiniId}|${b.taille}|${b.couleur}`, (demande.get(`${b.semiFiniId}|${b.taille}|${b.couleur}`) ?? 0) + b.reste);
  const coupe = new Map<string, number>();
  for (const m of plan.matelas)
    for (const l of m.composition) for (const p of m.plis) coupe.set(`${l.semiFiniId}|${l.taille}|${p.couleur}`, (coupe.get(`${l.semiFiniId}|${l.taille}|${p.couleur}`) ?? 0) + l.nombre * p.plis);
  const ecarts = [...new Set([...demande.keys(), ...coupe.keys()])].filter((k) => (demande.get(k) ?? 0) !== (coupe.get(k) ?? 0));
  const tropLong = plan.matelas.filter((m) => m.longueurEstimeeMm > o.longueurMaxMm + 1);
  const tropPlis = plan.matelas.filter((m) => m.totalPlis > o.maxPlis);
  const ok = ecarts.length === 0 && tropLong.length === 0 && tropPlis.length === 0;
  if (!ok) verifier(`${nom} : coupé = demandé, couches et plis dans les limites`, false, { ecarts: ecarts.slice(0, 5).map((k) => [k, demande.get(k), coupe.get(k)]), tropLong: tropLong.length, tropPlis: tropPlis.length });
  return ok;
}

function main() {
  console.log("H. Planification de la coupe");
  const serie = (c: string, f = 1) => [besoin("CAV", "S", c, 40 * f), besoin("CAV", "M", c, 80 * f), besoin("CAV", "L", c, 120 * f), besoin("CAV", "XL", c, 80 * f), besoin("CAV", "XXL", c, 40 * f)];

  const b1 = serie("Blanc");
  const p1 = planifierCoupe(b1, opts());
  verifier(
    "série 1-2-3-2-1 (40/80/120/80/40), une couleur : un seul matelas de 9 pièces × 40 plis",
    !("erreur" in p1) && p1.matelas.length === 1 && p1.matelas[0].piecesParCouche === 9 && p1.matelas[0].totalPlis === 40,
    p1
  );
  invariants("série simple", b1, opts(), p1);

  const b2 = [...serie("Blanc"), ...serie("Noir", 0.5)];
  const p2 = planifierCoupe(b2, opts());
  verifier(
    "deux couleurs de même répartition : un matelas, plis 40 + 20",
    !("erreur" in p2) && p2.matelas.length === 1 && JSON.stringify(p2.matelas[0].plis) === JSON.stringify([{ couleur: "Blanc", plis: 40 }, { couleur: "Noir", plis: 20 }]),
    p2
  );
  invariants("deux couleurs", b2, opts(), p2);

  const court = opts({ longueurMaxMm: 1500 });
  const p3 = planifierCoupe(b1, court);
  verifier("table courte : plusieurs matelas, chacun tient dans la longueur", !("erreur" in p3) && p3.matelas.length > 1 && p3.matelas.every((m) => m.longueurEstimeeMm <= 1500), p3);
  invariants("table courte", b1, court, p3);

  const peuDePlis = opts({ maxPlis: 25 });
  const p4 = planifierCoupe(b1, peuDePlis);
  verifier("25 plis au plus : respecté", !("erreur" in p4) && p4.matelas.every((m) => m.totalPlis <= 25), p4);
  invariants("plis limités", b1, peuDePlis, p4);

  const b5 = [besoin("CAV", "M", "Blanc", 7), besoin("MC", "M", "Blanc", 13, 120_000), besoin("CAV", "L", "Rouge", 3)];
  const p5 = planifierCoupe(b5, opts());
  invariants("quantités irrégulières (reliquats)", b5, opts(), p5);
  verifier("reliquats coupés exactement (matelas de fin signalés)", !("erreur" in p5) && p5.matelas.some((m) => m.reliquat), p5);

  const melange = [...b2].reverse();
  verifier("même entrée dans un autre ordre : même plan", JSON.stringify(planifierCoupe(melange, opts())) === JSON.stringify(p2));

  const p6 = planifierCoupe([...b1, besoin("POCHE", "M", "Blanc", 10, null)], opts());
  verifier("taille sans patron : exclue, avec la raison", !("erreur" in p6) && p6.exclus.length === 1 && p6.exclus[0].raison.includes("patron"), p6);
  verifier("options invalides : refusées", "erreur" in planifierCoupe(b1, opts({ efficience: 1.2 })) && "erreur" in planifierCoupe(b1, opts({ maxPlis: 0 })));

  // Cas au hasard (graine fixe) : les invariants doivent toujours tenir.
  let graine = 12345;
  const alea = () => ((graine = (graine * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let bons = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const couleurs = ["Blanc", "Noir", "Rouge", "Bleu"].slice(0, 1 + Math.floor(alea() * 4));
    const sfs = ["CAV", "CAR", "MC"].slice(0, 1 + Math.floor(alea() * 3));
    const bs: BesoinPlan[] = [];
    for (const c of couleurs) for (const sf of sfs) for (const t of TAILLES) if (alea() < 0.8) bs.push(besoin(sf, t, c, Math.floor(alea() * 150), surfaceTaille(t) * (sf === "MC" ? 0.4 : 1)));
    const o = opts({ longueurMaxMm: 2000 + Math.floor(alea() * 12_000), maxPlis: 1 + Math.floor(alea() * 120), efficience: 0.7 + alea() * 0.2 });
    if (invariants(`cas ${i}`, bs, o, planifierCoupe(bs, o))) bons++;
  }
  verifier(`${N} cas au hasard : coupé = demandé, longueur et plis respectés`, bons === N, `${bons}/${N}`);

  console.log(`\n${total - echecs}/${total} vérifications réussies.`);
  if (echecs > 0) process.exit(1);
}

main();

// I. Catalogue des outils des agents IA : noms uniques, schémas JSON stricts.
void (async () => {
  const { catalogueOutils } = await import("../src/lib/agents/outils-imbrication");
  const cat = catalogueOutils();
  console.log("I. Outils des agents IA");
  const noms = cat.map((o) => o.name);
  const ok =
    noms.length === new Set(noms).size &&
    ["besoins_de_coupe", "planifier_coupe", "lancer_calcul_trace", "etat_calculs_trace"].every((n) => noms.includes(n)) &&
    !noms.some((n) => /utiliser|valider/.test(n)) &&
    cat.every((o) => o.inputSchema.type === "object" && o.inputSchema.additionalProperties === false && /droit requis/.test(o.description));
  console.log(ok ? `  ✓ ${noms.length} outils, noms uniques, schémas stricts, aucun outil qui utilise ou valide un tracé` : `  ✗ catalogue invalide ${JSON.stringify(cat).slice(0, 500)}`);
  if (!ok) process.exit(1);
})();
