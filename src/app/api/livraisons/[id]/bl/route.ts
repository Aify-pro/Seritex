import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { getLogoPngBytes } from "@/lib/pdf/logo";
import { getCompanySettings } from "@/lib/company-settings";
import { getDocumentSeal } from "@/lib/signatures";
import { buildDeliveryNotePdf } from "@/lib/pdf/delivery-note-pdf";
import { groupLinesByArticle, loadShipment } from "@/lib/delivery/shipment-data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Bon de livraison en PDF (deux exemplaires). Accès contrôlé par la RLS de
 * `shipments` (personnel, livreur affecté, client). Généré à la demande.
 * Un BL n'existe qu'une fois l'expédition préparée (numéro attribué).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const s = await loadShipment(id);
  if (!s) return NextResponse.json({ error: "Expédition introuvable" }, { status: 404 });
  if (!s.reference) return NextResponse.json({ error: "Expédition pas encore préparée : aucun BL" }, { status: 409 });

  const { data: company } = await createAdminClient().from("companies").select("name,phone,email").eq("id", s.companyId).maybeSingle();
  const baseUrl = await getBaseUrl();
  const qrPng = await QRCode.toBuffer(`${baseUrl}/livraisons/${s.id}`, { type: "png", width: 300, margin: 1 });

  const pdf = await buildDeliveryNotePdf({
    reference: s.reference,
    statut: s.statut,
    mode: s.mode,
    editeLe: new Date().toISOString(),
    datePromise: s.datePromise,
    datePlanifiee: s.datePlanifiee,
    odfReferences: [...new Set(s.lines.map((l) => l.odfReference).filter(Boolean))],
    client: { name: company?.name ?? s.clientNom, phone: company?.phone ?? null, email: company?.email ?? null },
    lieu: s.lieu,
    reglement: { mention: s.reglement.mention, montant: s.reglement.montant, texte: s.reglement.texte },
    colis: s.packages.map((p) => ({ numero: p.numero, poidsKg: p.poidsKg, contenu: p.contenu, codeQr: p.codeQr })),
    lines: groupLinesByArticle(s.lines).map((g) => ({ designation: g.designation, tailles: g.tailles })),
    livreur: s.livreurNom,
    issuer: await getCompanySettings(),
    seal: await getDocumentSeal(s.preparedBy),
    logoPng: await getLogoPngBytes(),
    qrPng,
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${s.reference}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
