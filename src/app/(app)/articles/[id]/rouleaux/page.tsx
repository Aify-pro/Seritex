import { redirect } from "next/navigation";

/** Ancien onglet Rouleaux : il fait partie de l'onglet Stock (migration 0105). */
export default async function ArticleRollsRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/articles/${id}/stock`);
}
