import { redirect } from "next/navigation";

/** La grille de prix de revient d'un modèle vit désormais dans sa fiche article (ART-C). */
export default async function ModelPricingRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/articles/${id}/prix-de-revient`);
}
