import "server-only";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";

/** Rôles de base qui peuvent ouvrir le module Articles ; le droit `articles/view` décide ensuite. */
export const ARTICLE_ROLES = ["administrateur", "responsable_production", "commercial", "gestionnaire_stock"] as const;

/** Exige l'accès au module Articles (rôle + droit `view`) ; renvoie aussi les droits utiles à l'écran. */
export async function requireArticles() {
  const current = await requireRole([...ARTICLE_ROLES]);
  if (!(await can("articles", "view"))) redirect("/dashboard?erreur=acces_refuse");
  const [canModify, canSeeCosts] = await Promise.all([can("articles", "modify"), can("tarification", "view")]);
  return { ...current, canModify, canSeeCosts };
}
