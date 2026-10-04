import { STOCK_MOVEMENT_TYPE_LABELS, movementSign } from "@/lib/stock/movements";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

/**
 * Format PROVISOIRE (Q-SF-5 : aucun fichier d'import Sage fourni au
 * 2026-10-03), complété par LIV-3 d'une colonne Dépôt (D5), d'un sens et du
 * numéro de BL. Colonnes PLACEHOLDER d'origine (migration 0038) : aucune spec Sage réelle fournie à
 * ce stade — Date/Type/Référence ODF/Référence article Sage/Quantité/Unité
 * couvrent ce que stock_movements sait déjà dire. À remapper le jour où le
 * format d'import Sage réel est connu ; seule cette fonction changera, pas
 * le modèle de données (fiche/mouvements) ni le reste de l'écran.
 */
function csvField(value: string): string {
  if (/[;"\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;

  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (current.profile.role === "client") return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const supabase = await createClient();
  const { data: fiche } = await supabase.from("stock_export_fiches").select("id,numero").eq("numero", numero).maybeSingle();
  if (!fiche) return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });

  const { data: movements } = await supabase
    .from("stock_movements")
    .select("type,article_ref,quantite_ou_poids,unite,created_at,depot,taille,production_orders(reference),shipments(reference)")
    .eq("exported_in_fiche_id", fiche.id)
    .order("created_at", { ascending: true });

  const rows = (movements ?? []).map((m) => {
    const odfReference = (m.production_orders as unknown as { reference: string } | null)?.reference ?? "";
    const blReference = (m.shipments as unknown as { reference: string | null } | null)?.reference ?? "";
    return [
      csvField(m.created_at.slice(0, 10)),
      csvField(STOCK_MOVEMENT_TYPE_LABELS[m.type] ?? m.type),
      movementSign(m.type) > 0 ? "E" : "S",
      csvField(odfReference),
      csvField(blReference),
      csvField(m.article_ref ?? ""),
      csvField(m.taille ? String(m.taille).split("/").pop() ?? "" : ""),
      csvField(String(m.quantite_ou_poids)),
      csvField(m.unite),
      csvField(m.depot ?? ""),
    ].join(";");
  });

  const csv = ["Date;Type;Sens;Référence ODF;N° BL;Référence article Sage;Taille;Quantité;Unité;Dépôt", ...rows].join("\r\n");

  // BOM UTF-8 : Excel (utilisé pour relire/vérifier avant import Sage)
  // n'interprète correctement les accents qu'avec ce marqueur en tête.
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fiche.numero}.csv"`,
    },
  });
}
