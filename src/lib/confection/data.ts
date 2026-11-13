import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getSizes } from "@/lib/sizes";

/**
 * Lecture des données du module Confection (migration 0186) : bilan du jour
 * par chaîne, et tout ce qu'une chaîne a en cours (travaux, paquets, sorties).
 * Partagé par le tableau de bord, la fiche chaîne et la tablette de l'agent.
 */

export type BilanChaine = {
  chaine_id: string;
  section_id: string;
  section: string;
  nom: string;
  code: string;
  type: "permanente" | "support";
  affectes: number;
  presents: number | null;
  minutes_presence: number | null;
  source_presence: "pointage" | "saisie" | null;
  entrees: number;
  sorties: number;
  reprises: number;
  rebuts: number;
  en_cours: number;
  minutes_arret: number;
  a_regulariser: number;
};

export type TailleQte = { cle: string; libelle: string; quantite: number };

export type Travail = {
  id: string;
  workOrderId: string;
  lineId: string;
  statut: "a_faire" | "en_cours" | "termine";
  priorite: number;
  consigne: string | null;
  odf: string;
  article: string;
  /** Tailles demandées sur la ligne d'ODF. */
  tailles: TailleQte[];
  demande: number;
  /** Pièces complètes ravitaillées à la chaîne (nomenclature appliquée). */
  ravitaille: number;
  sorti: number;
  rebut: number;
};

export type Paquet = {
  id: string;
  code: string;
  lineId: string;
  piece: string | null;
  tailles: TailleQte[];
  total: number;
};

export type SortieJour = {
  id: string;
  workOrderId: string;
  taille: string;
  type: "bonne" | "reprise" | "rebut";
  quantite: number;
  heure: string;
  aRegulariser: string | null;
  correction: boolean;
};

export type ChaineInfo = { id: string; nom: string; code: string; section_id: string; section: string; type: string; minutes_jour: number; active: boolean };

export const today = () => new Date().toISOString().slice(0, 10);

export async function loadBilan(jour: string): Promise<BilanChaine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confection_bilan_jour", { p_jour: jour });
  if (error) throw new Error(error.message);
  return (data ?? []) as BilanChaine[];
}

/** Chaînes sur lesquelles l'utilisateur peut agir : toutes s'il pilote la confection, sinon celles dont il est agent. */
export async function loadChainesAgent(userId: string, pilote: boolean): Promise<ChaineInfo[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("chaines_couture").select("id,nom,code,section_id,type,minutes_jour,active,sections(name)").eq("active", true).order("ordre").order("nom");
  let rows = (data ?? []) as unknown as (Omit<ChaineInfo, "section"> & { sections: { name: string } | null })[];
  if (!pilote) {
    const { data: liens } = await supabase.from("chaine_agents").select("chaine_id").eq("user_id", userId);
    const miennes = new Set((liens ?? []).map((l) => l.chaine_id as string));
    rows = rows.filter((r) => miennes.has(r.id));
  }
  return rows.map(({ sections, ...r }) => ({ ...r, section: sections?.name ?? "" }));
}

export async function loadChaine(id: string): Promise<ChaineInfo | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("chaines_couture").select("id,nom,code,section_id,type,minutes_jour,active,sections(name)").eq("id", id).maybeSingle();
  if (!data) return null;
  const { sections, ...r } = data as unknown as Omit<ChaineInfo, "section"> & { sections: { name: string } | null };
  return { ...r, section: sections?.name ?? "" };
}

function ordonner(composition: Record<string, number> | null, sizes: { cle: string; libelle: string }[]): TailleQte[] {
  const c = composition ?? {};
  const connues = new Set(sizes.map((s) => s.cle));
  return [
    ...sizes.filter((s) => Number(c[s.cle] ?? 0) > 0).map((s) => ({ cle: s.cle, libelle: s.libelle, quantite: Number(c[s.cle]) })),
    ...Object.keys(c)
      .filter((k) => !connues.has(k) && Number(c[k]) > 0)
      .map((k) => ({ cle: k, libelle: k.split("/").pop() ?? k, quantite: Number(c[k]) })),
  ];
}

type TravailRaw = {
  id: string;
  statut: Travail["statut"];
  priorite: number;
  consigne: string | null;
  work_order_id: string;
  work_orders: {
    production_order_line_id: string | null;
    production_orders: { reference: string } | null;
    production_order_lines: { description: string | null } | null;
  } | null;
};

/** Travaux d'une chaîne (terminés exclus par défaut), paquets présents et paquets encore à aller chercher. */
export async function loadChaineTravail(chaineId: string, { avecTermines = false } = {}) {
  const supabase = await createClient();
  const sizes = await getSizes();
  let query = supabase
    .from("chaine_travaux")
    .select("id,statut,priorite,consigne,work_order_id,work_orders(production_order_line_id,production_orders(reference),production_order_lines(description))")
    .eq("chaine_id", chaineId)
    .order("priorite", { ascending: false })
    .order("attribue_le");
  if (!avecTermines) query = query.neq("statut", "termine");
  const { data: travauxRaw } = await query;
  const raws = ((travauxRaw ?? []) as unknown as TravailRaw[]).filter((t) => t.work_orders?.production_order_line_id);
  const lineIds = [...new Set(raws.map((t) => t.work_orders!.production_order_line_id!))];

  const [{ data: tailles }, { data: sorties }, { data: surChaine }, { data: aChercher }, completes] = await Promise.all([
    lineIds.length
      ? supabase.from("production_order_sizes").select("production_order_line_id,taille,quantite_demandee").in("production_order_line_id", lineIds)
      : Promise.resolve({ data: [] as { production_order_line_id: string; taille: string; quantite_demandee: number }[] }),
    supabase.from("sorties_chaine").select("work_order_id,type,quantite").eq("chaine_id", chaineId),
    supabase.from("article_lots").select("id,code,production_order_line_id,composition_taille,product_models(name)").eq("chaine_id", chaineId).eq("statut", "en_cours").order("created_at"),
    lineIds.length
      ? supabase
          .from("article_lots")
          .select("id,code,production_order_line_id,composition_taille,product_models(name)")
          .in("production_order_line_id", lineIds)
          .eq("statut", "en_cours")
          .is("chaine_id", null)
          .not("semi_fini_id", "is", null)
          .order("created_at")
      : Promise.resolve({ data: [] }),
    Promise.all(
      lineIds.map(async (lineId) => {
        const { data } = await supabase.rpc("chaine_pieces_completes", { p_chaine_id: chaineId, p_line_id: lineId });
        return [lineId, ((data ?? []) as { pieces: number }[]).reduce((s, r) => s + Number(r.pieces), 0)] as const;
      })
    ),
  ]);

  const ravitaille = new Map(completes);
  const somme = (wo: string, types: string[]) =>
    ((sorties ?? []) as { work_order_id: string; type: string; quantite: number }[])
      .filter((s) => s.work_order_id === wo && types.includes(s.type))
      .reduce((n, s) => n + s.quantite, 0);

  const travaux: Travail[] = raws.map((t) => {
    const lineId = t.work_orders!.production_order_line_id!;
    const demandees = Object.fromEntries(
      ((tailles ?? []) as { production_order_line_id: string; taille: string; quantite_demandee: number }[])
        .filter((x) => x.production_order_line_id === lineId)
        .map((x) => [x.taille, x.quantite_demandee])
    );
    const tl = ordonner(demandees, sizes);
    return {
      id: t.id,
      workOrderId: t.work_order_id,
      lineId,
      statut: t.statut,
      priorite: t.priorite,
      consigne: t.consigne,
      odf: t.work_orders?.production_orders?.reference ?? "",
      article: t.work_orders?.production_order_lines?.description ?? "Article",
      tailles: tl,
      demande: tl.reduce((n, x) => n + x.quantite, 0),
      ravitaille: ravitaille.get(lineId) ?? 0,
      sorti: somme(t.work_order_id, ["bonne"]),
      rebut: somme(t.work_order_id, ["rebut"]),
    };
  });

  type LotRaw = { id: string; code: string; production_order_line_id: string; composition_taille: Record<string, number>; product_models: { name: string } | null };
  const paquet = (l: LotRaw): Paquet => {
    const t = ordonner(l.composition_taille, sizes);
    return { id: l.id, code: l.code, lineId: l.production_order_line_id, piece: l.product_models?.name ?? null, tailles: t, total: t.reduce((n, x) => n + x.quantite, 0) };
  };

  return {
    travaux,
    paquetsSurChaine: ((surChaine ?? []) as unknown as LotRaw[]).map(paquet),
    paquetsAChercher: ((aChercher ?? []) as unknown as LotRaw[]).map(paquet),
  };
}

export async function loadSortiesJour(chaineId: string, jour: string): Promise<SortieJour[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sorties_chaine")
    .select("id,work_order_id,taille,type,quantite,created_at,declaration_id,declaration_erreur,corrige_id")
    .eq("chaine_id", chaineId)
    .eq("jour", jour)
    .order("created_at", { ascending: false });
  return ((data ?? []) as { id: string; work_order_id: string; taille: string; type: SortieJour["type"]; quantite: number; created_at: string; declaration_id: string | null; declaration_erreur: string | null; corrige_id: string | null }[]).map((s) => ({
    id: s.id,
    workOrderId: s.work_order_id,
    taille: s.taille,
    type: s.type,
    quantite: s.quantite,
    heure: s.created_at,
    aRegulariser: !s.declaration_id && s.declaration_erreur ? s.declaration_erreur : null,
    correction: s.corrige_id !== null,
  }));
}

/** Rendement lisible sans temps par article : pièces par personne présente. */
export function piecesParPersonne(b: Pick<BilanChaine, "sorties" | "presents">): number | null {
  return b.presents && b.presents > 0 ? Math.round((b.sorties / b.presents) * 10) / 10 : null;
}
