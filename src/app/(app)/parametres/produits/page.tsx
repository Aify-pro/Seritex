import { redirect } from "next/navigation";

/** Les modèles de produits ont quitté Paramètres pour le module Articles (ART-A, A3). */
export default function ProductModelsRedirect() {
  redirect("/articles");
}
