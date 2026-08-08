"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { archivePackageAction } from "@/lib/actions/catalog";
import { toast } from "@/components/ui/toaster";
import { Archive } from "lucide-react";

export function ArchivePackageButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Archive className="h-4 w-4" />
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Archive package?"
        description="Customers who already purchased it keep their remaining uses."
        confirmLabel="Archive"
        destructive
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            await archivePackageAction(id);
            toast.success("Package archived");
            setOpen(false);
          })
        }
      />
    </>
  );
}
