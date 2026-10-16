import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

const nf = new Intl.NumberFormat("fr-FR");

/** Pagination de liste : les liens conservent tous les critères (la page est le seul paramètre qui change). */
export function ListPagination({
  basePath,
  params,
  page,
  taille,
  total,
  noun,
}: {
  basePath: string;
  /** Query string actuelle (la page y est remplacée). */
  params: URLSearchParams;
  page: number;
  taille: number;
  total: number;
  noun: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / taille));
  const current = Math.min(page, totalPages);
  const href = (p: number) => {
    const sp = new URLSearchParams(params);
    sp.delete("page");
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const cls = "inline-flex items-center rounded-md border border-border px-2 py-1 hover:bg-surface-muted";
  return (
    <div className="flex items-center justify-between text-xs text-foreground-muted">
      <span>
        {nf.format(total)} {noun}
        {total > 1 ? "s" : ""} · page {current}/{totalPages}
      </span>
      <div className="flex gap-1">
        {current > 1 && (
          <Link href={href(current - 1)} className={cls}>
            <ChevronLeft className="h-3.5 w-3.5" /> Précédente
          </Link>
        )}
        {current < totalPages && (
          <Link href={href(current + 1)} className={cls}>
            Suivante <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
