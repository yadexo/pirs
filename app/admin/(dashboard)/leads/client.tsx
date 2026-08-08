"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { createLeadAction, updateLeadStatusAction, convertLeadToCustomerAction } from "@/lib/actions/leads";
import { toast } from "@/components/ui/toaster";
import type { StaffProfile } from "@prisma/client";
import { Plus } from "lucide-react";

const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "BOOKED", "WON", "LOST"];

export function NewLeadForm({ staff }: { staff: StaffProfile[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createLeadAction, undefined);
  if (state && "success" in state && state.success && open) setOpen(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New lead
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New lead">
        <form action={formAction} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="source">Source</Label>
              <Input id="source" name="source" placeholder="e.g. Instagram" />
            </div>
            <div>
              <Label htmlFor="valueEstimate">Estimated value (USD)</Label>
              <Input id="valueEstimate" name="valueEstimate" type="number" step="0.01" />
            </div>
          </div>
          <div>
            <Label htmlFor="assignedStaffProfileId">Assign to</Label>
            <Select id="assignedStaffProfileId" name="assignedStaffProfileId">
              <option value="">Unassigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.firstName} {s.lastName}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={2} />
          </div>
          <FieldError>{state?.error}</FieldError>
          <SubmitButton>Create lead</SubmitButton>
        </form>
      </Dialog>
    </>
  );
}

export function LeadStatusSelect({ leadId, status }: { leadId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Select
      defaultValue={status}
      disabled={pending}
      className="w-36"
      onChange={(e) =>
        startTransition(async () => {
          await updateLeadStatusAction(leadId, e.target.value);
          toast.success("Status updated");
        })
      }
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </Select>
  );
}

export function ConvertLeadButton({ leadId, hasEmail }: { leadId: string; hasEmail: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!hasEmail}
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const { customerProfileId } = await convertLeadToCustomerAction(leadId);
            router.push(`/admin/customers/${customerProfileId}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not convert lead");
          }
        })
      }
    >
      Convert to customer
    </Button>
  );
}
