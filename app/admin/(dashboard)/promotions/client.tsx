"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { archivePromotionAction } from "@/lib/actions/promotions";
import { toast } from "@/components/ui/toaster";
import { Archive } from "lucide-react";

export function ArchivePromotionButton({ id }: { id: string }) {
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
        title="End this promotion?"
        confirmLabel="End promotion"
        destructive
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            await archivePromotionAction(id);
            toast.success("Promotion ended");
            setOpen(false);
          })
        }
      />
    </>
  );
}
