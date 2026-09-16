import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getQuoteLinesWithColorConfig } from "@/lib/quotes";
import { notFound } from "next/navigation";
import { QuoteDetail } from "@/components/quotes/quote-detail";

export default async function CommercialQuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["commercial", "administrateur"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: quote } = await supabase.from("quotes").select("*,companies(name)").eq("id", id).single();
  if (!quote) notFound();

  const [lines, { data: availableMediaFiles }] = await Promise.all([
    getQuoteLinesWithColorConfig(id),
    supabase.from("media_files").select("id,file_name,category").eq("company_id", quote.company_id),
  ]);

  return (
    <QuoteDetail
      quote={quote}
      lines={lines}
      companyName={(quote.companies as unknown as { name: string } | null)?.name}
      canAccept
      editable
      availableMediaFiles={availableMediaFiles ?? []}
    />
  );
}
