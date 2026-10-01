import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { getLogoPngBytes } from "@/lib/pdf/logo";
import { getCompanySettings } from "@/lib/company-settings";
import { buildQuotePdf, type QuotePdfLine } from "@/lib/pdf/quote-pdf";

/**
 * Devis / facture proforma en PDF. Généré à la demande (jamais mis en
 * cache) : reflète toujours l'état courant du devis et la fiche société.
 * Même client Supabase (cookies de session) que le reste de l'application :
 * la RLS s'applique, un client ne peut obtenir que les PDF de ses propres
 * devis — le contrôle de propriété n'est pas refait ici.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: quote } = await supabase
    .from("quotes")
    .select("*,companies(name,address,postal_code,city,country,phone,email,ncc,rccm),requests(contacts(first_name,last_name))")
    .eq("id", id)
    .maybeSingle();
  if (!quote) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

  const [{ data: rawLines }, { data: zoneTemplates }, issuer] = await Promise.all([
    supabase
      .from("quote_lines")
      .select("id,description,quantity,unit_price,remise_pct,product_model_id,couleur_unique:couleur_unique_id(name),zone_colors:quote_line_zone_colors(zone_key,colors:color_id(name))")
      .eq("quote_id", id)
      .order("id"),
    supabase.from("product_zone_templates").select("product_model_id,zone_key,zone_label"),
    getCompanySettings(),
  ]);

  const zoneLabel = (modelId: string | null, key: string) =>
    (zoneTemplates ?? []).find((z) => z.product_model_id === modelId && z.zone_key === key)?.zone_label ?? key;

  const lines: QuotePdfLine[] = (rawLines ?? []).map((l) => {
    const unique = l.couleur_unique as unknown as { name: string } | null;
    const zones = (l.zone_colors ?? []) as unknown as { zone_key: string; colors: { name: string } | null }[];
    const colors = unique
      ? `Couleur : ${unique.name}`
      : zones
          .filter((z) => z.colors)
          .map((z) => `${zoneLabel(l.product_model_id, z.zone_key)} : ${z.colors!.name}`)
          .join("  |  ");
    return { description: l.description, quantity: l.quantity, unit_price: Number(l.unit_price), remise_pct: Number(l.remise_pct ?? 0), colors };
  });

  const company = quote.companies as unknown as {
    name: string;
    address: string | null;
    postal_code: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    ncc: string | null;
    rccm: string | null;
  } | null;
  const contact = (quote.requests as unknown as { contacts: { first_name: string; last_name: string } | null } | null)?.contacts;

  const baseUrl = await getBaseUrl();
  const quoteUrl = `${baseUrl}/devis/${quote.reference}`;
  const qrPng = await QRCode.toBuffer(quoteUrl, { type: "png", width: 300, margin: 1 });

  const pdfBytes = await buildQuotePdf({
    quote,
    client: {
      name: company?.name ?? "Client",
      address: company?.address ?? null,
      postal_code: company?.postal_code ?? null,
      city: company?.city ?? null,
      country: company?.country ?? null,
      phone: company?.phone ?? null,
      email: company?.email ?? null,
      ncc: company?.ncc ?? null,
      rccm: company?.rccm ?? null,
      contactName: contact ? `${contact.first_name} ${contact.last_name}` : null,
    },
    issuer,
    lines,
    logoPng: await getLogoPngBytes(),
    qrPng,
    quoteUrl,
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="proforma-${quote.reference}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
