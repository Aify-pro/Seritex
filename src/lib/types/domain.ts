// Types de domaine Seritex — reflètent le schéma Postgres
// (supabase/migrations/0001_schema.sql). À terme, ces types pourront être
// générés automatiquement depuis le projet Supabase avec
// `supabase gen types typescript`.

export type UserRole =
  | "client"
  | "commercial"
  | "infographiste"
  | "responsable_production"
  | "chef_section"
  | "administrateur";

export type RequestStatus =
  | "nouvelle"
  | "infos_manquantes"
  | "en_analyse"
  | "devis_en_preparation"
  | "devis_envoye"
  | "relance"
  | "refusee"
  | "acceptee"
  | "cloturee";

export type QuoteStatus = "brouillon" | "en_validation_interne" | "envoye" | "accepte" | "refuse" | "expire";

// Cycle de vie ODF v2 (lot 1 — refonte module Production, 09/2026) :
// remplace a_lancer|en_cours|terminee|bloquee|annulee. `bloquee` disparaît en
// tant que statut — un blocage devient une anomalie transverse calculée (lot
// 5), pas un état du cycle de vie. Voir claude_logique-ordre-fabrication-
// consolidee.md section 2.
export type ProductionOrderStatus =
  | "brouillon"
  | "en_attente_validation"
  | "refuse"
  | "en_production"
  | "demande_cloture"
  | "terminee"
  | "annulee";

// WorkOrderStatus supprimé (lot 1) : un sous-ODF ne porte plus de statut
// propre, seulement quantity_planned/quantity_done (section 5 du document de
// logique consolidé). L'avancement se lit sur ces deux quantités, un simple
// indicateur visuel calculé (cumul atteint) remplace l'ancien statut.

export type WorkOrderEventType =
  | "demarre"
  | "pause"
  | "reprise"
  | "termine"
  | "bloque"
  | "debloque"
  | "quantite_ajoutee";

export type SampleRequestStatus =
  | "demande"
  | "en_fabrication"
  | "envoye"
  | "recu_client"
  | "valide"
  | "a_ajuster"
  | "refuse"
  | "sans_suite";

export type SampleDecision = "valide" | "a_ajuster" | "refuse";

export type SamplePriority = "basse" | "normale" | "haute" | "urgente";

export type StorageBackendType = "supabase_storage" | "google_drive" | "nas" | "local_server";

export type MediaSyncStatus = "en_attente" | "synchronise" | "erreur";

export type MediaEventType = "ajout" | "mise_a_jour" | "suppression";

export type MediaFileCategory = "visuel" | "image_de_marque" | "fiche_technique" | "nuancier" | "autre";

export interface AppUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  role_id: string;
  company_id: string | null;
  section_id: string | null;
  contact_id: string | null;
  active: boolean;
  created_at: string;
}

export interface Company {
  id: string;
  name: string;
  siret: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
}

export type ContactStatus = "actif" | "inactif";
export type ContactPreferredChannel = "email" | "telephone" | "whatsapp";

export interface Contact {
  id: string;
  company_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  role_title: string | null;
  department: string | null;
  preferred_channel: ContactPreferredChannel;
  status: ContactStatus;
  is_primary_contact: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  companies?: Pick<Company, "id" | "name">;
}

export interface Section {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
  active: boolean;
}

export interface RoutingTemplate {
  id: string;
  name: string;
  active: boolean;
}

export interface RoutingStep {
  id: string;
  routing_template_id: string;
  section_id: string;
  sequence_order: number;
  depends_on_step_id: string | null;
  standard_duration_minutes: number | null;
  instructions: string | null;
}

export interface ProductModel {
  id: string;
  name: string;
  category: string | null;
  base_price: number | null;
  routing_template_id: string | null;
  active: boolean;
  // Présent depuis la migration 0005, éditable depuis l'application seulement
  // à partir du lot 10 (Paramètres > Modèles de produits) — nécessaire pour
  // que les mouvements de stock entree_semi_fini/entree_fini portent une
  // référence Sage exploitable.
  sage_reference: string | null;
}

// Lot 9 — configurateur couleur par zone (section 8 du document de logique).

/** Palette de couleurs de référence, indépendante du tissu (section 9). */
export interface Color {
  id: string;
  name: string;
  code: string;
  active: boolean;
  created_at: string;
}

/** Gabarit de zones fixe par modèle de produit (ex. 7 zones pour le t-shirt). */
export interface ProductZoneTemplate {
  id: string;
  product_model_id: string;
  zone_key: string;
  zone_label: string;
  display_order: number;
  created_at: string;
}

// Lot 12 — nomenclature (fournitures constantes).

/** Composant constant hors tissu (boutons, fil, colle, col...) et sa quantité par pièce, pour un modèle de produit donné. */
export interface NomenclatureLine {
  id: string;
  product_model_id: string;
  designation: string;
  quantite_par_piece: number;
  unite: string;
  created_at: string;
}

/** Couleur choisie pour une zone donnée, sur un ODF donné. */
export interface ProductionOrderZoneColor {
  id: string;
  production_order_id: string;
  zone_key: string;
  color_id: string;
  created_by: string | null;
  created_at: string;
  colors?: Pick<Color, "id" | "name" | "code">;
}

/** Visuel/maquette joint à l'ODF (mécanisme MEDIA_FILE, pas un nouveau système de stockage). */
export interface ProductionOrderMediaFile {
  id: string;
  production_order_id: string;
  media_file_id: string;
  added_by: string | null;
  added_at: string;
  media_files?: MediaFile;
}

export interface RequestRecord {
  id: string;
  reference: string;
  company_id: string;
  contact_id: string | null;
  assigned_commercial_id: string | null;
  status: RequestStatus;
  source: string | null;
  description: string | null;
  needs_graphics: boolean;
  created_at: string;
  updated_at: string;
  companies?: Pick<Company, "id" | "name">;
}

export interface Quote {
  id: string;
  reference: string;
  request_id: string;
  company_id: string;
  status: QuoteStatus;
  total_amount: number;
  valid_until: string | null;
  created_at: string;
  companies?: Pick<Company, "id" | "name">;
}

export interface QuoteLine {
  id: string;
  quote_id: string;
  product_model_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface ProductionOrder {
  id: string;
  reference: string;
  quote_id: string | null;
  company_id: string;
  status: ProductionOrderStatus;
  total_quantity: number;
  planned_start_date: string | null;
  planned_end_date: string | null;
  actual_end_date: string | null;
  archived_at: string | null;
  archived_by: string | null;
  // Cycle de vie v2 (lot 1) — même principe que archived_at/archived_by :
  // le nom de la personne qui valide le lancement et celui qui valide la
  // clôture définitive doivent apparaître à l'écran et sur le PDF.
  launched_at: string | null;
  launched_by: string | null;
  cloture_demandee_at: string | null;
  cloture_demandee_par: string | null;
  closed_at: string | null;
  closed_by: string | null;
  cloture_note: string | null;
  replaced_by_production_order_id: string | null;
  // Lot 2 : surplus tracé par taille au moment de la validation (section 11
  // du document de logique), ex. { "L": 5, "XL": 2 } — null si aucun surplus.
  mention_surplus_traces: Record<string, number> | null;
  // Lot 9 : modèle de produit (détermine le gabarit de zones du
  // configurateur couleur) et commentaire libre de disponibilité des
  // couleurs — jamais validé par le logiciel, section 9 du document de
  // logique.
  product_model_id: string | null;
  note_disponibilite_couleurs: string | null;
  created_at: string;
  companies?: Pick<Company, "id" | "name">;
  product_models?: Pick<ProductModel, "id" | "name"> | null;
}

// Un ODF est rempli en plusieurs fois avant soumission : les sections
// retenues (remplace la dépendance à routing_templates/routing_steps pour
// la génération des sous-ODF) et les quantités par taille.
export interface ProductionOrderSection {
  id: string;
  production_order_id: string;
  section_id: string;
  ordre: number;
  created_at: string;
  sections?: Pick<Section, "id" | "name">;
}

export interface ProductionOrderSize {
  id: string;
  production_order_id: string;
  taille: string;
  quantite_demandee: number;
}

export interface WorkOrder {
  id: string;
  reference: string;
  production_order_id: string;
  section_id: string;
  routing_step_id: string | null;
  predecessor_work_order_id: string | null;
  quantity_planned: number;
  quantity_done: number;
  quantity_rejected: number;
  assigned_section_chief_id: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  blocking_reason: string | null;
  updated_at: string;
  sections?: Pick<Section, "id" | "name">;
  production_orders?: Pick<ProductionOrder, "id" | "reference" | "company_id"> & {
    companies?: Pick<Company, "name">;
  };
}

export interface WorkOrderEvent {
  id: string;
  work_order_id: string;
  event_type: WorkOrderEventType;
  user_id: string | null;
  quantity: number | null;
  comment: string | null;
  occurred_at: string;
}

export interface SampleRequestRecord {
  id: string;
  reference: string;
  sample_number: string;
  company_id: string;
  contact_id: string | null;
  request_id: string | null;
  production_order_id: string | null;
  created_by_user_id: string | null;
  need_description: string;
  quantity_requested: number;
  priority: SamplePriority;
  request_date: string;
  status: SampleRequestStatus;
  due_date: string | null;
  extra_info: string | null;
  created_at: string;
  companies?: Pick<Company, "id" | "name">;
  production_orders?: Pick<ProductionOrder, "id" | "reference" | "status"> | null;
}

export interface StorageTarget {
  id: string;
  type: StorageBackendType;
  name: string;
  active: boolean;
  is_default: boolean;
  config: Record<string, unknown>;
  created_at: string;
}

export interface MediaFile {
  id: string;
  company_id: string;
  file_name: string;
  category: MediaFileCategory;
  mime_type: string | null;
  size_bytes: number | null;
  current_version_id: string | null;
  created_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
  companies?: Pick<Company, "id" | "name">;
  media_file_versions?: MediaFileVersion[];
}

export interface MediaFileVersion {
  id: string;
  media_file_id: string;
  version_number: number;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  checksum: string | null;
  uploaded_by: string | null;
  created_at: string;
  media_file_copies?: MediaFileCopy[];
}

export interface MediaFileCopy {
  id: string;
  media_file_version_id: string;
  storage_target_id: string;
  remote_path: string | null;
  sync_status: MediaSyncStatus;
  error_message: string | null;
  synced_at: string | null;
  storage_targets?: Pick<StorageTarget, "id" | "name" | "type">;
}

export interface MediaFileEvent {
  id: string;
  media_file_id: string;
  media_file_version_id: string | null;
  event_type: MediaEventType;
  reason: string;
  user_id: string | null;
  occurred_at: string;
  app_users?: Pick<AppUser, "id" | "full_name">;
}

export interface SampleRequestMediaFile {
  id: string;
  sample_request_id: string;
  media_file_id: string;
  added_by: string | null;
  added_at: string;
  media_files?: MediaFile;
}

export interface StockItem {
  sage_reference: string;
  designation: string;
  category: "tissu" | "fil" | "encre" | "consommable";
  unit: string;
  quantity_available: number;
  warehouse: string | null;
  last_sync_at: string;
}

// Lot 10 — mouvements de stock & fiches d'import Sage (sections 16/19/20).

export type StockMovementType =
  | "sortie_mp"
  | "entree_semi_fini"
  | "sortie_semi_fini"
  | "entree_fini"
  | "retour_mp";

/**
 * Toujours dérivé (record_pesee / create_article_lot), jamais saisi
 * directement — voir migration 0020. `article_ref` est polymorphe et peut
 * être absent (stock_item_view pas encore synchronisé, ou modèle de produit
 * sans référence Sage saisie).
 */
export interface StockMovement {
  id: string;
  production_order_id: string;
  type: StockMovementType;
  article_ref: string | null;
  quantite_ou_poids: number;
  unite: "kg" | "piece";
  exported_in_fiche_id: string | null;
  created_by: string | null;
  created_at: string;
}

/** Fiche numérotée regroupant les mouvements pas encore exportés d'un ODF, à un instant donné. */
export interface StockExportFiche {
  id: string;
  numero: string;
  production_order_id: string;
  generated_at: string;
  generated_by: string | null;
}

export interface ClientProductionStatus {
  id: string;
  reference: string;
  company_id: string;
  status: ProductionOrderStatus;
  total_quantity: number;
  planned_start_date: string | null;
  planned_end_date: string | null;
  section_en_cours: string | null;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  client: "Client",
  commercial: "Commercial",
  infographiste: "Infographiste",
  responsable_production: "Responsable production",
  chef_section: "Chef de section",
  administrateur: "Administrateur",
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  nouvelle: "Nouvelle",
  infos_manquantes: "Infos manquantes",
  en_analyse: "En analyse",
  devis_en_preparation: "Devis en préparation",
  devis_envoye: "Devis envoyé",
  relance: "Relance",
  refusee: "Refusée",
  acceptee: "Acceptée",
  cloturee: "Clôturée",
};

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  brouillon: "Brouillon",
  en_validation_interne: "En validation interne",
  envoye: "Envoyé",
  accepte: "Accepté",
  refuse: "Refusé",
  expire: "Expiré",
};

export const PRODUCTION_ORDER_STATUS_LABELS: Record<ProductionOrderStatus, string> = {
  brouillon: "Brouillon",
  en_attente_validation: "En attente de validation",
  refuse: "Refusé",
  en_production: "En production",
  demande_cloture: "Demande de clôture",
  terminee: "Terminée",
  annulee: "Annulée",
};

export const SAMPLE_PRIORITY_LABELS: Record<SamplePriority, string> = {
  basse: "Basse",
  normale: "Normale",
  haute: "Haute",
  urgente: "Urgente",
};

export const MEDIA_CATEGORY_LABELS: Record<MediaFileCategory, string> = {
  visuel: "Visuel",
  image_de_marque: "Image de marque",
  fiche_technique: "Fiche technique",
  nuancier: "Nuancier",
  autre: "Autre",
};

export const STORAGE_BACKEND_LABELS: Record<StorageBackendType, string> = {
  supabase_storage: "Supabase Storage",
  google_drive: "Google Drive",
  nas: "NAS",
  local_server: "Serveur local",
};

export const MEDIA_SYNC_STATUS_LABELS: Record<MediaSyncStatus, string> = {
  en_attente: "En attente",
  synchronise: "Synchronisé",
  erreur: "Erreur",
};

// ----------------------------------------------------------------------------
// RBAC dynamique (v4) — supabase/migrations/0005_rbac_crm_parametres_sage.sql
// ----------------------------------------------------------------------------

export type PermissionAction = "view" | "create" | "modify" | "archive" | "delete" | "validate" | "unlock";

export const PERMISSION_ACTION_LABELS: Record<PermissionAction, string> = {
  view: "Voir",
  create: "Créer",
  modify: "Modifier",
  archive: "Archiver",
  delete: "Supprimer",
  validate: "Valider",
  unlock: "Déverrouiller",
};

export interface ModuleRecord {
  id: string;
  key: string;
  label: string;
  description: string | null;
  display_order: number;
}

export interface RoleRecord {
  id: string;
  key: string;
  label: string;
  description: string | null;
  base_role: UserRole;
  is_system: boolean;
  active: boolean;
  created_at: string;
}

export interface RolePermissionRecord {
  id: string;
  role_id: string;
  module_id: string;
  can_view: boolean;
  can_create: boolean;
  can_modify: boolean;
  can_archive: boolean;
  can_delete: boolean;
  can_validate: boolean;
  can_unlock: boolean;
  updated_at: string;
  modules?: Pick<ModuleRecord, "id" | "key" | "label">;
}

// ----------------------------------------------------------------------------
// Paramètres — Intégration Sage (v4)
// ----------------------------------------------------------------------------

export type SageSyncMode = "simulation" | "agent_local";

export interface SageConnectionConfig {
  id: string;
  label: string;
  sync_mode: SageSyncMode;
  host: string | null;
  port: number | null;
  database_name: string | null;
  schema_stock: string | null;
  schema_clients: string | null;
  schema_articles: string | null;
  sync_frequency_minutes: number;
  active: boolean;
  last_test_status: string | null;
  last_test_at: string | null;
  updated_at: string;
}

export interface SageCustomer {
  sage_code: string;
  name: string;
  siret: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  linked_company_id: string | null;
  last_sync_at: string;
  companies?: Pick<Company, "id" | "name">;
}

export interface SageArticle {
  sage_reference: string;
  designation: string;
  category: string | null;
  unit: string | null;
  sale_price: number | null;
  active: boolean;
  linked_product_model_id: string | null;
  last_sync_at: string;
  product_models?: Pick<ProductModel, "id" | "name">;
}

export const SAMPLE_STATUS_LABELS: Record<SampleRequestStatus, string> = {
  demande: "Demandée",
  en_fabrication: "En fabrication",
  envoye: "Envoyé au client",
  recu_client: "Reçu par le client",
  valide: "Validé",
  a_ajuster: "À ajuster",
  refuse: "Refusé",
  sans_suite: "Sans suite",
};
