"use client";

import { useTransition } from "react";
import { useActionState } from "react";
import { Input, Label, Textarea, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { addCustomerNoteAction, adjustAccountCreditAction, toggleCustomerTagAction } from "@/lib/actions/customers";
import { manualLoyaltyAdjustmentAction } from "@/lib/actions/loyalty";
import { toast } from "@/components/ui/toaster";
import type { CustomerTag } from "@prisma/client";
import { cn } from "@/lib/utils";

export function NoteForm({ customerProfileId }: { customerProfileId: string }) {
  const action = addCustomerNoteAction.bind(null, customerProfileId);
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-2">
      <Textarea name="body" rows={2} placeholder="Add an internal note…" required />
      <FieldError>{state?.error}</FieldError>
      <SubmitButton className="w-auto" size="sm">
        Add note
      </SubmitButton>
    </form>
  );
}

export function AdjustCreditForm({ customerProfileId }: { customerProfileId: string }) {
  const [state, formAction] = useActionState(adjustAccountCreditAction, undefined);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="customerProfileId" value={customerProfileId} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="amount">Amount (USD, +/-)</Label>
          <Input id="amount" name="amount" type="number" step="0.01" required />
        </div>
        <div>
          <Label htmlFor="reason">Reason</Label>
          <Input id="reason" name="reason" required />
        </div>
      </div>
      <FieldError>{state?.error}</FieldError>
      <SubmitButton className="w-auto" size="sm">
        Adjust credit
      </SubmitButton>
    </form>
  );
}

export function AdjustPointsForm({ customerProfileId }: { customerProfileId: string }) {
  const [state, formAction] = useActionState(manualLoyaltyAdjustmentAction, undefined);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="customerProfileId" value={customerProfileId} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="points">Points (+/-)</Label>
          <Input id="points" name="points" type="number" required />
        </div>
        <div>
          <Label htmlFor="reason2">Reason</Label>
          <Input id="reason2" name="reason" required />
        </div>
      </div>
      <FieldError>{state?.error}</FieldError>
      <SubmitButton className="w-auto" size="sm">
        Adjust points
      </SubmitButton>
    </form>
  );
}

export function TagPicker({ customerProfileId, allTags, appliedTagIds }: { customerProfileId: string; allTags: CustomerTag[]; appliedTagIds: string[] }) {
  const [pending, startTransition] = useTransition();
  const applied = new Set(appliedTagIds);

  return (
    <div className="flex flex-wrap gap-1.5">
      {allTags.map((tag) => {
        const isApplied = applied.has(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await toggleCustomerTagAction(customerProfileId, tag.id, !isApplied);
                toast.success(isApplied ? "Tag removed" : "Tag applied");
              })
            }
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium",
              isApplied ? "border-brand-primary bg-brand-primary/10 text-brand-primary" : "border-border text-ink-muted hover:bg-surface-subtle",
            )}
          >
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}
