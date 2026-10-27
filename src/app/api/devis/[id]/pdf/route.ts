import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { genererPdfDevis } from "@/lib/pdf/quote-pdf-document";

/**
 * Devis / facture proforma en PDF. Généré à la demande (jamais mis en
 * cache) : reflète toujours l'état courant du devis et la fiche société.
 * Même client Supabase (cookies de session) que le reste de l'application :
 * la RLS s'applique, un client ne peut obtenir que les PDF de ses propres
 * devis — le contrôle de propriété n'est pas refait ici.
 * Le contenu est construit par `genererPdfDevis`, partagé avec la route du site.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const pdf = await genererPdfDevis(supabase, id);
  if (!pdf) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="proforma-${pdf.reference}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
