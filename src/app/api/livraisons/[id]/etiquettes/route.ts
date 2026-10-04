import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { loadShipment } from "@/lib/delivery/shipment-data";
import { buildPackageLabelsPdf } from "@/lib/pdf/package-labels-pdf";

/**
 * Étiquettes des colis d'une expédition (SF-5), une page A6 par colis, avec
 * le QR du lot. Même contrôle d'accès que le BL (RLS de `shipments`).
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
  if (s.packages.length === 0) return NextResponse.json({ error: "Aucun colis déclaré" }, { status: 409 });

  const baseUrl = await getBaseUrl();
  const labels = await Promise.all(
    s.packages.map(async (p) => ({
      numero: p.numero,
      total: s.packages.length,
      contenu: p.contenu,
      poidsKg: p.poidsKg,
      lotCode: p.lotCode,
      qrPng: await QRCode.toBuffer(p.lotCode ? `${baseUrl}/lots/${p.lotCode}` : `${baseUrl}/livraisons/${s.id}`, { type: "png", width: 400, margin: 1 }),
    }))
  );
  const pdf = await buildPackageLabelsPdf({
    blReference: s.reference,
    client: s.clientNom,
    lieu: s.mode === "retrait" ? "Enlèvement par le client" : [s.lieu.libelle, s.lieu.quartier].filter(Boolean).join(" · ") || null,
    labels,
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${s.reference}-etiquettes.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
