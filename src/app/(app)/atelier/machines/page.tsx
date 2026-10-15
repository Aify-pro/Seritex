import { redirect } from "next/navigation";

/** L'ancienne page Atelier > Machines et écrans vit maintenant dans Paramètres > Atelier > Impression. */
export default function MachinesEcransRedirection() {
  redirect("/parametres/impression");
}
