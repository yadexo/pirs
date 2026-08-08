"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { createCustomerTagAction } from "@/lib/actions/customers";
import { Tag } from "lucide-react";

export function NewTagForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createCustomerTagAction, undefined);
  if (state && "success" in state && state.success && open) setOpen(false);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Tag className="h-4 w-4" /> New tag
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New customer tag">
        <form action={formAction} className="space-y-4">
          <div>
            <Label htmlFor="tag-name">Tag name</Label>
            <Input id="tag-name" name="name" required />
          </div>
          <FieldError>{state?.error}</FieldError>
          <SubmitButton>Create tag</SubmitButton>
        </form>
      </Dialog>
    </>
  );
}
