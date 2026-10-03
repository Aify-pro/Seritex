import { redirect } from "next/navigation";

/** Les textiles (matières premières) ont quitté Paramètres pour le module Articles (ART-A, A3). */
export default function TextilesRedirect() {
  redirect("/articles?onglet=matieres");
}
