import { cn } from "@/lib/utils";

type Tone = "neutral" | "brand" | "accent" | "success" | "warning" | "danger" | "info";

const toneStyles: Record<Tone, string> = {
  neutral: "bg-surface-muted text-foreground-muted",
  brand: "bg-brand-soft text-brand",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  dot = false,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        toneStyles[tone],
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const REQUEST_TONE: Record<string, Tone> = {
  nouvelle: "info",
  infos_manquantes: "warning",
  en_analyse: "info",
  devis_en_preparation: "info",
  devis_envoye: "brand",
  relance: "warning",
  refusee: "danger",
  acceptee: "success",
  cloturee: "neutral",
};

const QUOTE_TONE: Record<string, Tone> = {
  brouillon: "neutral",
  en_validation_interne: "warning",
  envoye: "brand",
  accepte: "success",
  refuse: "danger",
  expire: "neutral",
};

const PRODUCTION_TONE: Record<string, Tone> = {
  brouillon: "neutral",
  en_attente_validation: "info",
  refuse: "danger",
  en_production: "brand",
  demande_cloture: "warning",
  terminee: "success",
  annulee: "neutral",
};

const SAMPLE_TONE: Record<string, Tone> = {
  demande: "info",
  en_fabrication: "brand",
  envoye: "warning",
  recu_client: "warning",
  valide: "success",
  a_ajuster: "warning",
  refuse: "danger",
  sans_suite: "neutral",
};

const PRIORITY_TONE: Record<string, Tone> = {
  basse: "neutral",
  normale: "info",
  haute: "warning",
  urgente: "danger",
};

export function PriorityBadge({ priority, label }: { priority: string; label: string }) {
  return (
    <Badge tone={PRIORITY_TONE[priority] ?? "neutral"} dot>
      {label}
    </Badge>
  );
}

export function StatusBadge({
  status,
  labels,
  kind,
}: {
  status: string;
  labels: Record<string, string>;
  kind: "request" | "quote" | "production" | "sample";
}) {
  const toneMap =
    kind === "request"
      ? REQUEST_TONE
      : kind === "quote"
        ? QUOTE_TONE
        : kind === "production"
          ? PRODUCTION_TONE
          : SAMPLE_TONE;

  return (
    <Badge tone={toneMap[status] ?? "neutral"} dot>
      {labels[status] ?? status}
    </Badge>
  );
}
