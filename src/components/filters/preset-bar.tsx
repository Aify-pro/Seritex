"use client";

import { Suspense, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Bookmark, Check, MoreHorizontal, Plus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { canonicalParams } from "@/lib/filters/params";
import { creerPreset, modifierPreset, supprimerPreset } from "@/lib/presets/actions";
import type { Preset, PresetModule } from "@/lib/presets/modules";

const inputClass =
  "h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-brand/30";

/**
 * Préréglages de filtres (migration 0134) : un bouton par préréglage au-dessus
 * de la liste. Un clic applique ses critères ; le bouton actif se reconnaît à
 * ce que l'URL de la page est exactement la sienne. Depuis le bouton actif :
 * renommer, le mettre à jour avec les critères du moment, le partager avec
 * l'équipe, le supprimer. « Enregistrer ce filtre » apparaît dès que la liste
 * est filtrée autrement qu'un préréglage existant.
 */
export function PresetBar(props: { module: PresetModule; presets: Preset[]; canShare: boolean }) {
  return (
    <Suspense fallback={null}>
      <PresetBarInner {...props} />
    </Suspense>
  );
}

type Mode = { kind: "none" } | { kind: "save" } | { kind: "rename"; id: string } | { kind: "delete"; id: string };

function PresetBarInner({ module, presets, canShare }: { module: PresetModule; presets: Preset[]; canShare: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [menuId, setMenuId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const current = canonicalParams(searchParams);
  const active = presets.find((p) => canonicalParams(p.params) === current) ?? null;

  useEffect(() => {
    if (!menuId) return;
    const close = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setMenuId(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuId]);

  function apply(params: string) {
    setMenuId(null);
    setMode({ kind: "none" });
    router.push(params ? `${pathname}?${params}` : pathname);
  }

  function run(task: () => Promise<{ error?: string }>, success: string, after?: () => void) {
    startTransition(async () => {
      const res = await task();
      if (res.error) toast.error(res.error);
      else {
        toast.success(success);
        setMenuId(null);
        setMode({ kind: "none" });
        after?.();
      }
    });
  }

  const canSave = current !== "" && !active;
  const empty = presets.length === 0;

  return (
    <div ref={barRef} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!empty && (
          <button
            type="button"
            onClick={() => apply("")}
            className={cn(
              "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors",
              current === "" ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface text-foreground-muted hover:bg-surface-muted"
            )}
          >
            Par défaut
          </button>
        )}

        {presets.map((p) => {
          const isActive = active?.id === p.id;
          if (mode.kind === "rename" && mode.id === p.id) {
            return (
              <form
                key={p.id}
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => modifierPreset({ id: p.id, module, name }), "Préréglage renommé");
                }}
              >
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={`${inputClass} w-40`} aria-label="Nouveau nom" />
                <Button type="submit" size="sm" loading={pending}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setMode({ kind: "none" })}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </form>
            );
          }
          if (mode.kind === "delete" && mode.id === p.id) {
            return (
              <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger-soft px-3 py-1 text-xs text-danger">
                Supprimer « {p.name} » ?
                <button
                  type="button"
                  disabled={pending}
                  className="font-semibold underline"
                  onClick={() => run(() => supprimerPreset(p.id, module), "Préréglage supprimé")}
                >
                  Oui
                </button>
                <button type="button" className="font-medium" onClick={() => setMode({ kind: "none" })}>
                  Non
                </button>
              </span>
            );
          }
          return (
            <span key={p.id} className="relative inline-flex">
              <span
                className={cn(
                  "inline-flex h-8 items-center overflow-hidden rounded-full border text-xs font-medium transition-colors",
                  isActive ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface text-foreground hover:bg-surface-muted"
                )}
              >
                <button
                  type="button"
                  onClick={() => apply(p.params)}
                  title={p.mine ? undefined : `Partagé par ${p.ownerName ?? "un collègue"}`}
                  className="inline-flex h-full items-center gap-1.5 px-3"
                >
                  {p.shared && <Users className="h-3 w-3 opacity-70" aria-label="Partagé avec l'équipe" />}
                  {p.name}
                </button>
                {p.mine && (
                  <button
                    type="button"
                    aria-label={`Options de « ${p.name} »`}
                    aria-expanded={menuId === p.id}
                    onClick={() => setMenuId(menuId === p.id ? null : p.id)}
                    className="inline-flex h-full items-center border-l border-current/20 px-1.5 opacity-70 hover:opacity-100"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
              {menuId === p.id && (
                <ul className="absolute left-0 top-9 z-20 w-64 rounded-md border border-border bg-surface p-1 text-xs shadow-lg">
                  <MenuItem
                    onClick={() => {
                      setName(p.name);
                      setMenuId(null);
                      setMode({ kind: "rename", id: p.id });
                    }}
                  >
                    Renommer
                  </MenuItem>
                  <MenuItem
                    disabled={pending || canonicalParams(p.params) === current}
                    hint={canonicalParams(p.params) === current ? "Les critères actuels sont déjà ceux du préréglage" : undefined}
                    onClick={() => run(() => modifierPreset({ id: p.id, module, params: current }), "Préréglage mis à jour")}
                  >
                    Remplacer par les critères actuels
                  </MenuItem>
                  {(canShare || p.shared) && (
                    <MenuItem
                      disabled={pending}
                      onClick={() =>
                        run(() => modifierPreset({ id: p.id, module, shared: !p.shared }), p.shared ? "Préréglage rendu personnel" : "Préréglage partagé avec l'équipe")
                      }
                    >
                      {p.shared ? "Ne plus partager (personnel)" : "Partager avec l'équipe"}
                    </MenuItem>
                  )}
                  <MenuItem danger onClick={() => { setMenuId(null); setMode({ kind: "delete", id: p.id }); }}>
                    Supprimer
                  </MenuItem>
                </ul>
              )}
            </span>
          );
        })}

        {mode.kind === "save" ? (
          <form
            className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-muted/50 px-2 py-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => creerPreset({ module, name, params: current, shared: canShare && shared }), "Préréglage enregistré");
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Nom du préréglage"
              aria-label="Nom du préréglage"
              className={`${inputClass} w-48`}
            />
            {canShare && (
              <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
                <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
                Partager avec l&apos;équipe
              </label>
            )}
            <Button type="submit" size="sm" loading={pending} disabled={name.trim() === ""}>
              Enregistrer
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode({ kind: "none" })}>
              Annuler
            </Button>
          </form>
        ) : (
          canSave && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setName("");
                setShared(false);
                setMode({ kind: "save" });
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Enregistrer ce filtre
            </Button>
          )
        )}

        {empty && current === "" && mode.kind !== "save" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-foreground-muted">
            <Bookmark className="h-3.5 w-3.5" /> Choisissez des critères, puis enregistrez-les ici comme préréglage.
          </span>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
  hint,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        title={hint}
        onClick={onClick}
        className={cn(
          "w-full rounded px-2.5 py-1.5 text-left transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50",
          danger ? "text-danger" : "text-foreground"
        )}
      >
        {children}
      </button>
    </li>
  );
}
