import { redirect } from "next/navigation";

/** Ancienne adresse : les demandes pour le stock sont dans Demandes (case « Pour le stock »). */
export default function StockRequestsRedirect() {
  redirect("/commercial/demandes");
}
