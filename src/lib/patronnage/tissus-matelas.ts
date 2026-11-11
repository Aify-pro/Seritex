import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Composition en tissus d'un matelas regroupé : un tracé peut porter des
 * couches de plusieurs tissus (grammages, couleurs). Pour le coupeur, on
 * regroupe les couches par tissu : « Jersey 125 g · Bleu · réf. JE125BLE :
 * 60 couches », avec les ODF concernés.
 *
 * Tissu d'un article d'ODF : son grammage choisi (ligne d'ODF), sinon le
 * tissu de son modèle. Couleur : celle des pièces du tracé sur cet article
 * (couleur imposée, de zone ou unique, 0165). Référence : la déclinaison
 * matière première tissu × couleur (code de l'article stockable, ex.
 * JE180BLA), quand elle existe.
 */

export interface CoucheArticle {
  lineId: string;
  nbCouches: number;
  /** Pièces (semi-finis) posées sur le tracé. */
  semiFiniIds: string[];
  /** Libellé de l'article pour la liste des ODF (« OF-… »). */
  odf: string | null;
}

export interface TissuMatelas {
  tissu: string;
  grammage: number | null;
  couleur: string | null;
  reference: string | null;
  couches: number;
  odfs: { odf: string | null; couches: number }[];
}

export async function compositionTissus(supabase: SupabaseClient, traces: Map<string, CoucheArticle[]>): Promise<Map<string, TissuMatelas[]>> {
  const resultat = new Map<string, TissuMatelas[]>();
  const lineIds = [...new Set([...traces.values()].flat().map((c) => c.lineId))];
  if (lineIds.length === 0) return resultat;

  const [{ data: lignes }, { data: couleursPieces }] = await Promise.all([
    supabase.from("production_order_lines").select("id,textile_id,product_models(textile_id)").in("id", lineIds),
    supabase.rpc("couleurs_pieces_lignes", { p_line_ids: lineIds }),
  ]);
  type Ligne = { id: string; textile_id: string | null; product_models: { textile_id: string | null } | null };
  const textileDe = new Map(((lignes ?? []) as unknown as Ligne[]).map((l) => [l.id, l.textile_id ?? l.product_models?.textile_id ?? null]));
  const pieces = (couleursPieces ?? []) as { line_id: string; semi_fini_id: string; couleur: string | null }[];

  const textileIds = [...new Set([...textileDe.values()].filter((x): x is string => !!x))];
  const nomsCouleurs = [...new Set(pieces.map((p) => p.couleur).filter((x): x is string => !!x && !x.includes(" / ")))];
  const [{ data: textiles }, { data: couleurs }] = await Promise.all([
    textileIds.length > 0 ? supabase.from("textiles").select("id,nom,grammage").in("id", textileIds) : Promise.resolve({ data: [] }),
    nomsCouleurs.length > 0 ? supabase.from("colors").select("id,name").in("name", nomsCouleurs) : Promise.resolve({ data: [] }),
  ]);
  const textile = new Map(((textiles ?? []) as { id: string; nom: string; grammage: number | null }[]).map((t) => [t.id, t]));
  const couleurId = new Map(((couleurs ?? []) as { id: string; name: string }[]).map((c) => [c.name, c.id]));
  const colorIds = [...couleurId.values()];
  const { data: variantes } =
    textileIds.length > 0 && colorIds.length > 0
      ? await supabase.from("product_variants").select("code,textile_id,color_id").in("textile_id", textileIds).in("color_id", colorIds).is("size_id", null)
      : { data: [] };
  const reference = new Map(((variantes ?? []) as { code: string; textile_id: string; color_id: string }[]).map((v) => [`${v.textile_id}|${v.color_id}`, v.code]));

  for (const [traceId, couches] of traces) {
    const groupes = new Map<string, TissuMatelas>();
    for (const c of couches) {
      const tId = textileDe.get(c.lineId) ?? null;
      const t = tId ? textile.get(tId) : undefined;
      const noms = [...new Set(pieces.filter((p) => p.line_id === c.lineId && c.semiFiniIds.includes(p.semi_fini_id)).map((p) => p.couleur ?? "couleur à préciser"))];
      const couleur = noms.length > 0 ? noms.join(", ") : null;
      const cId = noms.length === 1 ? couleurId.get(noms[0]) : undefined;
      const cle = `${tId ?? "?"}|${couleur ?? "?"}`;
      const g =
        groupes.get(cle) ??
        ({
          tissu: t?.nom ?? "Tissu non renseigné",
          grammage: t?.grammage != null ? Number(t.grammage) : null,
          couleur,
          reference: tId && cId ? (reference.get(`${tId}|${cId}`) ?? null) : null,
          couches: 0,
          odfs: [],
        } satisfies TissuMatelas);
      g.couches += c.nbCouches;
      g.odfs.push({ odf: c.odf, couches: c.nbCouches });
      groupes.set(cle, g);
    }
    resultat.set(traceId, [...groupes.values()]);
  }
  return resultat;
}

/** « Jersey 125 g · Bleu · réf. JE125BLE » */
export function libelleTissu(t: Pick<TissuMatelas, "tissu" | "grammage" | "couleur" | "reference">): string {
  return [
    `${t.tissu}${t.grammage && !t.tissu.includes(String(t.grammage)) ? ` ${t.grammage} g` : ""}`,
    t.couleur,
    t.reference ? `réf. ${t.reference}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
