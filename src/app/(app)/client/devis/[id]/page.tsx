import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
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

  const { data: lines } = await supabase.from("quote_lines").select("*").eq("quote_id", id);

  return <QuoteDetail quote={quote} lines={lines ?? []} canAccept />;
}
