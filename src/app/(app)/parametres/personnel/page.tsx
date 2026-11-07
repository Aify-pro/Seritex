import { redirect } from "next/navigation";

/** L'écran Personnel s'ouvre sur son premier onglet : l'import mensuel. */
export default function PersonnelPage() {
  redirect("/parametres/personnel/import");
}
