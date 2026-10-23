// Affiché dès le clic sur un menu, pendant que la page se charge côté serveur :
// le menu et l'en-tête (layout) restent en place et interactifs.
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-1/3 animate-pulse rounded-md bg-border/60" />
      <div className="h-24 w-full animate-pulse rounded-lg bg-border/40" />
      <div className="h-64 w-full animate-pulse rounded-lg bg-border/40" />
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
