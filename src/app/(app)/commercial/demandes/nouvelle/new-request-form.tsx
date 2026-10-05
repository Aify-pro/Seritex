"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CompanyPicker } from "@/components/clients/company-picker";
import { RequestArticlesEditor, type ArticleLineDraft, type ArticleModelOption } from "@/components/requests/request-articles-editor";
import { listCompanyContacts, type CompanyContactOption, type CompanySearchResult } from "@/lib/actions/companies";
import { createRequest } from "../../actions";

/**
 * Nouvelle demande : pour un client, ou « Pour le stock » (fabrication sans
 * client, SF-3). Dans les deux cas on peut choisir les articles demandés ;
 * pour le stock ils sont obligatoires, avec leurs quantités par taille.
 *
 * L'entreprise se cherche par saisie (plusieurs milliers de clients importés
 * de Sage : un menu déroulant serait tronqué) ; ses contacts sont chargés à
 * la sélection.
 */
export function NewRequestForm({ models, stockOnly }: { models: ArticleModelOption[]; stockOnly: boolean }) {
  const [pourStock, setPourStock] = useState(stockOnly);
  const [company, setCompany] = useState<CompanySearchResult | null>(null);
  const [contacts, setContacts] = useState<CompanyContactOption[]>([]);
  const [lines, setLines] = useState<ArticleLineDraft[]>([]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const total = lines.reduce((s, l) => s + Object.values(l.tailles).reduce((t, q) => t + (q || 0), 0), 0);
  const canSubmit = pourStock ? total > 0 : !!company;

  async function onCompanyChange(c: CompanySearchResult | null) {
    setCompany(c);
    setContacts([]);
    if (c) setContacts(await listCompanyContacts(c.id));
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          formData.set("pour_stock", pourStock ? "on" : "");
          formData.set("lignes", JSON.stringify(lines));
          const res = await createRequest(formData);
          if (res.error) toast.error(res.error);
          else {
            toast.success(pourStock ? "Demande pour le stock créée" : "Demande créée");
            router.push(`/commercial/demandes/${res.requestId}`);
          }
        })
      }
      className="max-w-3xl space-y-5"
    >
      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
        <input
          type="checkbox"
          checked={pourStock}
          disabled={stockOnly}
          onChange={(e) => setPourStock(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        Pour le stock (fabrication sans client)
      </label>

      {!pourStock && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Entreprise</label>
            <CompanyPicker name="company_id" required onChange={onCompanyChange} />
          </div>

          {contacts.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Contact</label>
              <select name="contact_id" className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm">
                <option value="">—</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">{pourStock ? "Motif" : "Description du besoin"}</label>
        <textarea
          name="description"
          required={!pourStock}
          rows={3}
          className="w-full rounded-md border border-border bg-surface p-3 text-sm"
          placeholder={
            pourStock
              ? "Ex : réassort de t-shirts blancs, préparation de la saison…"
              : "Ex : 300 polos brodés logo, taille S à XL, livraison sous 3 semaines..."
          }
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">
          Articles demandés {pourStock ? "(obligatoire, avec les quantités par taille)" : "(facultatif : ils seront repris dans le devis)"}
        </p>
        <RequestArticlesEditor models={models} lines={lines} onChange={setLines} disabled={pending} />
      </div>

      {!pourStock && (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" name="needs_graphics" className="h-4 w-4 rounded border-border" />
          Nécessite une intervention graphique (visuel à préparer)
        </label>
      )}

      <Button type="submit" loading={pending} disabled={!canSubmit}>
        {pourStock ? `Créer la demande pour le stock${total ? ` (${total} pièce${total > 1 ? "s" : ""})` : ""}` : "Créer la demande"}
      </Button>
    </form>
  );
}
