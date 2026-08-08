"use client";

import { useActionState } from "react";
import { Input, Label, Select, Textarea, FieldError, FieldHint } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { createMembershipPlanAction } from "@/lib/actions/memberships";
import type { Service } from "@prisma/client";

export function MembershipPlanForm({ services }: { services: Service[] }) {
  const [state, formAction] = useActionState(createMembershipPlanAction, undefined);

  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <div>
        <Label htmlFor="name">Plan name</Label>
        <Input id="name" name="name" required />
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={2} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="price">Price (USD)</Label>
          <Input id="price" name="price" type="number" step="0.01" min="0" required />
        </div>
        <div>
          <Label htmlFor="billingFrequency">Billing frequency</Label>
          <Select id="billingFrequency" name="billingFrequency" required>
            <option value="MONTHLY">Monthly</option>
            <option value="ANNUAL">Annual</option>
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="includedCredit">Included account credit (USD, per period)</Label>
        <Input id="includedCredit" name="includedCredit" type="number" step="0.01" min="0" defaultValue="0" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="serviceDiscountPercent">Service discount %</Label>
          <Input id="serviceDiscountPercent" name="serviceDiscountPercent" type="number" min="0" max="100" />
        </div>
        <div>
          <Label htmlFor="productDiscountPercent">Product discount %</Label>
          <Input id="productDiscountPercent" name="productDiscountPercent" type="number" min="0" max="100" />
        </div>
      </div>
      <div>
        <Label>Included services</Label>
        <FieldHint>Services members can use at no extra cost.</FieldHint>
        <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {services.map((s) => (
            <label key={s.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-subtle">
              <input type="checkbox" name="includedServiceIds" value={s.id} />
              {s.name}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="minimumCommitmentMonths">Minimum commitment (months)</Label>
          <Input id="minimumCommitmentMonths" name="minimumCommitmentMonths" type="number" min="1" placeholder="None" />
        </div>
        <div>
          <Label htmlFor="maxPauseMonths">Max pause length (months)</Label>
          <Input id="maxPauseMonths" name="maxPauseMonths" type="number" min="1" defaultValue="1" />
        </div>
      </div>
      <div>
        <Label htmlFor="cancellationPolicy">Cancellation policy</Label>
        <Textarea id="cancellationPolicy" name="cancellationPolicy" rows={2} />
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="priorityAccess" />
          Priority booking access
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="pauseAllowed" defaultChecked />
          Allow pausing
        </label>
      </div>
      <FieldError>{state?.error}</FieldError>
      <SubmitButton className="w-auto">Create plan</SubmitButton>
    </form>
  );
}
