import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EcranCadre, Machine } from "./parc";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Machines et écrans (migration 0119). Le coût horaire n'est lu qu'avec les
 * droits Tarification (RLS) : sinon il reste absent.
 */
export async function chargerParc(db?: Db, { actifsSeulement = false, famille }: { actifsSeulement?: boolean; famille?: Machine["famille"] } = {}): Promise<{ machines: Machine[]; ecrans: EcranCadre[] }> {
  const supabase = db ?? (await createClient());
  let requete = supabase.from("machines").select("*").order("nom");
  if (actifsSeulement) requete = requete.eq("active", true);
  if (famille) requete = requete.eq("famille", famille);
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
        famille: (m.famille as Machine["famille"]) ?? "serigraphie",
        type: m.type,
        nbStations: Number(m.nb_stations),
        nbTetes: Number(m.nb_tetes),
        formatMaxLCm: m.format_max_l_cm != null ? Number(m.format_max_l_cm) : null,
        formatMaxHCm: m.format_max_h_cm != null ? Number(m.format_max_h_cm) : null,
        sechage: m.sechage,
        cadencePiecesH: m.cadence_pieces_h != null ? Number(m.cadence_pieces_h) : null,
        notes: (m.notes as string | null) ?? null,
        active: !!m.active,
        marqueModele: (m.marque_modele as string | null) ?? null,
        technologieEncre: (m.technologie_encre as string | null) ?? null,
        nbCanauxEncre: m.nb_canaux_encre != null ? Number(m.nb_canaux_encre) : null,
        encreBlanche: !!m.encre_blanche,
        modeleTetes: (m.modele_tetes as string | null) ?? null,
        resolutionDpi: m.resolution_dpi != null ? Number(m.resolution_dpi) : null,
        vitesseM2H: m.vitesse_m2_h != null ? Number(m.vitesse_m2_h) : null,
        consoEncreMlM2: m.conso_encre_ml_m2 != null ? Number(m.conso_encre_ml_m2) : null,
        ripLogiciel: (m.rip_logiciel as string | null) ?? null,
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
