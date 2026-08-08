"use client";

import { useActionState, useState } from "react";
import { Input, Label, Select, Textarea, FieldError, FieldHint } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { createPromotionAction } from "@/lib/actions/promotions";
import type { Service, Product, Package } from "@prisma/client";

export function PromotionForm({ services, products, packages }: { services: Service[]; products: Product[]; packages: Package[] }) {
  const [state, formAction] = useActionState(createPromotionAction, undefined);
  const [discountType, setDiscountType] = useState("PERCENT");

  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <div>
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required />
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={2} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="startAt">Start date</Label>
          <Input id="startAt" name="startAt" type="date" required />
        </div>
        <div>
          <Label htmlFor="endAt">End date</Label>
          <Input id="endAt" name="endAt" type="date" required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="discountType">Discount type</Label>
          <Select id="discountType" name="discountType" value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
            <option value="PERCENT">Percentage</option>
            <option value="FIXED_AMOUNT">Fixed amount</option>
          </Select>
        </div>
        {discountType === "PERCENT" ? (
          <div>
            <Label htmlFor="discountPercent">Discount %</Label>
            <Input id="discountPercent" name="discountPercent" type="number" min="1" max="100" required />
          </div>
        ) : (
          <div>
            <Label htmlFor="discountAmount">Discount amount (USD)</Label>
            <Input id="discountAmount" name="discountAmount" type="number" min="0.01" step="0.01" required />
          </div>
        )}
      </div>
      <div>
        <Label htmlFor="code">Promo code (optional)</Label>
        <Input id="code" name="code" placeholder="e.g. WELCOME10" />
        <FieldHint>Leave blank to apply automatically without a code.</FieldHint>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="usageLimit">Total usage limit</Label>
          <Input id="usageLimit" name="usageLimit" type="number" min="1" placeholder="Unlimited" />
        </div>
        <div>
          <Label htmlFor="perCustomerLimit">Per-customer limit</Label>
          <Input id="perCustomerLimit" name="perCustomerLimit" type="number" min="1" placeholder="Unlimited" />
        </div>
      </div>
      <div>
        <Label htmlFor="customerSegment">Customer segment</Label>
        <Select id="customerSegment" name="customerSegment">
          <option value="ALL">All customers</option>
          <option value="NEW">New customers</option>
          <option value="MEMBERS">Members</option>
          <option value="NON_MEMBERS">Non-members</option>
        </Select>
      </div>
      <div>
        <Label>Eligible services</Label>
        <FieldHint>Leave all unchecked to apply to the entire order.</FieldHint>
        <div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {services.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="serviceIds" value={s.id} /> {s.name}
            </label>
          ))}
        </div>
      </div>
      {products.length > 0 && (
        <div>
          <Label>Eligible products</Label>
          <div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="productIds" value={p.id} /> {p.name}
              </label>
            ))}
          </div>
        </div>
      )}
      {packages.length > 0 && (
        <div>
          <Label>Eligible packages</Label>
          <div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {packages.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="packageIds" value={p.id} /> {p.name}
              </label>
            ))}
          </div>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="appOnly" />
        App-only promotion
      </label>
      <FieldError>{state?.error}</FieldError>
      <SubmitButton className="w-auto">Create promotion</SubmitButton>
    </form>
  );
}
