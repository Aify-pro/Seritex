import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLogoPngBytes } from "@/lib/pdf/logo";
import { getCompanySettings } from "@/lib/company-settings";
import { getDocumentSeal } from "@/lib/signatures";
import { buildFuelVoucherPdf } from "@/lib/pdf/fuel-voucher-pdf";

/**
 * Bon de carburant en PDF (deux exemplaires à découper). Accès contrôlé par la
 * RLS de fuel_vouchers (droit « Bons de carburant : voir »). Un bon n'existe
 * à l'impression qu'une fois validé (numéro attribué).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: b } = await supabase
    .from("fuel_vouchers")
    .select("numero,statut,valide_le,valide_par,montant_demande,km_demande,motif,beneficiaire_id,vehicles(libelle,immatriculation,energie),fuel_stations(nom),validateur:app_users!fuel_vouchers_valide_par_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!b) return NextResponse.json({ error: "Bon introuvable" }, { status: 404 });
  if (!b.numero || !b.valide_le) return NextResponse.json({ error: "Bon pas encore validé : rien à imprimer" }, { status: 409 });

  let beneficiaire: string | null = null;
  if (b.beneficiaire_id) {
    const { data: annuaire } = await supabase.rpc("vehicules_annuaire");
    beneficiaire = ((annuaire ?? []) as { id: string; nom: string }[]).find((e) => e.id === b.beneficiaire_id)?.nom ?? null;
  }
  const vehicle = b.vehicles as unknown as { libelle: string; immatriculation: string | null; energie: string | null };

  const pdf = await buildFuelVoucherPdf({
    numero: b.numero,
    valideLe: b.valide_le,
    statut: b.statut,
    vehicule: vehicle,
    beneficiaire,
    motif: b.motif,
    station: (b.fuel_stations as unknown as { nom: string } | null)?.nom ?? null,
    montant: Number(b.montant_demande),
    kmDemande: b.km_demande,
    validePar: (b.validateur as unknown as { full_name: string } | null)?.full_name ?? null,
    issuer: await getCompanySettings(),
    seal: await getDocumentSeal(b.valide_par),
    logoPng: await getLogoPngBytes(),
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${b.numero}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
