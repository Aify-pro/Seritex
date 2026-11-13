/**
 * Planification de la coupe : à partir des pièces qui restent à couper pour
 * un tissu (semi-fini × taille × couleur), propose les MATELAS — quelles
 * pièces mettre sur une couche (le tracé) et combien de plis de chaque
 * couleur étendre dessous.
 *
 * Calcul DÉTERMINISTE (même entrée = même plan), sans IA : c'est le moteur
 * qui optimise, l'IA ou la personne ne font que le lancer et le lire.
 *
 * Règles :
 *  - jamais de surplus : chaque matelas coupe au plus ce qui reste à couper,
 *    couleur par couleur (le surplus demande un motif à la validation) ;
 *  - une couche tient dans la longueur de table (longueur estimée =
 *    surface des pièces / (laize utile × efficience estimée)) ;
 *  - un matelas ne dépasse pas le nombre de plis maximal (toutes couleurs) ;
 *  - on cherche le moins de matelas possible : chaque matelas couvre la plus
 *    grande surface de pièces possible.
 *
 * La longueur ESTIMÉE sert à composer les matelas ; la vraie longueur, et
 * donc le vrai tissu, vient ensuite du moteur d'imbrication, tracé par
 * tracé (c'est lui qui départage les laizes).
 */

export interface BesoinPlan {
  semiFiniId: string;
  semiFiniNom: string;
  taille: string;
  /** Couleur (libellé) : chaque couleur a ses propres plis. */
  couleur: string;
  /** Pièces (semi-finis) qui restent à couper. */
  reste: number;
  /** Surface d'UN semi-fini de cette taille (toutes ses pièces), mm². Null si le patron manque. */
  surfaceMm2: number | null;
}

export interface OptionsPlan {
  /** Laize utile (mm), lisières déjà retirées. */
  laizeUtileMm: number;
  /** Longueur maximale d'une couche (table de coupe), mm. */
  longueurMaxMm: number;
  /** Plis maximum d'un matelas, toutes couleurs confondues. */
  maxPlis: number;
  /** Efficience estimée du tracé (surface des pièces / surface de tissu), entre 0,5 et 0,95. */
  efficience: number;
}

export interface LigneComposition {
  semiFiniId: string;
  semiFiniNom: string;
  taille: string;
  /** Exemplaires par couche. */
  nombre: number;
}

export interface MatelasPlan {
  numero: number;
  composition: LigneComposition[];
  plis: { couleur: string; plis: number }[];
  totalPlis: number;
  piecesParCouche: number;
  /** Longueur estimée d'une couche (mm), avant calcul du tracé. */
  longueurEstimeeMm: number;
  /** Pièces coupées par ce matelas (toutes couleurs). */
  piecesCoupees: number;
  /** Tissu estimé (mm²) : longueur × laize × plis. */
  tissuEstimeMm2: number;
  /** Matelas de fin (reliquats exacts, un pli par couleur). */
  reliquat: boolean;
}

export interface PlanCoupe {
  matelas: MatelasPlan[];
  /** Besoins non planifiés, avec la raison. */
  exclus: { semiFiniNom: string; taille: string; couleur: string; reste: number; raison: string }[];
  totaux: { pieces: number; plis: number; matelas: number; tissuEstimeM2: number; longueurEstimeeM: number };
  options: OptionsPlan;
}

type Cle = string;

const cle = (b: { semiFiniId: string; taille: string }) => `${b.semiFiniId}|${b.taille}`;

export function controlerOptions(o: OptionsPlan): string | null {
  if (!(o.laizeUtileMm > 0)) return "La laize utile doit être positive.";
  if (!(o.longueurMaxMm > 0)) return "La longueur de table doit être positive.";
  if (!Number.isInteger(o.maxPlis) || o.maxPlis < 1 || o.maxPlis > 1000) return "Le nombre de plis maximal doit être un entier entre 1 et 1000.";
  if (!(o.efficience >= 0.5 && o.efficience <= 0.95)) return "L'efficience estimée doit être comprise entre 50 % et 95 %.";
  return null;
}

export function planifierCoupe(besoins: BesoinPlan[], options: OptionsPlan): PlanCoupe | { erreur: string } {
  const erreur = controlerOptions(options);
  if (erreur) return { erreur };

  const exclus: PlanCoupe["exclus"] = [];
  const articles = new Map<Cle, { semiFiniId: string; semiFiniNom: string; taille: string; surface: number }>();
  const couleurs: string[] = [];
  const reste = new Map<Cle, Map<string, number>>();
  // Surface de tissu disponible sur une couche, en surface de pièces.
  const capacite = options.longueurMaxMm * options.laizeUtileMm * options.efficience;

  for (const b of besoins) {
    if (!Number.isInteger(b.reste) || b.reste <= 0) continue;
    if (b.surfaceMm2 === null || !(b.surfaceMm2 > 0)) {
      exclus.push({ semiFiniNom: b.semiFiniNom, taille: b.taille, couleur: b.couleur, reste: b.reste, raison: "pas de patron dans la bibliothèque pour cette taille" });
      continue;
    }
    if (b.surfaceMm2 > capacite) {
      exclus.push({ semiFiniNom: b.semiFiniNom, taille: b.taille, couleur: b.couleur, reste: b.reste, raison: "pièce trop grande pour une couche de cette longueur" });
      continue;
    }
    const k = cle(b);
    if (!articles.has(k)) articles.set(k, { semiFiniId: b.semiFiniId, semiFiniNom: b.semiFiniNom, taille: b.taille, surface: b.surfaceMm2 });
    if (!couleurs.includes(b.couleur)) couleurs.push(b.couleur);
    const parCouleur = reste.get(k) ?? new Map<string, number>();
    parCouleur.set(b.couleur, (parCouleur.get(b.couleur) ?? 0) + b.reste);
    reste.set(k, parCouleur);
  }

  // Ordre stable : articles et couleurs triés (déterminisme indépendant de l'ordre d'entrée).
  const cles = [...articles.keys()].sort();
  couleurs.sort((a, b) => a.localeCompare(b));
  const r = (k: Cle, c: string) => reste.get(k)?.get(c) ?? 0;
  const surface = (n: Map<Cle, number>) => cles.reduce((s, k) => s + (n.get(k) ?? 0) * articles.get(k)!.surface, 0);

  /** Réduit la composition jusqu'à tenir dans une couche (on retire l'article le plus présent). */
  const ajuster = (n: Map<Cle, number>) => {
    while (surface(n) > capacite) {
      let pire: Cle | null = null;
      for (const k of cles) if ((n.get(k) ?? 0) > 0 && (pire === null || n.get(k)! > n.get(pire)! || (n.get(k) === n.get(pire) && articles.get(k)!.surface > articles.get(pire)!.surface))) pire = k;
      if (pire === null) break;
      n.set(pire, n.get(pire)! - 1);
    }
  };

  /** Plis par couleur pour une composition : sans surplus, plafonnés au total. */
  const plisPour = (n: Map<Cle, number>) => {
    const p = new Map<string, number>();
    for (const c of couleurs) {
      let m = Infinity;
      for (const k of cles) {
        const nk = n.get(k) ?? 0;
        if (nk > 0) m = Math.min(m, Math.floor(r(k, c) / nk));
      }
      p.set(c, Number.isFinite(m) ? m : 0);
    }
    let total = [...p.values()].reduce((a, b) => a + b, 0);
    while (total > options.maxPlis) {
      // Retire un pli à la couleur qui en a le plus (la plus fournie se répartit sur les matelas suivants).
      let c0 = couleurs[0];
      for (const c of couleurs) if (p.get(c)! > p.get(c0)!) c0 = c;
      p.set(c0, p.get(c0)! - 1);
      total--;
    }
    return p;
  };

  const matelas: MatelasPlan[] = [];
  const enregistrer = (n: Map<Cle, number>, p: Map<string, number>, reliquat: boolean) => {
    const totalPlis = [...p.values()].reduce((a, b) => a + b, 0);
    for (const k of cles) for (const c of couleurs) if ((n.get(k) ?? 0) > 0 && (p.get(c) ?? 0) > 0) reste.get(k)!.set(c, r(k, c) - n.get(k)! * p.get(c)!);
    const piecesParCouche = cles.reduce((s, k) => s + (n.get(k) ?? 0), 0);
    const longueur = surface(n) / (options.laizeUtileMm * options.efficience);
    matelas.push({
      numero: matelas.length + 1,
      composition: cles
        .filter((k) => (n.get(k) ?? 0) > 0)
        .map((k) => ({ semiFiniId: articles.get(k)!.semiFiniId, semiFiniNom: articles.get(k)!.semiFiniNom, taille: articles.get(k)!.taille, nombre: n.get(k)! })),
      plis: couleurs.filter((c) => (p.get(c) ?? 0) > 0).map((c) => ({ couleur: c, plis: p.get(c)! })),
      totalPlis,
      piecesParCouche,
      longueurEstimeeMm: Math.round(longueur),
      piecesCoupees: piecesParCouche * totalPlis,
      tissuEstimeMm2: Math.round(longueur * options.laizeUtileMm * totalPlis),
      reliquat,
    });
  };

  // 1. Matelas « pleins » : à chaque tour, la composition qui couvre le plus de surface de pièces.
  for (let tour = 0; tour < 500; tour++) {
    const total = new Map(cles.map((k) => [k, couleurs.reduce((s, c) => s + r(k, c), 0)] as const));
    if ([...total.values()].every((v) => v === 0)) break;

    const candidatsP = new Set<number>([options.maxPlis]);
    for (const k of cles) {
      for (const div of [1, 2, 3, 4]) {
        const v = Math.floor(total.get(k)! / div);
        if (v >= 1 && v <= options.maxPlis) candidatsP.add(v);
      }
      for (const c of couleurs) {
        const v = r(k, c);
        if (v >= 1 && v <= options.maxPlis) candidatsP.add(v);
      }
    }

    let meilleur: { n: Map<Cle, number>; p: Map<string, number>; couvert: number } | null = null;
    for (const P of [...candidatsP].sort((a, b) => b - a)) {
      const n = new Map(cles.map((k) => [k, Math.floor(total.get(k)! / P)] as const));
      if ([...n.values()].every((v) => v === 0)) continue;
      ajuster(n);
      let p = plisPour(n);
      // Élargit la composition aux articles que ces plis permettent encore (sans surplus), puis réajuste.
      for (let passe = 0; passe < 2; passe++) {
        for (const k of cles) {
          let m = Infinity;
          for (const c of couleurs) if ((p.get(c) ?? 0) > 0) m = Math.min(m, Math.floor(r(k, c) / p.get(c)!));
          if (Number.isFinite(m) && m > (n.get(k) ?? 0)) n.set(k, m);
        }
        ajuster(n);
        p = plisPour(n);
      }
      const plis = [...p.values()].reduce((a, b) => a + b, 0);
      const couvert = surface(n) * plis;
      if (couvert > 0 && (!meilleur || couvert > meilleur.couvert)) meilleur = { n, p, couvert };
    }
    // Un matelas d'un seul pli n'est pas un matelas « plein » : laissé aux reliquats.
    if (!meilleur || [...meilleur.p.values()].reduce((a, b) => a + b, 0) < 2) break;
    enregistrer(meilleur.n, meilleur.p, false);
  }

  // 2. Reliquats : ce qui reste, coupé exactement, un pli par couleur ;
  //    les couleurs qui ont exactement le même reste partagent le matelas.
  const groupes = new Map<string, string[]>();
  for (const c of couleurs) {
    const signature = cles.map((k) => r(k, c)).join(",");
    if (cles.every((k) => r(k, c) === 0)) continue;
    groupes.set(signature, [...(groupes.get(signature) ?? []), c]);
  }
  for (const [, cs] of [...groupes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Plis : une couche par couleur, plafonnée au maximum de plis.
    for (let i = 0; i < cs.length; i += options.maxPlis) {
      const lot = cs.slice(i, i + options.maxPlis);
      // Découpe la liste des pièces en couches qui tiennent dans la longueur.
      const aPlacer = cles.flatMap((k) => Array.from({ length: r(k, lot[0]) }, () => k));
      aPlacer.sort((a, b) => articles.get(b)!.surface - articles.get(a)!.surface || a.localeCompare(b));
      const couches: Map<Cle, number>[] = [];
      const libres: number[] = [];
      for (const k of aPlacer) {
        const s = articles.get(k)!.surface;
        let j = libres.findIndex((l) => l >= s);
        if (j < 0) {
          couches.push(new Map());
          libres.push(capacite);
          j = couches.length - 1;
        }
        couches[j].set(k, (couches[j].get(k) ?? 0) + 1);
        libres[j] -= s;
      }
      for (const n of couches) enregistrer(n, new Map(lot.map((c) => [c, 1] as const)), true);
    }
  }

  const tissu = matelas.reduce((s, m) => s + m.tissuEstimeMm2, 0);
  return {
    matelas,
    exclus,
    totaux: {
      pieces: matelas.reduce((s, m) => s + m.piecesCoupees, 0),
      plis: matelas.reduce((s, m) => s + m.totalPlis, 0),
      matelas: matelas.length,
      tissuEstimeM2: Math.round(tissu / 1e4) / 100,
      longueurEstimeeM: Math.round(matelas.reduce((s, m) => s + m.longueurEstimeeMm * m.totalPlis, 0) / 10) / 100,
    },
    options,
  };
}
