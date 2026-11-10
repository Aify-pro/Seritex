import { cn } from "@/lib/utils";

export function Card({ id, className, children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      className={cn(
        "rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <Description texte={description} />}
      </div>
      {action}
    </div>
  );
}

/**
 * Texte d'aide d'une carte : au-delà d'une phrase courte, seule la première
 * phrase reste visible, la suite se déplie sous « En savoir plus » (élément
 * natif <details>, sans JavaScript). Un contenu non textuel s'affiche tel quel.
 */
const SEUIL_AIDE = 140;
function Description({ texte }: { texte: React.ReactNode }) {
  const simple = <p className="mt-0.5 text-xs text-foreground-muted">{texte}</p>;
  if (typeof texte !== "string" || texte.length <= SEUIL_AIDE) return simple;
  // Coupure à la première fin de phrase (« . » ou « ; » suivi d'un espace) après 30 caractères.
  const fin = texte.slice(30).search(/[.;] /);
  if (fin < 0 || fin + 31 > 220) return simple;
  const coupe = fin + 31;
  return (
    <div className="mt-0.5 text-xs text-foreground-muted">
      <p>{texte.slice(0, coupe)}</p>
      <details className="group">
        <summary className="cursor-pointer list-none text-brand hover:underline">
          <span className="group-open:hidden">En savoir plus</span>
          <span className="hidden group-open:inline">Réduire</span>
        </summary>
        <p className="mt-0.5">{texte.slice(coupe).trim()}</p>
      </details>
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "neutral" | "brand" | "accent" | "warning" | "danger" | "info";
}) {
  const toneRing: Record<string, string> = {
    neutral: "",
    brand: "ring-1 ring-inset ring-brand/15",
    accent: "ring-1 ring-inset ring-accent/15",
    warning: "ring-1 ring-inset ring-warning/20",
    danger: "ring-1 ring-inset ring-danger/20",
    info: "ring-1 ring-inset ring-info/20",
  };
  return (
    <Card className={cn("p-5", toneRing[tone])}>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-foreground-muted">{hint}</p>}
    </Card>
  );
}
