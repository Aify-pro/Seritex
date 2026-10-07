import "server-only";
import { can, requireModule } from "@/lib/auth/permissions";

/** Exige l'accès au module Articles (droit `view`) ; renvoie aussi les droits utiles à l'écran. */
export async function requireArticles() {
  const current = await requireModule("articles");
  const [canModify, canCreate, canSeeCosts] = await Promise.all([can("articles", "modify"), can("articles", "create"), can("tarification", "view")]);
  return { ...current, canModify, canCreate, canSeeCosts };
}
