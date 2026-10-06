import { requireRole } from "@/lib/auth/current-user";
import { isQuoteValidator, listQuoteValidatorNames } from "@/lib/signatures";
import { createClient } from "@/lib/supabase/server";
import { getQuoteLinesWithColorConfig } from "@/lib/quotes";
import { notFound } from "next/navigation";
import { QuoteDetail } from "@/components/quotes/quote-detail";
import { getSizeOptionsByModel } from "@/lib/quote-dispatch";
import { simulateQuote } from "@/lib/quote-pricing";
import { QuoteSimulationCard } from "@/components/quotes/quote-simulation-card";
import type { AttachableMediaFile } from "@/lib/types/domain";
import { getSampleQuoteLineOptions } from "@/lib/samples";

export default async function CommercialQuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { authId, profile } = await requireRole(["commercial", "administrateur"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quotes")
    .select("*,companies(name),requests(reference)")
    .eq("id", id)
    .single();
  if (!quote) notFound();

  // Médiathèque proposable pour visuel/maquette (migration 0043) : plus
  // toute la médiathèque du client, seulement ce qui est déjà affilié à
  // cette demande — voir src/app/(app)/atelier/production/[id]/page.tsx
  // pour le même principe côté ODF.
  const [lines, { data: requestMedia }, { data: samples }, sampleQuoteLineOptions, canValidate, validators, validator] =
    await Promise.all([
    getQuoteLinesWithColorConfig(id),
    supabase.from("request_media_files").select("media_files(id,file_name,category)").eq("request_id", quote.request_id),
    // Échantillons de la demande, liables à une ligne du devis (migration 0051).
    supabase
      .from("sample_requests")
      .select("id,sample_number,status,quote_line_id")
      .eq("request_id", quote.request_id)
      .order("created_at", { ascending: false }),
    // Lignes des devis de la demande, pour créer un échantillon depuis une
    // ligne d'article (0094) — un échantillon porte sur un article, jamais
    // sur le devis entier.
    getSampleQuoteLineOptions([quote.request_id]),
    // Validation interne (migration 0063).
    isQuoteValidator(authId),
    quote.status === "en_validation_interne" ? listQuoteValidatorNames() : Promise.resolve([] as string[]),
    quote.validated_by
      ? supabase.from("app_users").select("full_name").eq("id", quote.validated_by).maybeSingle().then((r) => r.data?.full_name ?? null)
      : Promise.resolve(null),
  ]);
  const sizeOptionsByModel = await getSizeOptionsByModel(lines.map((l) => l.product_model_id));
  // Simulation du prix de revient (lot E) : Direction et administrateur
  // uniquement (base_role administrateur ; la RLS des tables de coût l'impose
  // aussi), tant que le devis n'est pas envoyé au client.
  const enPreparation = quote.status === "brouillon" || quote.status === "en_validation_interne";
  const simulation = profile.role === "administrateur" && enPreparation ? await simulateQuote(id) : null;
  const availableMediaFiles = (requestMedia ?? [])
    .map((m) => m.media_files as unknown as AttachableMediaFile | null)
    .filter((f): f is AttachableMediaFile => !!f);

  return (
    <div className="space-y-6">
      {simulation && <QuoteSimulationCard quoteId={id} simulation={simulation} editable />}
      <QuoteDetail
      quote={quote}
      lines={lines}
      companyName={(quote.companies as unknown as { name: string } | null)?.name}
      canAccept
      editable
      availableMediaFiles={availableMediaFiles}
      samples={samples ?? []}
      sampleCreation={{
        requestReference: (quote.requests as unknown as { reference: string } | null)?.reference ?? "",
        quoteLineOptions: sampleQuoteLineOptions,
      }}
      canValidate={canValidate}
      validators={validators}
      validatedBy={validator}
      sizeOptionsByModel={sizeOptionsByModel}
      />
    </div>
  );
}
