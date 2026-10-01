"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth/current-user";
import type { RequestStatus } from "@/lib/types/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sendNotification } from "@/lib/notifications/send";
import { resolveContactEmailForRequest, resolveRoleEmails } from "@/lib/notifications/recipients";
import { computeQuoteTotals } from "@/lib/quote-totals";
import { formatMoney } from "@/lib/currency";
import { isQuoteValidator } from "@/lib/signatures";

export async function updateRequestStatus(requestId: string, status: RequestStatus) {
  await requireRole(["commercial", "administrateur"]);
  const supabase = await createClient();

  const { data: current } = await supabase.from("requests").select("status").eq("id", requestId).single();

  const { error } = await supabase.from("requests").update({ status }).eq("id", requestId);
  if (error) return { error: error.message };

  await supabase.from("status_history").insert({
    entity_type: "request",
    entity_id: requestId,
    from_status: current?.status ?? null,
    to_status: status,
  });

  revalidatePath(`/commercial/demandes/${requestId}`);
  revalidatePath("/commercial/demandes");
  return {};
}

const quoteLineSchema = z.object({
  // Ligne existante (resoumission d'un devis renvoyé) — absente pour une ligne
  // nouvelle ; ignorée à la création. z.guid : les comptes/données de
  // démonstration n'ont pas des UUID strictement RFC (cf. seal-actions.ts).
  id: z.guid().nullable().optional(),
  description: z.string().min(1, "Description requise"),
  quantity: z.coerce.number().int().positive("Quantité invalide"),
  unit_price: z.coerce.number().nonnegative("Prix invalide"),
  // Remise propre à la ligne (migration 0061), en % du brut de la ligne.
  remise_pct: z.coerce.number().min(0, "Remise invalide").max(100, "La remise d'une ligne ne peut pas dépasser 100 %"),
  product_model_id: z.string().uuid().nullable(),
  // Configuration couleur — la « maquette » que le client valide avec le
  // devis (chantier config-produit-devis). Jamais les deux ensemble :
  // couleur_unique_id pour un modèle « uni », zone_colors sinon.
  couleur_unique_id: z.string().uuid().nullable(),
  zone_colors: z.array(z.object({ zone_key: z.string().min(1), color_id: z.string().uuid() })),
  // Impressions par emplacement (migration 0065) : base du chiffrage, et
  // configuration que le client valide. L'appartenance de l'emplacement au
  // modèle de la ligne est vérifiée en base.
  printable_zones: z
    .array(
      z.object({
        printable_zone_id: z.guid(),
        nb_couleurs: z.coerce.number().int("Nombre de couleurs invalide").min(1, "Au moins 1 couleur par impression").max(12, "12 couleurs au plus par impression"),
      })
    )
    .default([])
    .refine((zones) => new Set(zones.map((z) => z.printable_zone_id)).size === zones.length, "Un emplacement d'impression est choisi deux fois"),
});

const optionalText = z.string().trim().max(2000).transform((v) => v || null);

/**
 * Mentions de la proforma (migration 0061) : TVA, remise, règlement, délais.
 * Le taux de TVA vient du formulaire (pré-rempli depuis Paramètres >
 * Informations société) ; un devis exonéré (tva_rate = 0) doit en donner le
 * motif, mention exigée sur un document sans TVA pour une société assujettie.
 */
const quoteTermsSchema = z
  .object({
    objet: optionalText,
    reference_client: optionalText,
    remise_pct: z.coerce.number().min(0, "Remise invalide").max(100, "La remise ne peut pas dépasser 100 %"),
    tva_rate: z.coerce.number().min(0, "Taux de TVA invalide").max(100, "Taux de TVA invalide"),
    tva_exoneration_motif: optionalText,
    mode_reglement: optionalText,
    // Libellé d'une condition de la liste Paramètres > Informations société.
    conditions_paiement: optionalText,
    acompte_pct: z.coerce.number().min(0, "Acompte invalide").max(100, "L'acompte ne peut pas dépasser 100 %"),
    // Devise du devis et taux figé (F CFA pour 1 unité) — 1 pour le F CFA.
    devise: z.string().regex(/^[A-Z]{3}$/, "Devise invalide"),
    taux_change: z.coerce.number().positive("Taux de change invalide"),
    // Livraison normalisée : délai (valeur + unité + départ) OU date ferme.
    delai_valeur: z.coerce.number().int("Délai invalide").positive("Délai invalide").nullable(),
    delai_unite: z.enum(["jours", "jours_ouvres", "semaines", "mois"]).nullable(),
    delai_depart: z.enum(["commande", "acompte", "validation_echantillon"]).nullable(),
    notes: optionalText,
    valid_until: z.string().date().nullable(),
  })
  .refine((t) => (t.delai_valeur === null) === (t.delai_unite === null), {
    message: "Indiquez la valeur et l'unité du délai de livraison",
    path: ["delai_valeur"],
  })
  .refine((t) => t.tva_rate > 0 || !!t.tva_exoneration_motif, {
    message: "Indiquez le motif d'exonération de TVA (ou un taux de TVA)",
    path: ["tva_exoneration_motif"],
  });

const createQuoteSchema = z.object({
  lines: z.array(quoteLineSchema).min(1, "Au moins un article est requis"),
  // Date de livraison ferme (migration 0048) — optionnelle ; exclusive avec le
  // délai normalisé des mentions (0061) : l'un OU l'autre.
  date_livraison_prevue: z.string().date().nullable(),
  terms: quoteTermsSchema,
});

export type QuoteLineInput = z.infer<typeof quoteLineSchema>;
export type QuoteTermsInput = z.input<typeof quoteTermsSchema>;

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;
type QuoteDraft = z.infer<typeof createQuoteSchema>;

/**
 * Contrôles et champs d'en-tête communs à la création et à la resoumission
 * d'un devis : livraison exclusive, devise active (F CFA toujours au taux 1),
 * condition de paiement connue, totaux recalculés côté serveur.
 */
async function prepareQuoteFields(supabase: ServerSupabase, data: QuoteDraft) {
  const t = data.terms;
  if (data.date_livraison_prevue && t.delai_valeur !== null) {
    return { error: "Choisissez soit une date de livraison, soit un délai — pas les deux" };
  }

  // Devise : active et connue ; F CFA toujours au taux 1 (le taux saisi côté
  // client n'est pas digne de confiance pour la devise de base).
  const { data: currency } = await supabase.from("currencies").select("code,is_base,active").eq("code", t.devise).maybeSingle();
  if (!currency || !currency.active) return { error: "Devise indisponible" };
  const tauxChange = currency.is_base ? 1 : t.taux_change;

  if (t.conditions_paiement) {
    const { data: term } = await supabase.from("payment_terms").select("id").eq("label", t.conditions_paiement).eq("active", true).maybeSingle();
    if (!term) return { error: "Condition de paiement inconnue ou désactivée" };
  }

  const totals = computeQuoteTotals(data.lines, t.remise_pct, t.tva_rate, t.acompte_pct, t.devise);
  return {
    fields: {
      total_amount: totals.ttc,
      total_ht: totals.ht,
      total_tva: totals.tva,
      date_livraison_prevue: data.date_livraison_prevue,
      valid_until: t.valid_until,
      objet: t.objet,
      reference_client: t.reference_client,
      remise_pct: t.remise_pct,
      tva_rate: t.tva_rate,
      tva_exoneration_motif: t.tva_rate > 0 ? null : t.tva_exoneration_motif,
      mode_reglement: t.mode_reglement,
      conditions_paiement: t.conditions_paiement,
      acompte_pct: t.acompte_pct,
      devise: t.devise,
      taux_change: tauxChange,
      delai_valeur: t.delai_valeur,
      delai_unite: t.delai_unite,
      delai_depart: t.delai_valeur !== null ? t.delai_depart : null,
      notes: t.notes,
    },
  };
}

function quoteLineFields(line: QuoteLineInput) {
  return {
    product_model_id: line.product_model_id,
    description: line.description,
    quantity: line.quantity,
    unit_price: line.unit_price,
    remise_pct: line.remise_pct,
    couleur_unique_id: line.couleur_unique_id,
  };
}

/** Couleurs par zone d'une ligne — jamais en plus d'une couleur unique (migration 0034). */
async function insertZoneColors(supabase: ServerSupabase, quoteLineId: string, line: QuoteLineInput) {
  if (line.couleur_unique_id || line.zone_colors.length === 0) return {};
  const { error } = await supabase
    .from("quote_line_zone_colors")
    .insert(line.zone_colors.map((z) => ({ quote_line_id: quoteLineId, zone_key: z.zone_key, color_id: z.color_id })));
  return error ? { error: error.message } : {};
}

/** Impressions d'une ligne (migration 0065) — uniquement avec un modèle de produit, dont elles dépendent. */
async function insertPrintableZones(supabase: ServerSupabase, quoteLineId: string, line: QuoteLineInput) {
  if (!line.product_model_id || line.printable_zones.length === 0) return {};
  const { error } = await supabase.from("quote_line_printable_zones").insert(
    line.printable_zones.map((z) => ({ quote_line_id: quoteLineId, printable_zone_id: z.printable_zone_id, nb_couleurs: z.nb_couleurs }))
  );
  return error ? { error: error.message } : {};
}

async function insertQuoteLine(supabase: ServerSupabase, quoteId: string, line: QuoteLineInput) {
  const { data: quoteLine, error } = await supabase
    .from("quote_lines")
    .insert({ quote_id: quoteId, ...quoteLineFields(line) })
    .select("id")
    .single();
  if (error) return { error: error.message };
  const colors = await insertZoneColors(supabase, quoteLine.id as string, line);
  if (colors.error) return colors;
  return insertPrintableZones(supabase, quoteLine.id as string, line);
}

/**
 * Un devis peut porter plusieurs articles (`quote_lines` est une vraie
 * table enfant depuis le schéma initial — seule l'UI n'exposait qu'une
 * ligne). Écriture ligne à ligne, pas de RPC dédiée : même convention que
 * `setProductionOrderZoneColors` (écriture directe, autorisée par la RLS
 * pour commercial/administrateur).
 */
export async function createQuote(
  requestId: string,
  companyId: string,
  lines: QuoteLineInput[],
  dateLivraisonPrevue: string | null,
  terms: QuoteTermsInput
) {
  const { authId } = await requireRole(["commercial", "administrateur"]);
  const parsed = createQuoteSchema.safeParse({ lines, date_livraison_prevue: dateLivraisonPrevue, terms });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Devis invalide" };

  const supabase = await createClient();
  const prepared = await prepareQuoteFields(supabase, parsed.data);
  if ("error" in prepared) return { error: prepared.error };

  // Numéro attribué en dernier, une fois toutes les validations passées, pour
  // ne pas « brûler » de numéros sur un devis refusé (numérotation continue).
  // Numérotation continue DEV-AAAA-NNNN (migration 0061).
  const { data: reference, error: refError } = await supabase.rpc("next_document_number", { p_prefix: "DEV" });
  if (refError || !reference) return { error: refError?.message ?? "Numérotation du devis impossible" };

  const { data: quote, error } = await supabase
    .from("quotes")
    .insert({
      reference,
      request_id: requestId,
      company_id: companyId,
      created_by: authId,
      // Validation interne obligatoire avant envoi au client (migration 0063).
      status: "en_validation_interne",
      ...prepared.fields,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  for (const line of parsed.data.lines) {
    const res = await insertQuoteLine(supabase, quote.id as string, line);
    if (res.error) return { error: res.error };
  }

  await supabase.from("requests").update({ status: "devis_en_preparation" }).eq("id", requestId);
  await supabase.from("status_history").insert({
    entity_type: "quote",
    entity_id: quote.id,
    from_status: null,
    to_status: "en_validation_interne",
    changed_by: authId,
  });

  revalidatePath(`/commercial/demandes/${requestId}`);
  revalidatePath("/commercial/devis");
  return { quoteId: quote.id as string };
}

/**
 * Resoumission d'un devis renvoyé par la Direction (migration 0064) : le
 * commercial corrige le brouillon puis le renvoie en validation interne
 * (brouillon → en_validation_interne, transition admise par le trigger de
 * 0063). Le numéro du devis est conservé. Les lignes conservées gardent leur
 * identité — et donc leur visuel, leur maquette et l'échantillon qui leur est
 * rattaché ; seules les lignes retirées sont supprimées. Le motif du dernier
 * renvoi reste affiché au validateur.
 */
export async function resubmitQuote(
  quoteId: string,
  lines: QuoteLineInput[],
  dateLivraisonPrevue: string | null,
  terms: QuoteTermsInput
) {
  const { authId } = await requireRole(["commercial", "administrateur"]);
  const parsed = createQuoteSchema.safeParse({ lines, date_livraison_prevue: dateLivraisonPrevue, terms });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Devis invalide" };

  const supabase = await createClient();
  const { data: quote } = await supabase.from("quotes").select("id,status,request_id").eq("id", quoteId).maybeSingle();
  if (!quote) return { error: "Devis introuvable" };
  if (quote.status !== "brouillon") return { error: "Seul un devis renvoyé (brouillon) peut être corrigé et resoumis" };

  const prepared = await prepareQuoteFields(supabase, parsed.data);
  if ("error" in prepared) return { error: prepared.error };

  const { data: existing, error: existingError } = await supabase.from("quote_lines").select("id").eq("quote_id", quoteId);
  if (existingError) return { error: existingError.message };
  const existingIds = new Set((existing ?? []).map((l) => l.id as string));
  const keptIds = new Set(parsed.data.lines.map((l) => l.id).filter((id): id is string => !!id));
  for (const id of keptIds) {
    if (!existingIds.has(id)) return { error: "Une ligne ne correspond pas à ce devis — rechargez la page" };
  }

  // Lignes d'abord, statut en dernier : en cas d'échec en cours de route, le
  // devis reste un brouillon invisible du client, jamais un devis à moitié
  // corrigé en attente de validation.
  const removed = [...existingIds].filter((id) => !keptIds.has(id));
  if (removed.length > 0) {
    const { error } = await supabase.from("quote_lines").delete().in("id", removed);
    if (error) return { error: error.message };
  }

  for (const line of parsed.data.lines) {
    if (!line.id) {
      const res = await insertQuoteLine(supabase, quoteId, line);
      if (res.error) return { error: res.error };
      continue;
    }
    const { error: lineError } = await supabase.from("quote_lines").update(quoteLineFields(line)).eq("id", line.id);
    if (lineError) return { error: lineError.message };
    const { error: clearError } = await supabase.from("quote_line_zone_colors").delete().eq("quote_line_id", line.id);
    if (clearError) return { error: clearError.message };
    const res = await insertZoneColors(supabase, line.id, line);
    if (res.error) return { error: res.error };
    const { error: clearPrintError } = await supabase.from("quote_line_printable_zones").delete().eq("quote_line_id", line.id);
    if (clearPrintError) return { error: clearPrintError.message };
    const printRes = await insertPrintableZones(supabase, line.id, line);
    if (printRes.error) return { error: printRes.error };
  }

  const { error } = await supabase
    .from("quotes")
    .update({ ...prepared.fields, status: "en_validation_interne" })
    .eq("id", quoteId);
  if (error) return { error: error.message };

  await supabase.from("status_history").insert({
    entity_type: "quote",
    entity_id: quoteId,
    from_status: "brouillon",
    to_status: "en_validation_interne",
    changed_by: authId,
  });

  revalidatePath(`/commercial/demandes/${quote.request_id}`);
  revalidateQuote(quoteId);
  revalidatePath("/commercial/devis");
  return {};
}

const newRequestSchema = z.object({
  company_id: z.string().uuid(),
  contact_id: z.string().uuid().optional().or(z.literal("")),
  description: z.string().min(1, "Merci de décrire le besoin"),
  needs_graphics: z.coerce.boolean().optional(),
});

export async function createRequest(formData: FormData) {
  const { authId } = await requireRole(["commercial", "administrateur"]);
  const parsed = newRequestSchema.safeParse({
    company_id: formData.get("company_id"),
    // Le menu Contact n'est affiché que si le client a des contacts : sans lui
    // (cas de tous les clients importés de Sage au départ) le champ est absent
    // du formulaire et `get` renvoie null, que le schéma refuserait.
    contact_id: formData.get("contact_id") ?? "",
    description: formData.get("description"),
    needs_graphics: formData.get("needs_graphics") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const reference = "REQ-" + Date.now().toString(36).toUpperCase();

  const { data, error } = await supabase
    .from("requests")
    .insert({
      reference,
      company_id: parsed.data.company_id,
      contact_id: parsed.data.contact_id || null,
      description: parsed.data.description,
      needs_graphics: parsed.data.needs_graphics ?? false,
      assigned_commercial_id: authId,
      source: "manuel",
      created_by: authId,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  if (parsed.data.needs_graphics) {
    const { data: company } = await supabase.from("companies").select("name").eq("id", parsed.data.company_id).maybeSingle();
    await sendNotification("demande_visuel_infographe", {
      to: await resolveRoleEmails("infographiste"),
      variables: { numero_demande: reference, nom_client: company?.name ?? "", description: parsed.data.description },
      relatedEntityType: "request",
      relatedEntityId: data.id as string,
    });
  }

  revalidatePath("/commercial/demandes");
  return { requestId: data.id as string };
}

function revalidateQuote(quoteId: string) {
  revalidatePath(`/commercial/devis/${quoteId}`);
  revalidatePath(`/client/devis/${quoteId}`);
}

/**
 * Fichier (visuel OU maquette, migration 0041) joint à une ligne de devis —
 * pendant de attachMediaFileToLine côté ODF (migration 0040), même logique
 * de remplacement : une maquette en remplace silencieusement une autre, un
 * visuel s'ajoute aux précédents. C'est ici, au devis, que la maquette est
 * censée être déposée en premier (validée par le client en acceptant) —
 * l'ODF ne propose son propre dépôt que si celle-ci est restée vide.
 */
export async function attachMediaFileToQuoteLine(quoteLineId: string, quoteId: string, mediaFileId: string) {
  const { authId } = await requireRole(["administrateur", "commercial"]);
  const supabase = await createClient();

  const { data: media } = await supabase.from("media_files").select("category").eq("id", mediaFileId).maybeSingle();
  if (media?.category === "maquette") {
    const { data: existing } = await supabase
      .from("quote_line_media_files")
      .select("media_file_id, media_files!inner(category)")
      .eq("quote_line_id", quoteLineId)
      .eq("media_files.category", "maquette");
    const existingIds = (existing ?? []).map((e) => e.media_file_id);
    if (existingIds.length > 0) {
      const { error: delError } = await supabase
        .from("quote_line_media_files")
        .delete()
        .eq("quote_line_id", quoteLineId)
        .in("media_file_id", existingIds);
      if (delError) return { error: delError.message };
    }
  }

  const { error } = await supabase.from("quote_line_media_files").insert({
    quote_line_id: quoteLineId,
    media_file_id: mediaFileId,
    added_by: authId,
  });
  if (error) return { error: error.message };
  revalidateQuote(quoteId);
  return {};
}

export async function detachMediaFileFromQuoteLine(quoteLineId: string, quoteId: string, mediaFileId: string) {
  await requireRole(["administrateur", "commercial"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("quote_line_media_files")
    .delete()
    .eq("quote_line_id", quoteLineId)
    .eq("media_file_id", mediaFileId);
  if (error) return { error: error.message };
  revalidateQuote(quoteId);
  return {};
}

/**
 * Validation interne (migration 0063) : réservée aux personnes ayant une
 * signature active. Le contrôle fait foi en base (validate_quote + trigger) ;
 * celui d'ici donne un message clair. C'est ICI, à la validation, que le client
 * est prévenu : plus à la création du devis.
 */
export async function validateQuote(quoteId: string) {
  const { authId } = await requireUser();
  if (!(await isQuoteValidator(authId))) return { error: "Seules la Direction et l'administrateur, avec une signature enregistrée, peuvent valider un devis." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("validate_quote", { p_quote_id: quoteId });
  if (error) return { error: error.message };

  const { data: quote } = await supabase
    .from("quotes")
    .select("id,reference,request_id,company_id,total_amount,devise,companies(name)")
    .eq("id", quoteId)
    .maybeSingle();
  if (quote) {
    await sendNotification("devis_envoye", {
      to: await resolveContactEmailForRequest(quote.request_id, quote.company_id),
      variables: {
        numero_devis: quote.reference,
        nom_client: (quote.companies as unknown as { name: string } | null)?.name ?? "",
        // Montant déjà formaté avec sa devise : le modèle d'e-mail n'y ajoute plus d'unité (migration 0061).
        montant_total: formatMoney(Number(quote.total_amount), quote.devise ?? "XOF"),
        chemin_lien: `/client/devis/${quote.id}`,
      },
      relatedEntityType: "quote",
      relatedEntityId: quote.id as string,
    });
    revalidatePath(`/commercial/demandes/${quote.request_id}`);
  }
  revalidateQuote(quoteId);
  revalidatePath("/commercial/devis");
  revalidatePath("/client/devis");
  return {};
}

/** Renvoie un devis en validation interne au commercial, avec motif obligatoire. */
export async function rejectQuote(quoteId: string, motif: string) {
  const { authId } = await requireUser();
  if (!(await isQuoteValidator(authId))) return { error: "Seules la Direction et l'administrateur, avec une signature enregistrée, peuvent renvoyer un devis." };
  const parsed = z.string().trim().min(3, "Indiquez le motif du renvoi").max(1000).safeParse(motif);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_quote", { p_quote_id: quoteId, p_motif: parsed.data });
  if (error) return { error: error.message };

  revalidateQuote(quoteId);
  revalidatePath("/commercial/devis");
  return {};
}

export async function acceptQuote(quoteId: string) {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_quote", { p_quote_id: quoteId });
  if (error) return { error: error.message };

  const [{ data: quoteInfo }, { data: po }] = await Promise.all([
    supabase.from("quotes").select("reference, companies(name)").eq("id", quoteId).maybeSingle(),
    supabase.from("production_orders").select("reference").eq("id", data as string).maybeSingle(),
  ]);
  await sendNotification("devis_accepte", {
    to: await resolveRoleEmails("responsable_production"),
    variables: {
      numero_devis: quoteInfo?.reference ?? "",
      nom_client: (quoteInfo?.companies as unknown as { name: string } | null)?.name ?? "",
      numero_odf: po?.reference ?? "",
    },
    relatedEntityType: "production_order",
    relatedEntityId: data as string,
  });

  revalidatePath("/commercial/devis");
  revalidatePath("/client/devis");
  revalidatePath("/atelier/production");
  return { productionOrderId: data as string };
}
