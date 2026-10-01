/**
 * Dispatching automatique des tailles d'une ligne de devis (lot C du chantier
 * Tarification, migration 0066).
 *
 * La règle vit dans Paramètres > Dispatching : par groupe de tailles (Homme,
 * Femme…) et par palier de quantité, un pourcentage par taille. Le devis
 * propose la répartition qui en découle ; le commercial puis le client peuvent
 * l'ajuster, tant que le total reste égal à la quantité de la ligne.
 *
 * Module pur (aucun accès base) : partagé par le formulaire de devis, l'écran
 * client et le banc de test scripts/test-dispatching.ts.
 */

/** Répartition : clé de taille (« Groupe/Libellé ») → quantité. */
export type Dispatch = Record<string, number>;

export interface DispatchRule {
  id: string;
  groupe: string;
  /** Palier : quantité minimale incluse. */
  qtyMin: number;
  /** Palier : quantité maximale incluse — null = sans limite haute. */
  qtyMax: number | null;
  /** Pourcentage par clé de taille. */
  pcts: Record<string, number>;
}

/**
 * Règle applicable à une quantité : le palier du groupe qui la contient. Si
 * plusieurs paliers se chevauchent, le plus spécifique (borne basse la plus
 * haute) l'emporte — une saisie maladroite ne bloque donc jamais le devis.
 */
export function pickRule(rules: DispatchRule[], groupe: string, quantity: number): DispatchRule | null {
  const candidates = rules.filter(
    (r) => r.groupe === groupe && quantity >= r.qtyMin && (r.qtyMax === null || quantity <= r.qtyMax)
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, r) => (r.qtyMin > best.qtyMin ? r : best));
}

/**
 * Répartit `quantity` selon les pourcentages de la règle, restreints aux
 * tailles disponibles pour le modèle (dans l'ordre métier de `availableCles`).
 * Les pourcentages retenus sont renormalisés : une taille absente du modèle ne
 * fait pas « disparaître » de pièces. L'arrondi suit la méthode des plus forts
 * restes — le total tombe toujours exactement sur la quantité ; à reste égal,
 * la taille au pourcentage le plus fort puis la première dans l'ordre métier
 * l'emporte, pour un résultat stable.
 */
export function generateDispatch(quantity: number, rule: DispatchRule, availableCles: string[]): Dispatch {
  if (!Number.isInteger(quantity) || quantity <= 0) return {};
  const retained = availableCles.filter((cle) => (rule.pcts[cle] ?? 0) > 0);
  const totalPct = retained.reduce((s, cle) => s + rule.pcts[cle], 0);
  if (retained.length === 0 || totalPct <= 0) return {};

  const parts = retained.map((cle, order) => {
    const exact = (quantity * rule.pcts[cle]) / totalPct;
    return { cle, order, pct: rule.pcts[cle], base: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let missing = quantity - parts.reduce((s, p) => s + p.base, 0);
  const byRest = [...parts].sort((a, b) => b.rest - a.rest || b.pct - a.pct || a.order - b.order);
  for (const p of byRest) {
    if (missing <= 0) break;
    p.base += 1;
    missing -= 1;
  }

  const out: Dispatch = {};
  for (const p of parts) if (p.base > 0) out[p.cle] = p.base;
  return out;
}

export function dispatchTotal(d: Dispatch): number {
  return Object.values(d).reduce((s, v) => s + (v ?? 0), 0);
}

/** Écart entre la répartition et la quantité de la ligne (0 = complet). */
export function dispatchGap(d: Dispatch, quantity: number): number {
  return dispatchTotal(d) - quantity;
}

/** Retire les tailles à 0 — seule forme enregistrée (quantite > 0 en base). */
export function compactDispatch(d: Dispatch): Dispatch {
  const out: Dispatch = {};
  for (const [cle, q] of Object.entries(d)) if (q > 0) out[cle] = q;
  return out;
}

/** Total des pourcentages d'une règle — doit valoir 100 pour être enregistrée. */
export function rulePctTotal(pcts: Record<string, number>): number {
  return Math.round(Object.values(pcts).reduce((s, v) => s + (v ?? 0), 0) * 100) / 100;
}
