"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutEverywhereAction } from "./actions";

export function SignOutEverywhere() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      onClick={() => {
        if (window.confirm("Fermer la session sur tous vos appareils, y compris celui-ci ?")) {
          startTransition(() => signOutEverywhereAction());
        }
      }}
    >
      <LogOut className="h-3.5 w-3.5" /> Me déconnecter partout
    </Button>
  );
}
