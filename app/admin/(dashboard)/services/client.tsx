"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Input, Label, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { createServiceCategoryAction, updateServiceCategoryAction, archiveServiceCategoryAction, archiveServiceAction } from "@/lib/actions/catalog";
import { toast } from "@/components/ui/toaster";
import { Plus, Archive, Pencil } from "lucide-react";
import type { ServiceCategory } from "@prisma/client";

export function NewCategoryForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createServiceCategoryAction, undefined);

  if (state && "success" in state && state.success && open) {
    setOpen(false);
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New category
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New service category">
        <form action={formAction} className="space-y-4">
          <div>
            <Label htmlFor="category-name">Name</Label>
            <Input id="category-name" name="name" required />
          </div>
          <FieldError>{state?.error}</FieldError>
          <SubmitButton>Create category</SubmitButton>
        </form>
      </Dialog>
    </>
  );
}

export function EditCategoryButton({ category }: { category: ServiceCategory }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const action = updateServiceCategoryAction.bind(null, category.id);
  const [state, formAction] = useActionState(action, undefined);
  if (state && "success" in state && state.success && open) setOpen(false);

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md p-1 text-ink-subtle hover:bg-surface-subtle hover:text-ink" aria-label="Edit category">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Edit category">
        <form action={formAction} className="space-y-4">
          <div>
            <Label htmlFor={`cat-name-${category.id}`}>Name</Label>
            <Input id={`cat-name-${category.id}`} name="name" defaultValue={category.name} required />
          </div>
          <div>
            <Label htmlFor={`cat-order-${category.id}`}>Sort order</Label>
            <Input id={`cat-order-${category.id}`} name="sortOrder" type="number" defaultValue={category.sortOrder} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={category.active} />
            Active
          </label>
          <FieldError>{state?.error}</FieldError>
          <div className="flex items-center justify-between">
            <SubmitButton className="w-auto">Save changes</SubmitButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  await archiveServiceCategoryAction(category.id);
                  toast.success("Category archived");
                  setOpen(false);
                })
              }
            >
              Archive category
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function ArchiveServiceButton({ id, disabled }: { id: string; disabled?: boolean }) {
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
        title="Archive service?"
        description="This service will no longer be bookable, but existing history is preserved."
        confirmLabel="Archive"
        destructive
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            await archiveServiceAction(id);
            toast.success("Service archived");
            setOpen(false);
          })
        }
      />
    </>
  );
}
