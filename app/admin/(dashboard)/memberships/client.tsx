"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { archiveMembershipPlanAction } from "@/lib/actions/memberships";
import { toast } from "@/components/ui/toaster";
import { Archive } from "lucide-react";

export function ArchivePlanButton({ id }: { id: string }) {
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
        title="Archive plan?"
        description="Existing members keep their membership; new customers won't be able to join."
        confirmLabel="Archive"
        destructive
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            await archiveMembershipPlanAction(id);
            toast.success("Plan archived");
            setOpen(false);
          })
        }
      />
    </>
  );
}
