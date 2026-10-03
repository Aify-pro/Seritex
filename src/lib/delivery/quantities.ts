/**
 * Quantités d'expédition (LIV-1) — logique pure, miroir des contrôles de la
 * base (assert_shipment_cap, odf_remaining_to_ship, split_shipment,
 * merge_shipments : migration 0078).
 */

/** Une quantité par ligne d'ODF × taille. */
export interface LineQty {
  lineId: string;
  taille: string;
  quantite: number;
}

const key = (l: Pick<LineQty, "lineId" | "taille">) => `${l.lineId}|${l.taille}`;

function sum(rows: LineQty[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.quantite);
  return m;
}

/** Reste à livrer = 1er choix − quantités déjà en expédition (hors annulées). */
export function remainingToShip(premierChoix: LineQty[], enExpedition: LineQty[]): LineQty[] {
  const shipped = sum(enExpedition);
  return premierChoix
    .map((p) => ({ ...p, quantite: p.quantite - (shipped.get(key(p)) ?? 0) }))
    .filter((r) => r.quantite !== 0);
}

/** Dépassements du plafond : quantités en expédition au-delà du 1er choix. */
export function capViolations(premierChoix: LineQty[], enExpedition: LineQty[]): LineQty[] {
  const fc = sum(premierChoix);
  return [...sum(enExpedition).entries()]
    .map(([k, q]) => {
      const [lineId, taille] = k.split("|");
      return { lineId, taille, quantite: q - (fc.get(k) ?? 0) };
    })
    .filter((v) => v.quantite > 0);
}

/** Scission : retire `moved` de `source` ; refuse de déplacer plus que présent ou de vider la source. */
export function splitLines(source: LineQty[], moved: LineQty[]): { source: LineQty[]; nouvelle: LineQty[] } {
  const remaining = sum(source);
  for (const m of moved) {
    const cur = remaining.get(key(m)) ?? 0;
    if (m.quantite <= 0) continue;
    if (m.quantite > cur) throw new Error(`taille ${m.taille} : on ne peut déplacer que ${cur} pièce(s)`);
    remaining.set(key(m), cur - m.quantite);
  }
  const nouvelle = moved.filter((m) => m.quantite > 0);
  if (nouvelle.length === 0) throw new Error("aucune quantité à déplacer");
  const rest = [...remaining.entries()]
    .filter(([, q]) => q > 0)
    .map(([k, quantite]) => {
      const [lineId, taille] = k.split("|");
      return { lineId, taille, quantite };
    });
  if (rest.length === 0) throw new Error("la scission viderait l'expédition d'origine");
  return { source: rest, nouvelle };
}

/** Regroupement : additionne les lignes (même client seulement). */
export function mergeLines(
  target: { companyId: string; lines: LineQty[] },
  source: { companyId: string; lines: LineQty[] }
): LineQty[] {
  if (target.companyId !== source.companyId) throw new Error("regroupement impossible : clients différents");
  return [...sum([...target.lines, ...source.lines]).entries()].map(([k, quantite]) => {
    const [lineId, taille] = k.split("|");
    return { lineId, taille, quantite };
  });
}

/** État de livraison d'un ODF : non livré, partiel ou livré. */
export function deliveryState(commande: number, premierChoix: number, livre: number): "non_livre" | "partiel" | "livre" {
  if (livre <= 0) return "non_livre";
  return livre >= Math.max(commande, premierChoix) ? "livre" : "partiel";
}
