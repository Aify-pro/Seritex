import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { genererPdfDevis } from "@/lib/pdf/quote-pdf-document";

/**
 * Proforma en PDF pour un compte CLIENT, depuis l'espace client du site (www.seritex.ci).
 * Le site transmet le jeton du client (Authorization: Bearer) ; la plateforme génère le même
 * PDF que l'application, avec la session du client : la RLS ne lui laisse voir que les devis
 * de sa société, et jamais un devis non envoyé.
 *
 * Garde-fous : jeton valide ET compte de rôle « client » (le personnel passe par l'application).
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refus = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jeton = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!jeton) return refus(401, "Non authentifié");
  if (!UUID.test(id)) return refus(404, "Devis introuvable");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return refus(503, "Service indisponible");

  const db = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jeton}` } },
  });
  const { data: auth } = await db.auth.getUser(jeton);
  if (!auth.user) return refus(401, "Session invalide");

  const { data: profil } = await db.from("app_users").select("role").eq("id", auth.user.id).maybeSingle();
  if (profil?.role !== "client") return refus(403, "Réservé aux comptes client");

  const pdf = await genererPdfDevis(db, id);
  if (!pdf) return refus(404, "Devis introuvable");

  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="proforma-${pdf.reference}.pdf"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
