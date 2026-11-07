import { redirect } from "next/navigation";

/** L'écran Personnel s'ouvre sur son premier onglet : les fiches. */
export default function PersonnelPage() {
  redirect("/parametres/personnel/fiches");
}
