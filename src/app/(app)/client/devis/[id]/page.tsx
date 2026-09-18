import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getQuoteLinesWithColorConfig } from "@/lib/quotes";
import { notFound } from "next/navigation";
import { QuoteDetail } from "@/components/quotes/quote-detail";

export default async function ClientQuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireRole(["client"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", id)
    .eq("company_id", profile.company_id!)
    .single();

  if (!quote) notFound();

  // Échantillons liés aux lignes (migration 0051), en consultation : le
  // client voit sur quel échantillon repose chaque article avant d'accepter.
  const [lines, { data: samples }] = await Promise.all([
    getQuoteLinesWithColorConfig(id),
    supabase.from("sample_requests").select("id,sample_number,status,quote_line_id").eq("request_id", quote.request_id),
  ]);

  return <QuoteDetail quote={quote} lines={lines} canAccept samples={samples ?? []} />;
}
