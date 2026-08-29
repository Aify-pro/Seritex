"use client";

import { useState, useRef, useEffect } from "react";
import { LogOut, ChevronDown } from "lucide-react";
import { signOutAction } from "@/app/login/actions";
import { ROLE_LABELS, type UserRole } from "@/lib/types/domain";

export function UserMenu({ fullName, role, email }: { fullName: string; role: UserRole; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const initials = fullName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-foreground">
          {initials}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-xs font-medium leading-tight text-foreground">{fullName}</span>
          <span className="block text-[11px] leading-tight text-foreground-muted">{ROLE_LABELS[role]}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-foreground-muted" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-surface py-1 shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <p className="text-xs font-medium text-foreground">{fullName}</p>
            <p className="truncate text-[11px] text-foreground-muted">{email}</p>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-danger-soft"
            >
              <LogOut className="h-4 w-4" />
              Se déconnecter
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
