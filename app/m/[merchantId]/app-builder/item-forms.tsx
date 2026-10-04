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
import { NotifyOffer, type OfferCampaign } from "./notify-offer";
import { ProductPanelForm } from "./product-form";

export interface FormOptions {
  serviceCategories: string[];
  productCategories: string[];
  /** The same categories with their ids, for scoping a discount to one. */
  serviceCategoryOptions?: { id: string; name: string }[];
  productCategoryOptions?: { id: string; name: string }[];
  /** Shown in the notification preview, as the client would see it. */
  clinicName?: string;
  /** Whether this staff member may send notifications as well as write offers. */
  canSendMessages?: boolean;
  services: { id: string; name: string }[];
  products: { id: string; name: string }[];
  tags: { id: string; name: string; icon: string; description: string | null }[];
  staff: { id: string; name: string; title: string | null }[];
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

function VisibilityField({ item, label = "Visible in the app" }: { item: Record<string, unknown>; label?: string }) {
  return <CheckboxField name="active" label={label} description="Clients can see and buy this." defaultChecked={activeDefault(item)} />;
}

// ---------------------------------------------------------------------------

/**
 * Treatments and products share one panel: everything on it is optional, so a
 * clinic fills in only what its own product page should show.
 */
export function ServiceForm(props: ItemFormProps) {
  return <ProductPanelForm {...props} kind="service" />;
}

export function ProductForm(props: ItemFormProps) {
  return <ProductPanelForm {...props} kind="product" />;
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
/**
 * A wall-clock picker that posts exactly what the clinic typed.
 *
 * It used to convert to an instant here, in the browser, which quietly used
 * the staff member's own timezone. The server reads it in the clinic's
 * timezone instead, so a clinic manager abroad still sets the clinic's hours.
 */
function DateTimeField({ label, name, iso, errors, disabled }: { label: string; name: string; iso: string | undefined; errors: FieldErrors; disabled?: boolean }) {
  const [local, setLocal] = React.useState(toLocalInput(iso));
  return (
    <TextField
      label={label}
      name={`${name}Local`}
      type="datetime-local"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      errors={errors && { [`${name}Local`]: errors[`${name}Local`] ?? errors[name] ?? "" }}
      disabled={disabled}
      required={!disabled}
    />
  );
}

/** Checkboxes that post one form field several times — the shape the action reads. */
function MultiPick({
  label,
  name,
  options,
  selected,
}: {
  label: string;
  name: string;
  options: { id: string; name: string }[];
  selected: string[];
}) {
  if (options.length === 0) return null;
  return (
    <fieldset>
      <legend className="mb-1.5 text-[12px] font-medium text-ink-muted">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-1.5 rounded-[10px] border border-border px-2.5 py-1.5 text-[12px]">
            <input type="checkbox" name={name} value={o.id} defaultChecked={selected.includes(o.id)} className="h-3.5 w-3.5" />
            {o.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The saved eligibility rows, split back into the four pickers above. */
function scopeOf(item: Record<string, unknown>) {
  const rows = (item.eligibility as { productId?: string | null; serviceId?: string | null; productCategoryId?: string | null; serviceCategoryId?: string | null }[]) ?? [];
  return {
    productIds: rows.map((r) => r.productId).filter((v): v is string => !!v),
    serviceIds: rows.map((r) => r.serviceId).filter((v): v is string => !!v),
    productCategoryIds: rows.map((r) => r.productCategoryId).filter((v): v is string => !!v),
    serviceCategoryIds: rows.map((r) => r.serviceCategoryId).filter((v): v is string => !!v),
  };
}

export function PromotionForm({ merchantId, currency, item, options, errors }: ItemFormProps) {
  const [discountType, setDiscountType] = React.useState(str(item.discountType) || "PERCENT");
  const [segment, setSegment] = React.useState(str(item.customerSegment) || "ALL");
  const scope = scopeOf(item);
  // Kept in state so the notification's title and message can follow them
  // until the clinic edits the notification itself.
  const [title, setTitle] = React.useState(str(item.title));
  const [description, setDescription] = React.useState(str(item.description));
  // A new offer starts when it is saved; an existing one keeps its date.
  const [startNow, setStartNow] = React.useState(isNew(item));
  const start = str(item.startAt) || new Date().toISOString();
  const end = str(item.endAt) || new Date(Date.now() + 30 * 864e5).toISOString();
  const storedValue = item.discountValue as number | undefined;
  const valueDefault =
    storedValue === undefined ? "" : discountType === "FIXED_AMOUNT" && item.discountType === "FIXED_AMOUNT" ? centsToInput(storedValue) : String(storedValue);

  return (
    <div className="space-y-5">
      <FormSection title="Offer">
        <TextField label="Title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} errors={errors} required />
        <TextAreaField label="Description" name="description" value={description} onChange={(e) => setDescription(e.target.value)} errors={errors} />
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
        <TextField label="Code" name="code" defaultValue={str(item.code)} errors={errors} hint="Optional — for your own till. Clients in the app never type one." />
        <CheckboxField
          name="autoApply"
          label="Apply automatically in the client app"
          description="Eligible clients get it at checkout without typing anything, and see it on the price in the shop."
          defaultChecked={isNew(item) ? true : Boolean(item.autoApply)}
        />
        <MoneyField
          label="Minimum order"
          name="minOrder"
          currency={currency}
          defaultValue={item.minOrderCents ? centsToInput(item.minOrderCents as number) : ""}
          errors={errors}
          hint="Empty = no minimum."
        />
      </FormSection>
      <FormSection title="What it covers">
        <p className="text-[12px] text-ink-muted">Choose nothing to discount the whole shop.</p>
        <MultiPick label="Treatment categories" name="serviceCategoryIds" options={options.serviceCategoryOptions ?? []} selected={scope.serviceCategoryIds} />
        <MultiPick label="Product categories" name="productCategoryIds" options={options.productCategoryOptions ?? []} selected={scope.productCategoryIds} />
        <MultiPick label="Individual treatments" name="serviceIds" options={options.services} selected={scope.serviceIds} />
        <MultiPick label="Individual products" name="productIds" options={options.products} selected={scope.productIds} />
      </FormSection>
      <FormSection title="When">
        <CheckboxField
          name="startNow"
          label="Start immediately"
          description="The offer starts the moment you save, so filling in this form doesn't leave it starting in the past."
          checked={startNow}
          onChange={setStartNow}
        />
        <div className="grid grid-cols-2 gap-3">
          {!startNow && <DateTimeField label="Starts" name="startAt" iso={start} errors={errors} />}
          <DateTimeField label="Ends" name="endAt" iso={end} errors={errors} />
        </div>
        <p className="text-[12px] text-ink-muted">Times are your clinic&apos;s own, whatever timezone you happen to be in.</p>
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
      <NotifyOffer
        merchantId={merchantId}
        offerTitle={title}
        offerDescription={description}
        startAt={start}
        clinicName={options.clinicName ?? "Your clinic"}
        campaigns={(item.campaigns as OfferCampaign[]) ?? []}
        canSend={options.canSendMessages ?? false}
        errors={errors}
      />
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
          {/* Each rate covers its own half of the catalogue and nothing else,
              which is the easiest thing here to get wrong: a treatment
              discount does nothing for a member buying from the shelf. */}
          <TextField
            label="Treatment discount %"
            name="serviceDiscountPercent"
            type="number"
            min={1}
            max={100}
            defaultValue={str(item.serviceDiscountPercent)}
            errors={errors}
            hint="Members pay this much less for treatments. It does not apply to shop products."
          />
          <TextField
            label="Product discount %"
            name="productDiscountPercent"
            type="number"
            min={1}
            max={100}
            defaultValue={str(item.productDiscountPercent)}
            errors={errors}
            hint="Members pay this much less for shop products. It does not apply to treatments."
          />
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
