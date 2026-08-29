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

export type ProductionOrderStatus = "a_lancer" | "en_cours" | "terminee" | "bloquee" | "annulee";

export type WorkOrderStatus = "en_attente" | "planifie" | "en_cours" | "pause" | "bloque" | "termine" | "annule";

export type WorkOrderEventType = "demarre" | "pause" | "reprise" | "termine" | "bloque" | "debloque";

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

export interface AppUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  company_id: string | null;
  section_id: string | null;
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

export interface Contact {
  id: string;
  company_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  role_title: string | null;
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
  created_at: string;
  companies?: Pick<Company, "id" | "name">;
}

export interface WorkOrder {
  id: string;
  reference: string;
  production_order_id: string;
  section_id: string;
  routing_step_id: string;
  predecessor_work_order_id: string | null;
  status: WorkOrderStatus;
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
  company_id: string;
  contact_id: string | null;
  request_id: string | null;
  created_by_user_id: string | null;
  need_description: string;
  quantity_requested: number;
  status: SampleRequestStatus;
  due_date: string | null;
  created_at: string;
  companies?: Pick<Company, "id" | "name">;
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
  a_lancer: "À lancer",
  en_cours: "En cours",
  terminee: "Terminée",
  bloquee: "Bloquée",
  annulee: "Annulée",
};

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  en_attente: "En attente",
  planifie: "Planifié",
  en_cours: "En cours",
  pause: "En pause",
  bloque: "Bloqué",
  termine: "Terminé",
  annule: "Annulé",
};

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
