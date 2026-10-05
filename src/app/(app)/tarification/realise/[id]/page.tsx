import { redirect } from "next/navigation";

/** Ancienne adresse : le prix de revient réel est dans l'onglet Coûts de l'ODF. */
export default async function OdfRealCostRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/atelier/production/${id}?onglet=couts`);
}
