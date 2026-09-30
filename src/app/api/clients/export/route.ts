import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { applyClientFilters, parseClientFilters, type ClientQuery } from "@/lib/clients/filters";

/**
 * Export CSV de la liste des clients — applique EXACTEMENT les filtres de la
 * page (mêmes paramètres d'URL, même code : `lib/clients/filters.ts`), sans
 * pagination. Format pensé pour Excel en français : séparateur `;`, UTF-8 avec
 * BOM, fins de ligne CRLF.
 *
 * Même garde que la page : commercial, administrateur, responsable de
 * production. La lecture passe par la RLS de l'utilisateur, jamais par un accès
 * privilégié. Jamais mis en cache : l'export reflète la dernière synchro Sage.
 */

const ALLOWED_ROLES = ["commercial", "administrateur", "responsable_production"];
const API_PAGE = 1000; // plafond de lignes par requête côté API Supabase
const MAX_ROWS = 20_000;

const COLUMNS: { header: string; value: (r: Row) => unknown }[] = [
  { header: "Code Sage", value: (r) => r.sage_code },
  { header: "Raison sociale", value: (r) => r.name },
  { header: "Statut", value: (r) => ({ actif: "Actif", sommeil: "En sommeil", archive: "Disparu de Sage" })[r.statut] ?? r.statut },
  { header: "Origine", value: (r) => (r.origin === "sage" ? "Sage" : "Seritex") },
  { header: "Type", value: (r) => (r.is_prospect ? "Prospect" : "Client") },
  { header: "Famille", value: (r) => r.famille },
  { header: "Zone / commune", value: (r) => r.zone },
  { header: "Typologie", value: (r) => r.typologie },
  { header: "Catégorie", value: (r) => r.categorie },
  { header: "Commercial", value: (r) => r.representant_name },
  { header: "Adresse", value: (r) => r.address },
  { header: "Code postal", value: (r) => r.postal_code },
  { header: "Ville", value: (r) => r.city },
  { header: "Pays", value: (r) => r.country },
  { header: "Téléphone", value: (r) => r.phone },
  { header: "E-mail", value: (r) => r.email },
  { header: "Site web", value: (r) => r.website },
  { header: "SIRET", value: (r) => r.siret },
  { header: "N° TVA", value: (r) => r.vat_number },
  { header: "Contacts", value: (r) => r.contact_count },
  { header: "Contacts actifs", value: (r) => r.active_contact_count },
  { header: "Comptes portail", value: (r) => r.portal_account_count },
  { header: "Demandes en cours", value: (r) => r.open_request_count },
  { header: "ODF en cours", value: (r) => r.open_odf_count },
  { header: "Dernière activité", value: (r) => dateOnly(r.last_activity_at) },
  { header: "Créé dans Sage le", value: (r) => dateOnly(r.sage_created_at) },
];

interface Row {
  sage_code: string | null;
  name: string;
  statut: string;
  origin: string;
  is_prospect: boolean;
  famille: string | null;
  zone: string | null;
  typologie: string | null;
  categorie: string | null;
  representant_name: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  siret: string | null;
  vat_number: string | null;
  contact_count: number;
  active_contact_count: number;
  portal_account_count: number;
  open_request_count: number;
  open_odf_count: number;
  last_activity_at: string | null;
  sage_created_at: string | null;
}

function dateOnly(v: string | null): string {
  return v ? v.slice(0, 10) : "";
}

/**
 * Échappement CSV + neutralisation des « formules » : une cellule qui commence
 * par = + - @ serait interprétée par Excel comme une formule. Les noms de clients
 * viennent d'une base externe, on préfixe donc d'une apostrophe.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value).replace(/\r?\n/g, " ");
  if (/^[=+\-@\t]/.test(s) && typeof value === "string" && !/^[+-]?\d[\d\s.,]*$/.test(s)) s = `'${s}`;
  return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(current.profile.role)) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const filters = parseClientFilters(Object.fromEntries(req.nextUrl.searchParams));
  const supabase = await createClient();

  const rows: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += API_PAGE) {
    const query = supabase.from("companies_list").select("*") as unknown as ClientQuery;
    const { data, error } = await applyClientFilters(query, filters).range(from, from + API_PAGE - 1);
    if (error) return NextResponse.json({ error: "Export impossible : " + error.message }, { status: 500 });
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < API_PAGE) break;
  }

  const lines = [COLUMNS.map((c) => cell(c.header)).join(";"), ...rows.map((r) => COLUMNS.map((c) => cell(c.value(r))).join(";"))];
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clients-seritex-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
