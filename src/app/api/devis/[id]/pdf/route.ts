import { NextRequest, NextResponse } from "next/server";
import { printableZoneLabel } from "@/lib/printable-zones";
import { getSizeOptionsByModel } from "@/lib/quote-dispatch";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBaseUrl } from "@/lib/url";
import { getLogoPngBytes } from "@/lib/pdf/logo";
import { getCompanySettings } from "@/lib/company-settings";
import { getDocumentSeal } from "@/lib/signatures";
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
    .select("*,companies(name,address,postal_code,city,country,phone,email,ncc,rccm),requests(assigned_commercial_id,contacts(first_name,last_name))")
    .eq("id", id)
    .maybeSingle();
  if (!quote) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

  const [{ data: rawLines }, { data: zoneTemplates }, issuer] = await Promise.all([
    supabase
      .from("quote_lines")
      .select("id,description,quantity,unit_price,remise_pct,product_model_id,couleur_unique:couleur_unique_id(name),zone_colors:quote_line_zone_colors(zone_key,colors:color_id(name)),printable_zones:quote_line_printable_zones(nb_couleurs,product_printable_zones(zone_label,display_order)),sizes:quote_line_sizes(taille,quantite)")
      .eq("quote_id", id)
      .order("id"),
    supabase.from("product_zone_templates").select("product_model_id,zone_key,zone_label"),
    getCompanySettings(),
  ]);

  // Ordre métier des tailles (migration 0066) pour la répartition de chaque ligne.
  const sizeOptionsByModel = await getSizeOptionsByModel((rawLines ?? []).map((l) => l.product_model_id as string | null));

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
    // Impressions (migration 0065) : partie de la configuration que le client valide.
    const prints = ((l.printable_zones ?? []) as unknown as { nb_couleurs: number; product_printable_zones: { zone_label: string; display_order: number } | null }[])
      .filter((z) => z.product_printable_zones)
      .sort((a, b) => a.product_printable_zones!.display_order - b.product_printable_zones!.display_order)
      .map((z) => printableZoneLabel(z.product_printable_zones!.zone_label, z.nb_couleurs));
    // Répartition par taille (migration 0066) : validée par le client avec le devis.
    const qtyBySize = new Map(((l.sizes ?? []) as unknown as { taille: string; quantite: number }[]).map((z) => [z.taille, z.quantite]));
    const ordered = (sizeOptionsByModel[l.product_model_id as string] ?? []).filter((o) => qtyBySize.has(o.cle));
    const sizesText = [
      ...ordered.map((o) => `${o.libelle} ${qtyBySize.get(o.cle)}`),
      ...[...qtyBySize.entries()].filter(([cle]) => !ordered.some((o) => o.cle === cle)).map(([cle, q]) => `${cle.split("/").pop()} ${q}`),
    ].join(", ");
    const config = [colors, prints.length > 0 ? `Impressions : ${prints.join(", ")}` : "", sizesText ? `Tailles : ${sizesText}` : ""]
      .filter(Boolean)
      .join("  |  ");
    return { description: l.description, quantity: l.quantity, unit_price: Number(l.unit_price), remise_pct: Number(l.remise_pct ?? 0), colors: config };
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
  const request = quote.requests as unknown as {
    assigned_commercial_id: string | null;
    contacts: { first_name: string; last_name: string } | null;
  } | null;
  const contact = request?.contacts;

  // Commercial attitré et validation : ni l'historique de statuts ni les profils
  // du staff ne sont lisibles par un client (RLS). L'accès au devis vient d'être
  // contrôlé ci-dessus avec la session de l'utilisateur ; on ne lit ici, avec le
  // client d'administration, que des noms, un e-mail pro et une date.
  const admin = createAdminClient();
  const { data: accepted } = await admin
    .from("status_history")
    .select("changed_by,changed_at")
    .eq("entity_type", "quote")
    .eq("entity_id", id)
    .eq("to_status", "accepte")
    .order("changed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const repId = request?.assigned_commercial_id ?? quote.created_by ?? null;
  const userIds = [accepted?.changed_by, repId, quote.validated_by].filter((v): v is string => !!v);
  const { data: people } = userIds.length
    ? await admin.from("app_users").select("id,full_name,email,role").in("id", userIds)
    : { data: [] };
  const person = (uid: string | null | undefined) => (people ?? []).find((p) => p.id === uid);
  const rep = person(repId);
  const acceptedBy = person(accepted?.changed_by);
  // Signature + cachet : ceux du VALIDATEUR interne (migration 0063), s'il en a une
  // active. Un devis pas encore validé n'est signé par personne.
  const validator = person(quote.validated_by);
  const seal = await getDocumentSeal(quote.validated_by);

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
    representative: rep ? { name: rep.full_name, email: rep.email } : null,
    acceptance:
      accepted && acceptedBy
        ? { name: acceptedBy.full_name, by: acceptedBy.role === "client" ? "client" : "staff", at: accepted.changed_at }
        : null,
    seal,
    validation: validator && quote.validated_at ? { name: validator.full_name, at: quote.validated_at } : null,
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
