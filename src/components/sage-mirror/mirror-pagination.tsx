import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

const nf = new Intl.NumberFormat("fr-FR");

/** Bandeau « 1–50 sur 1 234 » + liens Précédent/Suivant qui conservent recherche et filtres. */
export function MirrorPagination({
  basePath,
  query,
  page,
  size,
  total,
  noun,
  plural = `${noun}s`,
}: {
  basePath: string;
  /** Paramètres d'URL actifs (q, filtres) à conserver — sans `page`. */
  query: Record<string, string>;
  page: number;
  size: number;
  total: number;
  noun: string;
  plural?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (current - 1) * size + 1;
  const to = Math.min(current * size, total);

  function href(p: number) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const link = "inline-flex items-center gap-1 font-medium text-brand hover:underline";
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-foreground-muted"
    >
      <span>
        {total === 0 ? `Aucun ${noun}` : `${nf.format(from)}–${nf.format(to)} sur ${nf.format(total)} ${total > 1 ? plural : noun}`}
      </span>
      {totalPages > 1 && (
        <span className="flex items-center gap-4">
          {current > 1 ? (
            <Link href={href(current - 1)} className={link}>
              <ChevronLeft className="h-3.5 w-3.5" /> Précédent
            </Link>
          ) : (
            <span />
          )}
          <span>
            Page {nf.format(current)} / {nf.format(totalPages)}
          </span>
          {current < totalPages ? (
            <Link href={href(current + 1)} className={link}>
              Suivant <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span />
          )}
        </span>
      )}
    </nav>
  );
}
