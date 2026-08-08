"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { createRoleAction } from "@/lib/actions/staff";
import { PERMISSIONS } from "@/lib/permissions";
import { Plus } from "lucide-react";

export function NewRoleForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createRoleAction, undefined);
  if (state && "success" in state && state.success && open) setOpen(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New role
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New role">
        <form action={formAction} className="space-y-4">
          <div>
            <Label htmlFor="role-name">Role name</Label>
            <Input id="role-name" name="name" placeholder="e.g. Front desk" required />
          </div>
          <div>
            <Label>Permissions</Label>
            <div className="mt-2 space-y-1">
              {PERMISSIONS.map((p) => (
                <label key={p.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="permissions" value={p.key} />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
          <FieldError>{state?.error}</FieldError>
          <SubmitButton>Create role</SubmitButton>
        </form>
      </Dialog>
    </>
  );
}
