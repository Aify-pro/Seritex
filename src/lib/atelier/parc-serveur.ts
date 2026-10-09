import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EcranCadre, Machine } from "./parc";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Machines et écrans (migration 0119). Le coût horaire n'est lu qu'avec les
 * droits Tarification (RLS) : sinon il reste absent.
 */
export async function chargerParc(db?: Db, { actifsSeulement = false } = {}): Promise<{ machines: Machine[]; ecrans: EcranCadre[] }> {
  const supabase = db ?? (await createClient());
  let requete = supabase.from("machines").select("*").order("nom");
  if (actifsSeulement) requete = requete.eq("active", true);
  const [{ data: machines }, { data: couts }, { data: ecrans }] = await Promise.all([
    requete,
    supabase.from("machine_couts").select("machine_id,cout_horaire"),
    supabase.from("ecrans_cadres").select("*").order("code"),
  ]);
  return {
    machines: (machines ?? []).map((m) => {
      const c = (couts ?? []).find((x) => x.machine_id === m.id);
      return {
        id: m.id as string,
        nom: m.nom as string,
        type: m.type,
        nbStations: Number(m.nb_stations),
        nbTetes: Number(m.nb_tetes),
        formatMaxLCm: m.format_max_l_cm != null ? Number(m.format_max_l_cm) : null,
        formatMaxHCm: m.format_max_h_cm != null ? Number(m.format_max_h_cm) : null,
        sechage: m.sechage,
        cadencePiecesH: m.cadence_pieces_h != null ? Number(m.cadence_pieces_h) : null,
        notes: (m.notes as string | null) ?? null,
        active: !!m.active,
        ...(c ? { coutHoraire: Number(c.cout_horaire) } : {}),
      };
    }),
    ecrans: (ecrans ?? []).map((e) => ({
      id: e.id as string,
      code: e.code as string,
      largeurCm: Number(e.largeur_cm),
      hauteurCm: Number(e.hauteur_cm),
      maillage: Number(e.maillage),
      couleurMaille: e.couleur_maille,
      etat: e.etat,
      travail: (e.travail as string | null) ?? null,
      emplacement: (e.emplacement as string | null) ?? null,
      notes: (e.notes as string | null) ?? null,
    })),
  };
}
