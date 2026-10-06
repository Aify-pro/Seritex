import { createClient } from "@/lib/supabase/server";
import { getMediaFilePreviewUrls } from "@/lib/media/preview";
import type { AttachableMediaFile, DownloadableMediaFile, MaquetteFile, QuoteStatus } from "@/lib/types/domain";

/** Demande proposable au rattachement d'une fiche échantillon (migration 0051). */
export interface SampleRequestOption {
  id: string;
  reference: string;
  companyId: string;
  companyName: string;
  description: string | null;
}

/**
 * Ligne d'article d'un devis de la demande, proposable au lien échantillon.
 * `orderLine` renseigné = la ligne est déjà passée en ODF : le lien est
 * alors verrouillé et suit cet article (trigger enforce_sample_links).
 */
export interface SampleQuoteLineOption {
  id: string;
  requestId: string;
  quoteReference: string;
  quoteStatus: QuoteStatus;
  description: string;
  orderLine: { id: string; orderReference: string } | null;
}

/** Toutes les demandes, pour le sélecteur de création du module Échantillonnage. */
export async function getSampleRequestOptions(): Promise<SampleRequestOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("requests")
    .select("id,reference,company_id,description,companies(name)")
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id,
    reference: r.reference,
    companyId: r.company_id,
    companyName: (r.companies as unknown as { name: string } | null)?.name ?? "",
    description: r.description,
  }));
}

/**
 * Lignes de devis des demandes données, avec l'article d'ODF qui en est
 * issu le cas échéant — deux requêtes simples plutôt qu'un embed
 * quote_lines → production_order_lines, que la double clé étrangère de
 * sample_requests (quote_line_id + production_order_line_id) pourrait
 * rendre ambigu côté PostgREST.
 */
export async function getSampleQuoteLineOptions(requestIds: string[]): Promise<SampleQuoteLineOption[]> {
  if (requestIds.length === 0) return [];
  const supabase = await createClient();
  const { data: lines } = await supabase
    .from("quote_lines")
    .select("id,description,quotes!inner(reference,status,request_id,created_at)")
    .in("quotes.request_id", requestIds);

  const lineIds = (lines ?? []).map((l) => l.id);
  const { data: orderLines } =
    lineIds.length > 0
      ? await supabase.from("production_order_lines").select("id,quote_line_id,production_orders(reference)").in("quote_line_id", lineIds)
      : { data: [] };

  const orderLineByQuoteLine = new Map<string, { id: string; orderReference: string }>();
  for (const ol of orderLines ?? []) {
    const po = ol.production_orders as unknown as { reference: string } | null;
    if (ol.quote_line_id) orderLineByQuoteLine.set(ol.quote_line_id, { id: ol.id, orderReference: po?.reference ?? "ODF" });
  }

  return (lines ?? [])
    .map((l) => {
      const q = l.quotes as unknown as { reference: string; status: QuoteStatus; request_id: string; created_at: string };
      return {
        option: {
          id: l.id,
          requestId: q.request_id,
          quoteReference: q.reference,
          quoteStatus: q.status,
          description: l.description,
          orderLine: orderLineByQuoteLine.get(l.id) ?? null,
        },
        quoteCreatedAt: q.created_at,
      };
    })
    .sort((a, b) => b.quoteCreatedAt.localeCompare(a.quoteCreatedAt))
    .map((x) => x.option);
}

/**
 * Rattachements d'une fiche pour `SampleDetailContent`, calculés à partir
 * des options déjà chargées pour toute la page (pas de requête par fiche).
 */
export function buildSampleLinks(
  sample: { company_id: string | null; request_id: string | null },
  requests: SampleRequestOption[],
  quoteLines: SampleQuoteLineOption[]
) {
  const request = sample.request_id ? requests.find((r) => r.id === sample.request_id) : undefined;
  return {
    request: request ? { id: request.id, reference: request.reference } : null,
    quoteLines: sample.request_id ? quoteLines.filter((l) => l.requestId === sample.request_id) : [],
    attachableRequests: sample.request_id ? [] : requests.filter((r) => r.companyId === sample.company_id),
  };
}

/**
 * Maquette et visuels de l'ARTICLE d'une fiche échantillon (0094).
 *
 * Les fichiers ne sont pas stockés sur la fiche : ils vivent sur la ligne
 * d'article, là où l'ODF les lit déjà (quote_line_media_files pour la ligne
 * de devis — 0041 ; production_order_media_files par article — 0037). La
 * fiche échantillon n'est qu'un point de dépôt supplémentaire, pour que le
 * fichier entre dans le circuit dès l'échantillon, quelle que soit la
 * technique d'impression.
 *
 * `target` dit où écrit la fiche : sa ligne de devis si elle en a une,
 * sinon l'article d'ODF auquel elle est directement rattachée. Les fichiers
 * déposés de l'autre côté (sur l'ODF alors que la fiche écrit au devis)
 * sont renvoyés dans `odfOnly`, en lecture seule.
 */
export interface SampleArticleMedia {
  target: "quote_line" | "order_line" | null;
  maquette: MaquetteFile | null;
  visuels: DownloadableMediaFile[];
  /** Fichiers déposés sur l'article d'ODF quand la fiche écrit au devis — informatifs. */
  odfOnly: DownloadableMediaFile[];
  /** L'article passe par un atelier qui exige un visuel — avertissement, jamais bloquant. */
  requiresVisuel: boolean;
  /** ODF lancé : dépôt et retrait figés (0042) — l'écran l'explique au lieu de laisser la RLS refuser. */
  locked: boolean;
  /** Fichiers de la demande proposables au dépôt (migration 0043). */
  available: AttachableMediaFile[];
}

export interface SampleArticleRef {
  id: string;
  request_id: string | null;
  quote_line_id: string | null;
  production_order_line_id: string | null;
}

const EMPTY_ARTICLE_MEDIA: SampleArticleMedia = {
  target: null,
  maquette: null,
  visuels: [],
  odfOnly: [],
  requiresVisuel: false,
  locked: false,
  available: [],
};

export function emptySampleArticleMedia(): SampleArticleMedia {
  return EMPTY_ARTICLE_MEDIA;
}

/**
 * Qui peut déposer sur l'article depuis la fiche : les droits suivent la
 * RLS de la table ciblée — commercial/administrateur sur une ligne de devis
 * (0041) ; sur un article d'ODF, commercial, responsable production et
 * administrateur depuis 0095 (le commercial n'a pas accès à l'écran ODF :
 * la fiche échantillon est son point d'entrée). Rien n'est proposé à un
 * client. Le gel d'un ODF lancé est porté par `SampleArticleMedia.locked`.
 */
export function canEditSampleArticleMedia(role: string, target: SampleArticleMedia["target"]) {
  if (target === "quote_line") return role === "commercial" || role === "administrateur";
  if (target === "order_line") {
    return role === "commercial" || role === "responsable_production" || role === "administrateur";
  }
  return false;
}

/**
 * Chargement groupé pour toutes les fiches d'un écran (les listes affichent
 * la fiche complète de chaque ligne) : un nombre fixe de requêtes, pas une
 * par fiche.
 */
export async function getSampleArticleMediaMap(samples: SampleArticleRef[]): Promise<Map<string, SampleArticleMedia>> {
  const result = new Map<string, SampleArticleMedia>();
  if (samples.length === 0) return result;

  const supabase = await createClient();
  const quoteLineIds = [...new Set(samples.map((s) => s.quote_line_id).filter((v): v is string => !!v))];
  const orderLineIds = [...new Set(samples.map((s) => s.production_order_line_id).filter((v): v is string => !!v))];
  const requestIds = [...new Set(samples.map((s) => s.request_id).filter((v): v is string => !!v))];

  const [{ data: quoteLineMedia }, { data: orderLineMedia }, { data: requestMedia }, { data: odfVisuelSections }, { data: quoteLineModels }] =
    await Promise.all([
      quoteLineIds.length > 0
        ? supabase
            .from("quote_line_media_files")
            .select("quote_line_id,media_files(id,file_name,category)")
            .in("quote_line_id", quoteLineIds)
        : Promise.resolve({ data: [] }),
      orderLineIds.length > 0
        ? supabase
            .from("production_order_media_files")
            .select("production_order_line_id,media_files(id,file_name,category)")
            .in("production_order_line_id", orderLineIds)
        : Promise.resolve({ data: [] }),
      requestIds.length > 0
        ? supabase.from("request_media_files").select("request_id,media_files(id,file_name,category)").in("request_id", requestIds)
        : Promise.resolve({ data: [] }),
      // Articles d'ODF dont une section retenue exige un visuel (0036/0037).
      orderLineIds.length > 0
        ? supabase
            .from("production_order_line_sections")
            .select("production_order_line_id,sections!inner(atelier_categories!inner(requiert_visuel))")
            .in("production_order_line_id", orderLineIds)
            .eq("sections.atelier_categories.requiert_visuel", true)
        : Promise.resolve({ data: [] }),
      // Avant l'ODF : parcours type par défaut du modèle de la ligne (ART-H, 0077).
      quoteLineIds.length > 0
        ? supabase.from("quote_lines").select("id,product_model_id").in("id", quoteLineIds)
        : Promise.resolve({ data: [] }),
    ]);

  const modelIds = [...new Set((quoteLineModels ?? []).map((l) => l.product_model_id).filter((v): v is string => !!v))];
  const { data: routeSteps } =
    modelIds.length > 0
      ? await supabase
          .from("model_route_steps")
          .select(
            "atelier_category,model_routes!inner(product_model_id,par_defaut),sections(atelier_categories(requiert_visuel,cle))"
          )
          .in("model_routes.product_model_id", modelIds)
          .eq("model_routes.par_defaut", true)
      : { data: [] };

  // Statut de l'ODF des articles visés : dépôt figé passé la validation (0042).
  const { data: orderLineStatuses } =
    orderLineIds.length > 0
      ? await supabase.from("production_order_lines").select("id,production_orders(status)").in("id", orderLineIds)
      : { data: [] };
  const lockedOrderLines = new Set(
    ((orderLineStatuses ?? []) as unknown as { id: string; production_orders: { status: string } | null }[])
      .filter((l) => !["brouillon", "en_attente_validation", "refuse"].includes(l.production_orders?.status ?? ""))
      .map((l) => l.id)
  );

  const { data: categoriesVisuel } = await supabase.from("atelier_categories").select("cle").eq("requiert_visuel", true);
  const visuelCategoryKeys = new Set((categoriesVisuel ?? []).map((c) => c.cle));

  const modelsRequiringVisuel = new Set<string>();
  for (const step of routeSteps ?? []) {
    const route = step.model_routes as unknown as { product_model_id: string } | null;
    const section = step.sections as unknown as { atelier_categories: { requiert_visuel: boolean } | null } | null;
    const byCategory = step.atelier_category ? visuelCategoryKeys.has(step.atelier_category) : false;
    if (route && (byCategory || section?.atelier_categories?.requiert_visuel)) modelsRequiringVisuel.add(route.product_model_id);
  }
  const quoteLinesRequiringVisuel = new Set(
    (quoteLineModels ?? [])
      .filter((l) => l.product_model_id && modelsRequiringVisuel.has(l.product_model_id))
      .map((l) => l.id)
  );
  const orderLinesRequiringVisuel = new Set(
    ((odfVisuelSections ?? []) as { production_order_line_id: string }[]).map((r) => r.production_order_line_id)
  );

  // Lignes « clé de regroupement + media_files joint », quelle que soit la
  // table d'origine : Supabase ne type pas ces jointures, un seul cast suffit.
  type MediaRow = Record<string, unknown> & { media_files: unknown };
  const group = (rows: unknown, keyColumn: string) => {
    const map = new Map<string, AttachableMediaFile[]>();
    for (const row of (rows ?? []) as MediaRow[]) {
      const file = row.media_files as AttachableMediaFile | null;
      const key = row[keyColumn] as string | null;
      if (!file || !key) continue;
      const list = map.get(key) ?? [];
      list.push(file);
      map.set(key, list);
    }
    return map;
  };

  const quoteLineFiles = group(quoteLineMedia, "quote_line_id");
  const orderLineFiles = group(orderLineMedia, "production_order_line_id");
  const requestFiles = group(requestMedia, "request_id");

  // Une seule résolution d'URL signée pour tout l'écran.
  const allIds = new Set<string>();
  for (const files of [...quoteLineFiles.values(), ...orderLineFiles.values()]) for (const f of files) allIds.add(f.id);
  const urls = await getMediaFilePreviewUrls([...allIds]);

  for (const sample of samples) {
    const target = sample.quote_line_id ? "quote_line" : sample.production_order_line_id ? "order_line" : null;
    if (target === null) {
      result.set(sample.id, { ...EMPTY_ARTICLE_MEDIA, available: requestFiles.get(sample.request_id ?? "") ?? [] });
      continue;
    }
    const owned =
      (target === "quote_line" ? quoteLineFiles.get(sample.quote_line_id!) : orderLineFiles.get(sample.production_order_line_id!)) ?? [];
    const other =
      target === "quote_line" && sample.production_order_line_id
        ? (orderLineFiles.get(sample.production_order_line_id) ?? []).filter((f) => !owned.some((o) => o.id === f.id))
        : [];
    const maquette = owned.find((f) => f.category === "maquette") ?? null;

    result.set(sample.id, {
      target,
      maquette: maquette ? { ...maquette, previewUrl: urls.get(maquette.id) ?? null } : null,
      visuels: owned.filter((f) => f.category === "visuel").map((f) => ({ ...f, downloadUrl: urls.get(f.id) ?? null })),
      odfOnly: other.map((f) => ({ ...f, downloadUrl: urls.get(f.id) ?? null })),
      requiresVisuel:
        target === "quote_line"
          ? quoteLinesRequiringVisuel.has(sample.quote_line_id!)
          : orderLinesRequiringVisuel.has(sample.production_order_line_id!),
      locked: target === "order_line" && lockedOrderLines.has(sample.production_order_line_id!),
      available: requestFiles.get(sample.request_id ?? "") ?? [],
    });
  }

  return result;
}

/** Colonnes de validation portées par la fiche (migrations 0099/0100). */
export interface SampleValidationRow {
  id: string;
  validation_client_le: string | null;
  validation_client_par: string | null;
  validation_client_commentaire: string | null;
  validation_client_pour_le_client: boolean | null;
  validation_direction_le: string | null;
  validation_direction_par: string | null;
  validation_direction_commentaire: string | null;
}

/** Les colonnes à demander à Supabase pour alimenter `buildSampleValidations`. */
export const SAMPLE_VALIDATION_COLUMNS =
  "validation_client_le,validation_client_par,validation_client_commentaire,validation_client_pour_le_client,validation_direction_le,validation_direction_par,validation_direction_commentaire";

/**
 * Noms des personnes qui ont validé, résolus en une requête pour tout
 * l'écran (les listes affichent la fiche complète de chaque ligne).
 */
export async function getSampleValidatorNames(samples: SampleValidationRow[]): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      samples.flatMap((s) => [s.validation_client_par, s.validation_direction_par]).filter((v): v is string => !!v)
    ),
  ];
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("app_users").select("id,full_name").in("id", ids);
  return new Map((data ?? []).map((u) => [u.id as string, (u.full_name as string) ?? ""]));
}

/** Assemble les deux côtés pour `SampleValidationPanel`, sans requête. */
export function buildSampleValidations(sample: SampleValidationRow, names: Map<string, string>) {
  return {
    client: {
      at: sample.validation_client_le,
      byName: sample.validation_client_par ? (names.get(sample.validation_client_par) ?? null) : null,
      comment: sample.validation_client_commentaire,
      onBehalf: sample.validation_client_pour_le_client ?? false,
    },
    direction: {
      at: sample.validation_direction_le,
      byName: sample.validation_direction_par ? (names.get(sample.validation_direction_par) ?? null) : null,
      comment: sample.validation_direction_commentaire,
    },
  };
}
