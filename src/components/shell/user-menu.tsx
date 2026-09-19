"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { LogOut, ChevronDown, UserRound, ShieldCheck } from "lucide-react";
import { signOutAction } from "@/app/login/actions";
import { ROLE_LABELS, type UserRole } from "@/lib/types/domain";

export function UserMenu({
  fullName,
  role,
  roleLabel,
  email,
}: {
  fullName: string;
  role: UserRole;
  /** Libellé du rôle métier (ex. « Direction ») ; à défaut, celui du rôle de base. */
  roleLabel?: string;
  email: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const label = roleLabel ?? ROLE_LABELS[role];

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const initials = fullName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const itemClass = "flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-surface-muted";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-foreground">
          {initials}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-xs font-medium leading-tight text-foreground">{fullName}</span>
          <span className="block text-[11px] leading-tight text-foreground-muted">{label}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-foreground-muted" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-60 rounded-md border border-border bg-surface py-1 shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <p className="text-xs font-medium text-foreground">{fullName}</p>
            <p className="truncate text-[11px] text-foreground-muted">{email}</p>
            <p className="mt-0.5 text-[11px] text-foreground-muted">{label}</p>
          </div>
          <Link href="/mon-compte" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
            <UserRound className="h-4 w-4 text-foreground-muted" />
            Mon profil
          </Link>
          <Link href="/mon-compte?onglet=securite" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
            <ShieldCheck className="h-4 w-4 text-foreground-muted" />
            Mot de passe et sécurité
          </Link>
          <form action={signOutAction} className="border-t border-border">
            <button type="submit" role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-danger-soft">
              <LogOut className="h-4 w-4" />
              Se déconnecter
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
