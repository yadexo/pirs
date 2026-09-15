"use client";

import * as React from "react";
import {
  CheckboxField,
  FormSection,
  ImageField,
  MoneyField,
  SelectField,
  TextAreaField,
  TextField,
  centsToInput,
  toLocalInput,
  type FieldErrors,
} from "@/components/merchant/form";
import type { ItemKind } from "@/lib/actions/app-builder";

export interface FormOptions {
  serviceCategories: string[];
  productCategories: string[];
  services: { id: string; name: string }[];
  products: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

export interface ItemFormProps {
  merchantId: string;
  currency: string;
  /** The saved record when editing; empty when creating. */
  item: Record<string, unknown>;
  options: FormOptions;
  errors: FieldErrors;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const isNew = (item: Record<string, unknown>) => !item.id;
/** New items start visible; existing ones keep their state. */
const activeDefault = (item: Record<string, unknown>) => (isNew(item) ? true : Boolean(item.active));

function CategoryField({ name, label, value, suggestions, errors }: { name: string; label: string; value: string; suggestions: string[]; errors: FieldErrors }) {
  const listId = `${name}-suggestions`;
  return (
    <>
      <TextField
        label={label}
        name={name}
        defaultValue={value}
        list={listId}
        autoComplete="off"
        errors={errors}
        hint="Pick one or type a new category."
      />
      <datalist id={listId}>
        {suggestions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}

function VisibilityField({ item, label = "Visible in the app" }: { item: Record<string, unknown>; label?: string }) {
  return <CheckboxField name="active" label={label} description="Clients can see and buy this." defaultChecked={activeDefault(item)} />;
}

// ---------------------------------------------------------------------------

export function ServiceForm({ merchantId, currency, item, options, errors }: ItemFormProps) {
  return (
    <div className="space-y-5">
      <FormSection title="Treatment">
        <TextField label="Name" name="name" defaultValue={str(item.name)} errors={errors} required maxLength={120} />
        <CategoryField
          label="Category"
          name="categoryName"
          value={str((item.category as { name?: string } | undefined)?.name)}
          suggestions={options.serviceCategories}
          errors={errors}
        />
        <TextAreaField label="Description" name="description" defaultValue={str(item.description)} errors={errors} />
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Price" name="price" currency={currency} defaultValue={centsToInput(item.priceCents as number)} errors={errors} required />
          <TextField label="Duration (minutes)" name="durationMinutes" type="number" min={5} step={5} defaultValue={str(item.durationMinutes ?? 30)} errors={errors} required />
        </div>
        <ImageField label="Image" name="imageUrl" merchantId={merchantId} defaultValue={item.imageUrl as string} errors={errors} />
      </FormSection>
      <FormSection title="For the client">
        <TextAreaField label="Before the appointment" name="prepInstructions" defaultValue={str(item.prepInstructions)} errors={errors} />
        <TextAreaField label="Aftercare" name="aftercareInstructions" defaultValue={str(item.aftercareInstructions)} errors={errors} />
      </FormSection>
      <FormSection title="Settings">
        <VisibilityField item={item} />
        <CheckboxField name="taxable" label="Taxable" defaultChecked={isNew(item) ? true : Boolean(item.taxable)} />
      </FormSection>
    </div>
  );
}

export function ProductForm({ merchantId, currency, item, options, errors }: ItemFormProps) {
  return (
    <div className="space-y-5">
      <FormSection title="Product">
        <TextField label="Name" name="name" defaultValue={str(item.name)} errors={errors} required maxLength={120} />
        <CategoryField
          label="Category"
          name="categoryName"
          value={str((item.category as { name?: string } | undefined)?.name)}
          suggestions={options.productCategories}
          errors={errors}
        />
        <TextAreaField label="Description" name="description" defaultValue={str(item.description)} errors={errors} />
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Price" name="price" currency={currency} defaultValue={centsToInput(item.priceCents as number)} errors={errors} required />
          <TextField label="In stock" name="inventoryQuantity" type="number" min={0} defaultValue={str(item.inventoryQuantity ?? 0)} errors={errors} />
        </div>
        <TextField label="SKU" name="sku" defaultValue={str(item.sku)} errors={errors} hint="Leave empty to generate one." />
        <ImageField label="Images" name="images" merchantId={merchantId} multiple defaultValue={(item.images as string[]) ?? []} errors={errors} />
      </FormSection>
      <FormSection title="Settings">
        <VisibilityField item={item} />
        <CheckboxField name="taxable" label="Taxable" defaultChecked={isNew(item) ? true : Boolean(item.taxable)} />
      </FormSection>
    </div>
  );
}

export function PackageForm({ merchantId, currency, item, options, errors }: ItemFormProps) {
  const chosen = new Set(((item.items as { serviceId: string }[]) ?? []).map((i) => i.serviceId));
  return (
    <div className="space-y-5">
      <FormSection title="Custom plan">
        <TextField label="Name" name="name" defaultValue={str(item.name)} errors={errors} required />
        <TextAreaField label="Description" name="description" defaultValue={str(item.description)} errors={errors} />
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Price" name="price" currency={currency} defaultValue={centsToInput(item.priceCents as number)} errors={errors} required />
          <TextField label="Sessions included" name="totalUses" type="number" min={1} defaultValue={str(item.totalUses ?? 5)} errors={errors} required />
        </div>
        <TextField label="Expires after (days)" name="expiryDays" type="number" min={1} defaultValue={str(item.expiryDays)} errors={errors} hint="Leave empty for no expiry." />
        <ImageField label="Image" name="imageUrl" merchantId={merchantId} defaultValue={item.imageUrl as string} errors={errors} />
      </FormSection>
      <FormSection title="Treatments it covers">
        {options.services.length === 0 ? (
          <p className="text-[12px] text-ink-muted">Add a treatment in Products first.</p>
        ) : (
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {options.services.map((s) => (
              <CheckboxField key={s.id} name="serviceIds" label={s.name} defaultChecked={chosen.has(s.id)} />
            ))}
          </div>
        )}
        {errors?.serviceIds && <p className="text-[12px] text-[var(--accent-red)]">{errors.serviceIds}</p>}
      </FormSection>
      <FormSection title="Settings">
        <VisibilityField item={item} />
        <CheckboxField name="transferable" label="Transferable" description="The client may give remaining sessions to someone else." defaultChecked={Boolean(item.transferable)} />
      </FormSection>
    </div>
  );
}

/**
 * datetime-local has no timezone. Converting here, in the browser, pins the
 * instant to the timezone of the person choosing it — otherwise the server
 * would read "09:00" in whatever timezone it happens to run in.
 */
function DateTimeField({ label, name, iso, errors }: { label: string; name: string; iso: string | undefined; errors: FieldErrors }) {
  const [local, setLocal] = React.useState(toLocalInput(iso));
  const instant = local ? new Date(local) : null;
  return (
    <>
      <TextField label={label} name={`${name}Local`} type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} errors={errors && { [`${name}Local`]: errors[name] ?? "" }} required />
      <input type="hidden" name={name} value={instant && !Number.isNaN(instant.getTime()) ? instant.toISOString() : ""} />
    </>
  );
}

export function PromotionForm({ merchantId, currency, item, options, errors }: ItemFormProps) {
  const [discountType, setDiscountType] = React.useState(str(item.discountType) || "PERCENT");
  const [segment, setSegment] = React.useState(str(item.customerSegment) || "ALL");
  const start = str(item.startAt) || new Date().toISOString();
  const end = str(item.endAt) || new Date(Date.now() + 30 * 864e5).toISOString();
  const storedValue = item.discountValue as number | undefined;
  const valueDefault =
    storedValue === undefined ? "" : discountType === "FIXED_AMOUNT" && item.discountType === "FIXED_AMOUNT" ? centsToInput(storedValue) : String(storedValue);

  return (
    <div className="space-y-5">
      <FormSection title="Offer">
        <TextField label="Title" name="title" defaultValue={str(item.title)} errors={errors} required />
        <TextAreaField label="Description" name="description" defaultValue={str(item.description)} errors={errors} />
        <ImageField label="Image" name="imageUrl" merchantId={merchantId} defaultValue={item.imageUrl as string} errors={errors} />
      </FormSection>
      <FormSection title="Discount">
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Type"
            name="discountType"
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value)}
            options={[
              { value: "PERCENT", label: "Percentage off" },
              { value: "FIXED_AMOUNT", label: "Amount off" },
            ]}
            errors={errors}
          />
          {discountType === "PERCENT" ? (
            <TextField key="pct" label="Percentage" name="discountValue" type="number" min={1} max={100} defaultValue={valueDefault} errors={errors} required />
          ) : (
            <MoneyField key="amt" label="Amount" name="discountValue" currency={currency} defaultValue={valueDefault} errors={errors} required />
          )}
        </div>
        <TextField label="Code" name="code" defaultValue={str(item.code)} errors={errors} hint="Optional. Leave empty to apply automatically." />
      </FormSection>
      <FormSection title="When">
        <div className="grid grid-cols-2 gap-3">
          <DateTimeField label="Starts" name="startAt" iso={start} errors={errors} />
          <DateTimeField label="Ends" name="endAt" iso={end} errors={errors} />
        </div>
      </FormSection>
      <FormSection title="Who and how often">
        <SelectField
          label="Clients"
          name="customerSegment"
          value={segment}
          onChange={(e) => setSegment(e.target.value)}
          options={[
            { value: "ALL", label: "Everyone" },
            { value: "NEW", label: "New clients" },
            { value: "MEMBERS", label: "Members" },
            { value: "NON_MEMBERS", label: "Non-members" },
            ...(options.tags.length ? [{ value: "TAGGED", label: "Clients with a tag" }] : []),
          ]}
          errors={errors}
        />
        {segment === "TAGGED" && (
          <SelectField
            label="Tag"
            name="segmentTagId"
            defaultValue={str(item.segmentTagId)}
            options={[{ value: "", label: "Choose a tag" }, ...options.tags.map((t) => ({ value: t.id, label: t.name }))]}
            errors={errors}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Total uses" name="usageLimit" type="number" min={1} defaultValue={str(item.usageLimit)} errors={errors} hint="Empty = unlimited" />
          <TextField label="Uses per client" name="perCustomerLimit" type="number" min={1} defaultValue={str(item.perCustomerLimit)} errors={errors} hint="Empty = unlimited" />
        </div>
        <CheckboxField name="appOnly" label="App only" description="Only redeemable through the client app." defaultChecked={Boolean(item.appOnly)} />
        <CheckboxField name="active" label="Active" description="Shown to clients between the start and end dates." defaultChecked={activeDefault(item)} />
      </FormSection>
    </div>
  );
}

export function MembershipPlanForm({ currency, item, errors }: ItemFormProps) {
  const [pauseAllowed, setPauseAllowed] = React.useState(isNew(item) ? true : Boolean(item.pauseAllowed));
  const members = Number(item.activeMembers ?? 0);
  const benefits = ((item.benefits as { description: string }[]) ?? []).map((b) => b.description).join("\n");
  return (
    <div className="space-y-5">
      {members > 0 && (
        <p className="rounded-[10px] bg-[var(--accent-amber)]/10 px-3 py-2 text-[12px] text-ink">
          {members} client{members === 1 ? " is" : "s are"} on this plan, so its price and billing period are locked. To change them, create a new plan
          and hide this one.
        </p>
      )}
      <FormSection title="Plan">
        <TextField label="Name" name="name" defaultValue={str(item.name)} errors={errors} required />
        <TextAreaField label="Description" name="description" defaultValue={str(item.description)} errors={errors} />
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Price" name="price" currency={currency} defaultValue={centsToInput(item.priceCents as number)} errors={errors} required readOnly={members > 0} />
          <SelectField
            label="Billed"
            name="billingFrequency"
            defaultValue={str(item.billingFrequency) || "MONTHLY"}
            options={[
              { value: "MONTHLY", label: "Monthly" },
              { value: "ANNUAL", label: "Yearly" },
            ]}
            errors={errors}
            disabled={members > 0}
          />
          {/* A disabled select is not submitted; send the locked value. */}
          {members > 0 && <input type="hidden" name="billingFrequency" value={str(item.billingFrequency)} />}
        </div>
        <TextAreaField label="Benefits" name="benefits" defaultValue={benefits} rows={4} errors={errors} hint="One per line. Shown on the plan card in the app." />
      </FormSection>
      <FormSection title="Member perks">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Treatment discount %" name="serviceDiscountPercent" type="number" min={1} max={100} defaultValue={str(item.serviceDiscountPercent)} errors={errors} />
          <TextField label="Product discount %" name="productDiscountPercent" type="number" min={1} max={100} defaultValue={str(item.productDiscountPercent)} errors={errors} />
        </div>
        <MoneyField label="Credit included each period" name="includedCredit" currency={currency} defaultValue={centsToInput(item.includedCreditCents as number)} errors={errors} />
        <CheckboxField name="priorityAccess" label="Priority booking" defaultChecked={Boolean(item.priorityAccess)} />
      </FormSection>
      <FormSection title="Terms">
        <TextField label="Minimum term (months)" name="minimumCommitmentMonths" type="number" min={1} defaultValue={str(item.minimumCommitmentMonths)} errors={errors} />
        <CheckboxField name="pauseAllowed" label="Members may pause" checked={pauseAllowed} onChange={setPauseAllowed} />
        {pauseAllowed && <TextField label="Longest pause (months)" name="maxPauseMonths" type="number" min={1} max={12} defaultValue={str(item.maxPauseMonths)} errors={errors} />}
        <TextAreaField label="Cancellation policy" name="cancellationPolicy" defaultValue={str(item.cancellationPolicy)} errors={errors} />
        <CheckboxField name="active" label="Open to new members" description="Hidden plans keep their current members." defaultChecked={activeDefault(item)} />
      </FormSection>
    </div>
  );
}

export function RewardForm({ currency, item, options, errors }: ItemFormProps) {
  const [type, setType] = React.useState(str(item.rewardType) || "DISCOUNT_PERCENT");
  return (
    <div className="space-y-5">
      <FormSection title="Reward">
        <TextField label="Name" name="name" defaultValue={str(item.name)} errors={errors} required />
        <TextAreaField label="Description" name="description" defaultValue={str(item.description)} errors={errors} />
        <TextField label="Points needed" name="pointsCost" type="number" min={1} defaultValue={str(item.pointsCost)} errors={errors} required />
      </FormSection>
      <FormSection title="What the client gets">
        <SelectField
          label="Type"
          name="rewardType"
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={[
            { value: "DISCOUNT_PERCENT", label: "Percentage off" },
            { value: "DISCOUNT_AMOUNT", label: "Amount off" },
            { value: "FREE_SERVICE", label: "Free treatment" },
            { value: "FREE_PRODUCT", label: "Free product" },
          ]}
          errors={errors}
        />
        {type === "DISCOUNT_PERCENT" && (
          <TextField label="Percentage" name="discountPercent" type="number" min={1} max={100} defaultValue={str(item.discountPercent)} errors={errors} required />
        )}
        {type === "DISCOUNT_AMOUNT" && (
          <MoneyField label="Amount" name="discountAmount" currency={currency} defaultValue={centsToInput(item.discountAmountCents as number)} errors={errors} required />
        )}
        {type === "FREE_SERVICE" && (
          <SelectField
            label="Treatment"
            name="serviceId"
            defaultValue={str(item.serviceId)}
            options={[{ value: "", label: "Choose a treatment" }, ...options.services.map((s) => ({ value: s.id, label: s.name }))]}
            errors={errors}
          />
        )}
        {type === "FREE_PRODUCT" && (
          <SelectField
            label="Product"
            name="productId"
            defaultValue={str(item.productId)}
            options={[{ value: "", label: "Choose a product" }, ...options.products.map((p) => ({ value: p.id, label: p.name }))]}
            errors={errors}
          />
        )}
        <CheckboxField name="active" label="Available to redeem" defaultChecked={activeDefault(item)} />
      </FormSection>
    </div>
  );
}

export const FORMS: Partial<Record<ItemKind, React.ComponentType<ItemFormProps>>> = {
  service: ServiceForm,
  product: ProductForm,
  package: PackageForm,
  promotion: PromotionForm,
  membershipPlan: MembershipPlanForm,
  reward: RewardForm,
};
