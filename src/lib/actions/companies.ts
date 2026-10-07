"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";
import { searchTerms } from "@/lib/clients/filters";

export interface CompanySearchResult {
  id: string;
  name: string;
  sage_code: string | null;
  city: string | null;
}

export interface CompanyContactOption {
  id: string;
  first_name: string;
  last_name: string;
}

/**
 * Recherche d'entreprises pour les sélecteurs (nouvelle demande...). Avec
 * plusieurs milliers de clients importés de Sage, un menu déroulant chargeant
 * toute la table serait tronqué à 1 000 lignes par l'API et inutilisable : on
 * cherche côté base, 20 résultats au plus, sur le même texte de recherche que
 * la liste des clients (nom, code Sage, ville, SIRET, contacts, sans accents).
 * Les clients disparus de Sage (archivés) ne sont pas proposés.
 */
export async function searchCompanies(term: string): Promise<CompanySearchResult[]> {
  await requirePermission("clients", "view");
  const terms = searchTerms(String(term ?? "").slice(0, 100));
  if (terms.length === 0 || terms.join("").length < 2) return [];

  const supabase = await createClient();
  let query = supabase.from("companies_list").select("id,name,sage_code,city").neq("statut", "archive");
  for (const t of terms) query = query.ilike("search_text", `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

  const { data } = await query.order("name").limit(20);
  return (data ?? []) as CompanySearchResult[];
}

/** Contacts d'une entreprise, chargés à la sélection plutôt que tous d'avance. */
export async function listCompanyContacts(companyId: string): Promise<CompanyContactOption[]> {
  await requirePermission("clients", "view");
  const parsed = z.string().uuid().safeParse(companyId);
  if (!parsed.success) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("contacts")
    .select("id,first_name,last_name")
    .eq("company_id", parsed.data)
    .eq("status", "actif")
    .order("is_primary_contact", { ascending: false })
    .order("last_name");
  return (data ?? []) as CompanyContactOption[];
}
