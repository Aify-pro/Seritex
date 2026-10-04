import { redirect } from "next/navigation";

export default async function ArticleIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/articles/${id}/general`);
}
