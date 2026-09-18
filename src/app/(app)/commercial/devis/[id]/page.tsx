import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getQuoteLinesWithColorConfig } from "@/lib/quotes";
import { notFound } from "next/navigation";
import { QuoteDetail } from "@/components/quotes/quote-detail";
import type { AttachableMediaFile } from "@/lib/types/domain";

export default async function CommercialQuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["commercial", "administrateur"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: quote } = await supabase.from("quotes").select("*,companies(name)").eq("id", id).single();
  if (!quote) notFound();

  // Médiathèque proposable pour visuel/maquette (migration 0043) : plus
  // toute la médiathèque du client, seulement ce qui est déjà affilié à
  // cette demande — voir src/app/(app)/atelier/production/[id]/page.tsx
  // pour le même principe côté ODF.
  const [lines, { data: requestMedia }, { data: samples }] = await Promise.all([
    getQuoteLinesWithColorConfig(id),
    supabase.from("request_media_files").select("media_files(id,file_name,category)").eq("request_id", quote.request_id),
    // Échantillons de la demande, liables à une ligne du devis (migration 0051).
    supabase
      .from("sample_requests")
      .select("id,sample_number,status,quote_line_id")
      .eq("request_id", quote.request_id)
      .order("created_at", { ascending: false }),
  ]);
  const availableMediaFiles = (requestMedia ?? [])
    .map((m) => m.media_files as unknown as AttachableMediaFile | null)
    .filter((f): f is AttachableMediaFile => !!f);

  return (
    <QuoteDetail
      quote={quote}
      lines={lines}
      companyName={(quote.companies as unknown as { name: string } | null)?.name}
      canAccept
      editable
      availableMediaFiles={availableMediaFiles}
      samples={samples ?? []}
    />
  );
}
