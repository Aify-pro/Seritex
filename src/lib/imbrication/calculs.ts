import "server-only";
import { after } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { entreeSchema, type EntreeImbricationNormalisee, type SortieImbrication } from "./contrat";
import { traiterCalculs, type CalculReserve, type MiseAJourCalcul, type StoreCalculs } from "./execution";
import { lancerImbrication } from "./moteur";
import { chargerPatrons, construireEntree, type PieceCalcul } from "./patrons";
import type { ResultatValidation } from "./validation";

/**
 * Calculs d'imbrication : création, annulation, lecture (pour l'interface
 * et, plus tard, les agents IA) et traitement en arrière-plan.
 *
 * Ce module est une voie FACULTATIVE : il ne touche ni aux tracés déposés
 * depuis Modaris / Diamino, ni aux fiches. Un calcul terminé est une
 * proposition ; en faire un tracé de la fiche sera une décision humaine
 * (phase 3).
 */

/** Durée d'une tranche : 240 s par défaut (fonction Vercel de 300 s). */
export function dureeTrancheS(): number {
  const v = Number(process.env.IMBRICATION_TRANCHE_S);
  return Number.isFinite(v) && v >= 10 ? v : 240;
}

/** Préréglages proposés à l'interface (secondes de calcul). */
export const PREREGLAGES_TEMPS = { rapide: 30, normal: 120, approfondi: 600 } as const;

export const parametresCalculSchema = z
  .object({
    libelle: z.string().trim().max(200).optional(),
    ficheId: z.string().uuid().nullable().optional(),
    demandes: z
      .array(z.object({ semiFiniId: z.string().uuid(), taille: z.string().min(1), quantite: z.number().int().min(0).max(10_000) }))
      .min(1),
    tissu: z.object({
      largeurUtileMm: z.number().positive().max(10_000),
      margeLisiereMm: z.number().min(0).max(500).optional(),
      longueurMaxMm: z.number().positive().max(200_000).nullable().optional(),
      espacementMm: z.number().min(0).max(100).optional(),
    }),
    tempsS: z.number().positive().max(4 * 3600),
    graine: z.number().int().min(0).max(2 ** 31).optional(),
    /** Budget d'effort : calcul reproductible, en une seule tranche. */
    effort: z.number().int().min(1).nullable().optional(),
  })
  .strict();

export type ParametresCalcul = z.input<typeof parametresCalculSchema>;

export async function creerCalculImbrication(parametres: ParametresCalcul): Promise<{ id: string } | { error: string }> {
  const { authId } = await requirePermission("patronnage_traces", "create");
  const lecture = parametresCalculSchema.safeParse(parametres);
  if (!lecture.success) return { error: `Paramètres invalides : ${lecture.error.issues[0]?.message ?? "valeur refusée"}` };
  const p = lecture.data;
  if (p.effort && p.tempsS > dureeTrancheS()) {
    return { error: `Un calcul reproductible (budget d'effort) doit tenir en une tranche : ${dureeTrancheS()} s au plus.` };
  }

  const supabase = await createClient();
  const patrons = await chargerPatrons(supabase, p.demandes);
  if ("error" in patrons) return { error: patrons.error };
  const graine = p.graine ?? Math.floor(Math.random() * 2 ** 31);
  const prep = construireEntree(patrons, p.demandes, p.tissu, { tempsS: p.tempsS, graine, effort: p.effort ?? null });
  if (!prep.ok) return { error: prep.message };
  const entree = entreeSchema.safeParse(prep.entree);
  if (!entree.success) return { error: "Les pièces préparées sont refusées par le contrat du moteur." };

  const { data, error } = await supabase
    .from("imbrication_calculs")
    .insert({
      libelle: p.libelle ?? null,
      fiche_id: p.ficheId ?? null,
      parametres: { ...p, graine },
      entree: entree.data,
      pieces: prep.pieces,
      temps_total_s: p.tempsS,
      demande_par: authId,
    })
    .select("id")
    .single();
  if (error) return { error: `Enregistrement du calcul impossible : ${error.message}` };

  await declencherTraitement();
  return { id: data.id as string };
}

export async function annulerCalculImbrication(id: string): Promise<{ resultat: "annule" | "annulation_demandee" } | { error: string }> {
  await requirePermission("patronnage_traces", "create");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("annuler_calcul_imbrication", { p_id: id });
  if (error) return { error: error.message };
  return { resultat: data as "annule" | "annulation_demandee" };
}

export interface CalculImbricationLu {
  id: string;
  libelle: string | null;
  ficheId: string | null;
  statut: "en_attente" | "en_cours" | "termine" | "echec" | "annule";
  tempsTotalS: number;
  tempsConsommeS: number;
  tranches: number;
  longueurMm: number | null;
  tauxUtilisation: number | null;
  reproductible: boolean | null;
  erreur: { code: string | null; message: string } | null;
  annulationDemandee: boolean;
  pieces: PieceCalcul[];
  entree: EntreeImbricationNormalisee;
  meilleur: SortieImbrication | null;
  validation: ResultatValidation | null;
  demandeParAgent: string | null;
  createdAt: string;
  finLe: string | null;
}

export async function lireCalculImbrication(id: string): Promise<CalculImbricationLu | null> {
  await requirePermission("patronnage", "view");
  const supabase = await createClient();
  const { data } = await supabase.from("imbrication_calculs").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    libelle: data.libelle,
    ficheId: data.fiche_id,
    statut: data.statut,
    tempsTotalS: Number(data.temps_total_s),
    tempsConsommeS: Number(data.temps_consomme_s),
    tranches: data.tranches,
    longueurMm: data.longueur_mm === null ? null : Number(data.longueur_mm),
    tauxUtilisation: data.taux_utilisation === null ? null : Number(data.taux_utilisation),
    reproductible: data.reproductible,
    erreur: data.erreur_message ? { code: data.erreur_code, message: data.erreur_message } : null,
    annulationDemandee: !!data.annulation_demandee_le,
    pieces: data.pieces,
    entree: data.entree,
    meilleur: data.meilleur,
    validation: data.validation,
    demandeParAgent: data.demande_par_agent,
    createdAt: data.created_at,
    finLe: data.fin_le,
  };
}

/**
 * Lance le traitement sans attendre la minute suivante : appel de la route
 * de traitement après la réponse. Sans effet bloquant : la route répond tout
 * de suite et calcule de son côté ; la tâche planifiée rattrape tout échec.
 */
async function declencherTraitement() {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const base = await getBaseUrl();
  after(async () => {
    try {
      await fetch(`${base}/api/imbrication/traiter`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10_000) });
    } catch (e) {
      console.error("[imbrication] déclenchement immédiat impossible (la tâche planifiée prendra le relais)", e);
    }
  });
}

/** Stockage réel (clé serveur : écrit les résultats que la RLS interdit au personnel). */
export function storeSupabase(): StoreCalculs {
  const admin = createAdminClient();
  return {
    async prendre() {
      const { data, error } = await admin.rpc("prendre_calcul_imbrication", { p_silence_max_s: dureeTrancheS() + 180 });
      if (error) throw new Error(`Réservation d'un calcul impossible : ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        id: row.id as string,
        entree: row.entree as EntreeImbricationNormalisee,
        temps_total_s: Number(row.temps_total_s),
        temps_consomme_s: Number(row.temps_consomme_s),
        tranches: Number(row.tranches),
        meilleur: (row.meilleur as SortieImbrication | null) ?? null,
        validation: (row.validation as ResultatValidation | null) ?? null,
        annulation_demandee_le: (row.annulation_demandee_le as string | null) ?? null,
      } satisfies CalculReserve;
    },
    async signeDeVie(id) {
      const { data } = await admin
        .from("imbrication_calculs")
        .update({ vivant_le: new Date().toISOString() })
        .eq("id", id)
        .select("annulation_demandee_le")
        .maybeSingle();
      return !!data?.annulation_demandee_le;
    },
    async enregistrer(id, maj: MiseAJourCalcul) {
      const { error } = await admin
        .from("imbrication_calculs")
        .update({ ...maj, vivant_le: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(`Enregistrement du résultat impossible : ${error.message}`);
    },
  };
}

/** Point d'entrée de la route de traitement. */
export function traiterCalculsImbrication(tempsDisponibleS: number) {
  return traiterCalculs(storeSupabase(), (entree) => lancerImbrication(entree), {
    dureeTrancheS: dureeTrancheS(),
    tempsDisponibleS,
  });
}
