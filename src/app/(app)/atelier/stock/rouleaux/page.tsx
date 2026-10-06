import { redirect } from "next/navigation";

/** Ancienne adresse : les rouleaux sont un onglet de la gestion de stock. */
export default async function RollsRedirect({ searchParams }: { searchParams: Promise<{ tissu?: string; statut?: string; q?: string }> }) {
  const params = await searchParams;
  const sp = new URLSearchParams({ onglet: "rouleaux" });
  for (const k of ["tissu", "statut", "q"] as const) if (params[k]) sp.set(k, params[k]!);
  redirect(`/atelier/stock?${sp.toString()}`);
}
