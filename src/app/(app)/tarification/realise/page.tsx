import { redirect } from "next/navigation";

/** Ancienne adresse : le prix de revient réel est dans l'onglet Coûts de chaque ODF. */
export default function RealCostsRedirect() {
  redirect("/atelier/production");
}
