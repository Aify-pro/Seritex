import { redirect } from "next/navigation";

/** Ancienne adresse : le paramétrage est sous Paramètres, la grille dans chaque fiche article. */
export default function TarificationRedirect() {
  redirect("/parametres/tarification");
}
