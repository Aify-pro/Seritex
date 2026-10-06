import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Onglets d'une page portés par l'URL (`?onglet=…`), rendus côté serveur :
 * chaque onglet ne charge que ses données, et le lien est partageable.
 * Le premier onglet est celui par défaut (sans paramètre).
 */
export function QueryTabs<T extends string>({
  basePath,
  tabs,
  current,
  label,
}: {
  basePath: string;
  tabs: { key: T; label: string }[];
  current: T;
  label: string;
}) {
  return (
    <nav aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
      {tabs.map((t, i) => (
        <Link
          key={t.key}
          href={i === 0 ? basePath : `${basePath}?onglet=${t.key}`}
          aria-current={current === t.key ? "page" : undefined}
          className={cn(
            "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            current === t.key ? "border-brand text-brand" : "border-transparent text-foreground-muted hover:border-border hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
