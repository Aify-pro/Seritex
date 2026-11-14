/**
 * Contrôle d'une répartition des opérations sur les postes — tâche C-03.
 *
 * Indépendant de l'algorithme de répartition : ce fichier n'importe pas
 * `repartition.ts` et refait ses propres vérifications à partir des seules
 * données (opérations, postes, cadence). Il sert à vérifier ce que propose
 * le logiciel comme ce qu'un chef d'atelier a modifié à la main.
 *
 * Ce qui est vérifié :
 *  1. chaque opération de chaîne est sur un poste et un seul (les opérations
 *     communes, C7, ne sont sur aucun poste) ;
 *  2. les précédences : une opération vient après toutes celles qu'elle doit
 *     suivre — sur un poste placé après, ou plus loin sur le même poste. Les
 *     postes sont pris dans l'ordre de la liste, les opérations d'un poste
 *     dans l'ordre où elles sont écrites ;
 *  3. la règle de regroupement (voir `RegleRegroupement`) : sur un poste à
 *     plusieurs opérations, un seul type de machine, et des opérations qui se
 *     suivent ;
 *  4. la cadence : temps du poste ÷ personnes ≤ cadence. Un poste ne dépasse
 *     donc la cadence que s'il est tenu par assez de personnes en parallèle.
 */
import { EPS, EquilibrageErreur, validerOperations, type Operation, type Poste, type RegleRegroupement } from "./equilibrage";

export type OptionsControle = {
  /** Règle de regroupement à faire respecter ; par défaut `machine_et_suite`. */
  regroupement?: RegleRegroupement;
};

const nom = (op: Operation) => `${op.code} (${op.libelle})`;
const machine = (type: string | null) => (type === null ? "manuel" : type);
/** Nombre lisible dans un message : 3 décimales au plus, virgule française. */
const nombre = (x: number) => String(Math.round(x * 1000) / 1000).replace(".", ",");

/**
 * Rend la liste des anomalies d'une répartition, en français ; liste vide =
 * répartition valable. Ne lève une erreur que si les données de départ sont
 * elles-mêmes invalides (opérations, cadence).
 */
export function controlerRepartition(
  operations: Operation[],
  postes: Poste[],
  cadenceMin: number,
  options: OptionsControle = {},
): string[] {
  validerOperations(operations);
  if (!Number.isFinite(cadenceMin) || cadenceMin <= 0) {
    throw new EquilibrageErreur(`La cadence doit être un nombre strictement positif (reçu : ${cadenceMin}).`);
  }
  const regroupement: RegleRegroupement = options.regroupement ?? "machine_et_suite";
  const anomalies: string[] = [];
  const parCode = new Map(operations.map((o) => [o.code, o]));

  if (postes.length === 0) anomalies.push("La répartition n'a aucun poste.");

  // --- 1. Postes bien formés, chaque opération une fois et une seule ---------
  /** Place de chaque opération : rang du poste, rang dans le poste. */
  const place = new Map<string, { poste: number; rang: number }>();
  const codesPostes = new Set<string>();
  postes.forEach((poste, i) => {
    if (codesPostes.has(poste.code)) anomalies.push(`Le poste ${poste.code} apparaît deux fois.`);
    codesPostes.add(poste.code);
    if (!Number.isInteger(poste.personnes) || poste.personnes < 1) {
      anomalies.push(`Le poste ${poste.code} doit avoir un nombre entier de personnes, au moins 1 (reçu : ${poste.personnes}).`);
    }
    if (poste.operations.length === 0) anomalies.push(`Le poste ${poste.code} n'a aucune opération.`);
    poste.operations.forEach((code, rang) => {
      const op = parCode.get(code);
      if (!op) {
        anomalies.push(`Le poste ${poste.code} porte l'opération ${code}, qui n'existe pas.`);
        return;
      }
      if (op.commune) {
        anomalies.push(`L'opération ${nom(op)} est commune à toutes les chaînes : elle ne se place pas sur le poste ${poste.code}.`);
        return;
      }
      const deja = place.get(code);
      if (deja) {
        const autre = postes[deja.poste].code;
        anomalies.push(
          autre === poste.code
            ? `L'opération ${nom(op)} est placée deux fois sur le poste ${poste.code}.`
            : `L'opération ${nom(op)} est placée sur deux postes : ${autre} et ${poste.code}.`,
        );
        return;
      }
      place.set(code, { poste: i, rang });
    });
  });
  for (const op of operations) {
    if (!op.commune && !place.has(op.code)) anomalies.push(`L'opération ${nom(op)} n'est sur aucun poste.`);
  }

  // --- 2. Précédences --------------------------------------------------------
  // Opérations de chaîne à faire juste avant `op` ; une opération commune est
  // traversée (A → commune → B : B doit rester après A).
  const avant = (op: Operation): Operation[] => {
    const trouvees = new Map<string, Operation>();
    const pile = [...op.precedences];
    const vues = new Set<string>();
    while (pile.length > 0) {
      const code = pile.pop()!;
      if (vues.has(code)) continue;
      vues.add(code);
      const p = parCode.get(code)!;
      if (p.commune) pile.push(...p.precedences);
      else trouvees.set(code, p);
    }
    return [...trouvees.values()];
  };

  /** Paires « à faire juste avant → après », entre opérations placées. */
  const liens: [string, string][] = [];
  for (const op of operations) {
    if (op.commune) continue;
    const ici = place.get(op.code);
    for (const prec of avant(op)) {
      const la = place.get(prec.code);
      if (!ici || !la) continue; // déjà signalée comme non placée
      liens.push([prec.code, op.code]);
      if (la.poste > ici.poste) {
        anomalies.push(
          `Précédence non respectée : ${nom(op)} (poste ${postes[ici.poste].code}) doit venir après ${nom(prec)}, placée plus loin (poste ${postes[la.poste].code}).`,
        );
      } else if (la.poste === ici.poste && la.rang > ici.rang) {
        anomalies.push(
          `Précédence non respectée sur le poste ${postes[ici.poste].code} : ${nom(op)} doit venir après ${nom(prec)}.`,
        );
      }
    }
  }

  // --- 3. Règle de regroupement et 4. cadence, poste par poste ---------------
  postes.forEach((poste, i) => {
    const ops = poste.operations
      .filter((code, rang) => {
        const p = place.get(code);
        return p !== undefined && p.poste === i && p.rang === rang;
      })
      .map((code) => parCode.get(code)!);
    if (ops.length === 0) return;

    if (regroupement === "machine_et_suite" && ops.length > 1) {
      if (ops.some((o) => o.typeMachine !== ops[0].typeMachine)) {
        anomalies.push(
          `Le poste ${poste.code} réunit des opérations de machines différentes (${ops.map((o) => `${o.code} : ${machine(o.typeMachine)}`).join(", ")}).`,
        );
      }
      // « Se suivent » : en partant de la première opération et en passant
      // d'une opération à l'autre par les précédences directes internes au
      // poste, on doit les atteindre toutes.
      const duPoste = new Set(ops.map((o) => o.code));
      const atteintes = new Set<string>([ops[0].code]);
      let progres = true;
      while (progres) {
        progres = false;
        for (const [a, b] of liens) {
          if (!duPoste.has(a) || !duPoste.has(b)) continue;
          if (atteintes.has(a) !== atteintes.has(b)) {
            atteintes.add(a);
            atteintes.add(b);
            progres = true;
          }
        }
      }
      const isolees = ops.filter((o) => !atteintes.has(o.code));
      if (isolees.length > 0) {
        anomalies.push(
          `Le poste ${poste.code} réunit des opérations qui ne se suivent pas : ${isolees.map(nom).join(", ")} ${isolees.length > 1 ? "ne sont reliées" : "n'est reliée"} par aucune précédence directe à ${nom(ops[0])}.`,
        );
      }
    }

    if (Number.isInteger(poste.personnes) && poste.personnes >= 1) {
      const temps = ops.reduce((s, o) => s + o.tempsMin, 0);
      const parPersonne = temps / poste.personnes;
      if (parPersonne > cadenceMin + EPS) {
        anomalies.push(
          poste.personnes === 1
            ? `Le poste ${poste.code} dépasse la cadence : ${nombre(temps)} min pour une cadence de ${nombre(cadenceMin)} min, avec une seule personne.`
            : `Le poste ${poste.code} dépasse la cadence : ${nombre(temps)} min à ${poste.personnes} personnes = ${nombre(parPersonne)} min par personne, pour une cadence de ${nombre(cadenceMin)} min.`,
        );
      }
    }
  });

  return anomalies;
}
