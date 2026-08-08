"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { inviteStaffAction, setStaffActiveAction } from "@/lib/actions/staff";
import { toast } from "@/components/ui/toaster";
import { Plus } from "lucide-react";
import type { Role } from "@prisma/client";

export function InviteStaffForm({ roles }: { roles: Role[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(inviteStaffAction, undefined);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Invite staff
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Invite staff member">
        {state && "success" in state && state.success ? (
          <div className="space-y-3">
            <p className="text-sm text-success">Invitation created.</p>
            <div className="rounded-md bg-surface-subtle p-3 text-sm">
              <p>Workspace: use your clinic&apos;s login page</p>
              <p>Email: <span className="font-mono">{state.email}</span></p>
              <p>Temporary password: <span className="font-mono">{state.tempPassword}</span></p>
            </div>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" name="firstName" required />
              </div>
              <div>
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" name="lastName" required />
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div>
              <Label htmlFor="roleId">Role</Label>
              <Select id="roleId" name="roleId">
                <option value="">No role (limited access)</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isAdmin" />
              Grant full administrator access
            </label>
            <FieldError>{state?.error}</FieldError>
            <SubmitButton>Send invite</SubmitButton>
          </form>
        )}
      </Dialog>
    </>
  );
}

export function ActiveToggle({ staffProfileId, active }: { staffProfileId: string; active: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant={active ? "outline" : "primary"}
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          await setStaffActiveAction(staffProfileId, !active);
          toast.success(active ? "Staff member deactivated" : "Staff member activated");
        })
      }
    >
      {active ? "Deactivate" : "Activate"}
    </Button>
  );
}
