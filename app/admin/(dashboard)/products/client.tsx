"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Input, Label, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { createProductCategoryAction, archiveProductAction, adjustInventoryAction } from "@/lib/actions/catalog";
import { toast } from "@/components/ui/toaster";
import { Plus, Archive, PackagePlus } from "lucide-react";

export function NewProductCategoryForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createProductCategoryAction, undefined);
  if (state && "success" in state && state.success && open) setOpen(false);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New category
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New product category">
        <form action={formAction} className="space-y-4">
          <div>
            <Label htmlFor="pcat-name">Name</Label>
            <Input id="pcat-name" name="name" required />
          </div>
          <FieldError>{state?.error}</FieldError>
          <SubmitButton>Create category</SubmitButton>
        </form>
      </Dialog>
    </>
  );
}

export function ArchiveProductButton({ id, disabled }: { id: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <Archive className="h-4 w-4" />
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Archive product?"
        description="It will no longer be purchasable, but existing orders keep their history."
        confirmLabel="Archive"
        destructive
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            await archiveProductAction(id);
            toast.success("Product archived");
            setOpen(false);
          })
        }
      />
    </>
  );
}

export function AdjustInventoryButton({ productId, sku }: { productId: string; sku: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(adjustInventoryAction, undefined);
  if (state && "success" in state && state.success && open) setOpen(false);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <PackagePlus className="h-4 w-4" />
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Adjust inventory · ${sku}`}>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="productId" value={productId} />
          <div>
            <Label htmlFor="quantityChange">Quantity change</Label>
            <Input id="quantityChange" name="quantityChange" type="number" required placeholder="e.g. 10 or -3" />
          </div>
          <div>
            <Label htmlFor="reason">Reason</Label>
            <Input id="reason" name="reason" required placeholder="e.g. Restock from supplier" />
          </div>
          <FieldError>{state?.error}</FieldError>
          <SubmitButton>Save adjustment</SubmitButton>
        </form>
      </Dialog>
    </>
  );
}
