import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Canal, MotifAbsence, StatutAbsence, TypeJour } from "./constantes";

/** Lecture des référentiels du module Prospection (migration 0122). */

export interface Commercial {
  id: string;
  appUserId: string;
  nom: string;
  email: string;
  sageRepresentantNo: number | null;
  whatsapp: string | null;
  telegramChatId: string | null;
  emailPro: string | null;
  zone: string | null;
  soumisObligation: boolean;
  actif: boolean;
  notes: string | null;
}

export interface ReglagesProspection {
  typesJour: TypeJour[];
  heureRappel: string;
  heureAlerte: string;
}

export interface CanalProspection {
  canal: Canal;
  libelle: string;
  receptionActive: boolean;
  envoiRappels: boolean;
  envoiAlertes: boolean;
  identifiant: string | null;
}

export interface Absence {
  id: string;
  appUserId: string;
  nom: string;
  debut: string;
  fin: string;
  motif: MotifAbsence;
  commentaire: string | null;
  statut: StatutAbsence;
  motifRefus: string | null;
}

type Row = Record<string, unknown>;
const nomCompte = (r: Row) => (r.app_users as { full_name?: string } | null)?.full_name ?? "—";

export async function chargerCommerciaux(): Promise<Commercial[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("commerciaux").select("*, app_users(full_name, email)");
  return ((data ?? []) as Row[])
    .map((r) => ({
      id: r.id as string,
      appUserId: r.app_user_id as string,
      nom: nomCompte(r),
      email: (r.app_users as { email?: string } | null)?.email ?? "",
      sageRepresentantNo: (r.sage_representant_no as number | null) ?? null,
      whatsapp: (r.whatsapp as string | null) ?? null,
      telegramChatId: (r.telegram_chat_id as string | null) ?? null,
      emailPro: (r.email_pro as string | null) ?? null,
      zone: (r.zone as string | null) ?? null,
      soumisObligation: r.soumis_obligation as boolean,
      actif: r.actif as boolean,
      notes: (r.notes as string | null) ?? null,
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

export async function chargerReglages(): Promise<ReglagesProspection> {
  const supabase = await createClient();
  const { data } = await supabase.from("prospection_reglages").select("types_jour, heure_rappel, heure_alerte").eq("id", true).maybeSingle();
  return {
    typesJour: ((data?.types_jour as TypeJour[] | undefined) ?? ["visites", "visites", "visites", "visites", "visites", "reunion", "repos"]),
    heureRappel: String(data?.heure_rappel ?? "18:00").slice(0, 5),
    heureAlerte: String(data?.heure_alerte ?? "07:30").slice(0, 5),
  };
}

const ORDRE_CANAUX: Canal[] = ["whatsapp", "telegram", "email", "application"];

export async function chargerCanaux(): Promise<CanalProspection[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("prospection_canaux").select("*");
  return ((data ?? []) as Row[])
    .map((r) => ({
      canal: r.canal as Canal,
      libelle: r.libelle as string,
      receptionActive: r.reception_active as boolean,
      envoiRappels: r.envoi_rappels as boolean,
      envoiAlertes: r.envoi_alertes as boolean,
      identifiant: (r.identifiant as string | null) ?? null,
    }))
    .sort((a, b) => ORDRE_CANAUX.indexOf(a.canal) - ORDRE_CANAUX.indexOf(b.canal));
}

/** Absences visibles par l'utilisateur (les siennes, ou toutes pour la direction — RLS), récentes d'abord. */
export async function chargerAbsences(depuis: string): Promise<Absence[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("absences_commerciaux")
    .select("id, app_user_id, debut, fin, motif, commentaire, statut, motif_refus, app_users!absences_commerciaux_app_user_id_fkey(full_name)")
    .gte("fin", depuis)
    .order("debut", { ascending: false })
    .limit(200);
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id as string,
    appUserId: r.app_user_id as string,
    nom: nomCompte(r),
    debut: r.debut as string,
    fin: r.fin as string,
    motif: r.motif as MotifAbsence,
    commentaire: (r.commentaire as string | null) ?? null,
    statut: r.statut as StatutAbsence,
    motifRefus: (r.motif_refus as string | null) ?? null,
  }));
}
