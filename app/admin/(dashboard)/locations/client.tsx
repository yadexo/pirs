"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Input, Label, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { createLocationAction, archiveLocationAction } from "@/lib/actions/locations";
import { toast } from "@/components/ui/toaster";
import { Plus, Archive } from "lucide-react";

export function NewLocationForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createLocationAction, undefined);
  if (state && "success" in state && state.success && open) setOpen(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New location
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New location">
        <form action={formAction} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required />
          </div>
          <div>
            <Label htmlFor="addressLine1">Address</Label>
            <Input id="addressLine1" name="addressLine1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" />
            </div>
            <div>
              <Label htmlFor="region">State / region</Label>
              <Input id="region" name="region" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="postalCode">Postal code</Label>
              <Input id="postalCode" name="postalCode" />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" />
            </div>
          </div>
          <FieldError>{state?.error}</FieldError>
          <SubmitButton>Create location</SubmitButton>
        </form>
      </Dialog>
    </>
  );
}

export function ArchiveLocationButton({ id }: { id: string }) {
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
        title="Archive location?"
        destructive
        confirmLabel="Archive"
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            await archiveLocationAction(id);
            toast.success("Location archived");
            setOpen(false);
          })
        }
      />
    </>
  );
}
