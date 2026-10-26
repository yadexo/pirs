"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
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
import { FieldIssues, TextCheckPanel, useTextCheck } from "@/components/merchant/text-check";
import { Info } from "lucide-react";
import { packageSaving } from "@/lib/package-pricing";
import { formatMoney } from "@/lib/utils";

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
  services: { id: string; name: string; priceCents?: number }[];
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

function VisibilityField({ item, label }: { item: Record<string, unknown>; label?: string }) {
  const t = useTranslations("portal.appBuilder.itemForms.shared");
  return <CheckboxField name="active" label={label ?? t("visibleInApp")} description={t("visibleInAppDescription")} defaultChecked={activeDefault(item)} />;
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
  const t = useTranslations("portal.appBuilder.itemForms.packageForm");
  const chosen = new Set(((item.items as { serviceId: string }[]) ?? []).map((i) => i.serviceId));

  // What clients will see, recomputed as the clinic types. The saving is only
  // ever shown against a treatment's own price; a clinic editing this sees the
  // non-member figure, which is the larger of the two.
  const [priceInput, setPriceInput] = React.useState(centsToInput(item.priceCents as number));
  const [sessionsInput, setSessionsInput] = React.useState(String(item.totalUses ?? 5));
  const [covered, setCovered] = React.useState<Set<string>>(chosen);
  const priceCents = Math.round(Number(priceInput.replace(",", ".") || 0) * 100);
  const sessions = Number(sessionsInput) || 0;
  const coveredPrices = options.services.filter((svc) => covered.has(svc.id)).map((svc) => svc.priceCents ?? 0).filter((c) => c > 0);
  const preview = packageSaving({ packagePriceCents: priceCents, sessions, coveredSinglePricesCents: coveredPrices });

  return (
    <div className="space-y-5">
      <FormSection title={t("title")}>
        <TextField label={t("nameLabel")} name="name" defaultValue={str(item.name)} errors={errors} required />
        <TextAreaField label={t("descriptionLabel")} name="description" defaultValue={str(item.description)} errors={errors} />
        <div className="grid grid-cols-2 gap-3">
          <MoneyField
            label={t("priceInclVatLabel")}
            name="price"
            currency={currency}
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            errors={errors}
            required
          />
          <TextField
            label={t("sessionsIncludedLabel")}
            name="totalUses"
            type="number"
            min={2}
            value={sessionsInput}
            onChange={(e) => setSessionsInput(e.target.value)}
            errors={errors}
            required
          />
        </div>
        {sessions > 0 && priceCents > 0 && (
          <div className="pk-notice pk-notice-info">
            <Info className="ic h-4 w-4" aria-hidden="true" />
            <span className="txt">
              {t("perSessionPreview")} <b>{formatMoney(Math.round(priceCents / sessions), currency)} {t("perSession")}</b>
              {preview.savingCents !== null ? (
                <>
                  {" "}
                  {t("and")} <b>{preview.atLeast ? t("saveAtLeast") : t("save")} {formatMoney(preview.savingCents, currency)}</b>. {t("membersSeeSmallerSaving")}
                </>
              ) : (
                <>. {t("noSavingShown")}</>
              )}
            </span>
          </div>
        )}
        <TextField label={t("expiryLabel")} name="expiryDays" type="number" min={1} defaultValue={str(item.expiryDays)} errors={errors} hint={t("expiryHint")} />
        <ImageField label={t("imageLabel")} name="imageUrl" merchantId={merchantId} defaultValue={item.imageUrl as string} errors={errors} />
      </FormSection>
      <FormSection title={t("treatmentsTitle")}>
        {options.services.length === 0 ? (
          <p className="text-[12px] text-ink-muted">{t("addTreatmentFirst")}</p>
        ) : (
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {options.services.map((s) => (
              <CheckboxField
                key={s.id}
                name="serviceIds"
                label={s.name}
                checked={covered.has(s.id)}
                onChange={(on) =>
                  setCovered((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(s.id);
                    else next.delete(s.id);
                    return next;
                  })
                }
              />
            ))}
          </div>
        )}
        {errors?.serviceIds && <p className="text-[12px] text-[var(--accent-red)]">{errors.serviceIds}</p>}
      </FormSection>
      <FormSection title={t("settingsTitle")}>
        <VisibilityField item={item} />
        <CheckboxField name="transferable" label={t("transferableLabel")} description={t("transferableDescription")} defaultChecked={Boolean(item.transferable)} />
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
  const t = useTranslations("portal.appBuilder.itemForms.promotionForm");
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
  // An offer always has an end date in this form, so urgency words are fair.
  // The check still reads them, in case that ever stops being true.
  const check = useTextCheck({
    title: { text: title, hasEndDate: true },
    description: { text: description, hasEndDate: true },
  });

  const storedValue = item.discountValue as number | undefined;
  const valueDefault =
    storedValue === undefined ? "" : discountType === "FIXED_AMOUNT" && item.discountType === "FIXED_AMOUNT" ? centsToInput(storedValue) : String(storedValue);

  return (
    <div className="space-y-5">
      <FormSection title={t("offerTitle")}>
        <div>
          <TextField label={t("titleLabel")} name="title" value={title} onChange={(e) => setTitle(e.target.value)} errors={errors} required />
          <FieldIssues issues={check.byField.title} />
        </div>
        <div>
          <TextAreaField label={t("descriptionLabel")} name="description" value={description} onChange={(e) => setDescription(e.target.value)} errors={errors} />
          <FieldIssues issues={check.byField.description} />
        </div>
        <ImageField label={t("imageLabel")} name="imageUrl" merchantId={merchantId} defaultValue={item.imageUrl as string} errors={errors} />
        <TextCheckPanel issues={check.issues} blocking={check.blocking} />
        {/* The drawer's Save reads this: an offer with an open issue can be
            kept as a draft but not published. */}
        <input type="hidden" name="__textCheckBlocking" value={check.blocking} />
      </FormSection>
      <FormSection title={t("discountTitle")}>
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label={t("typeLabel")}
            name="discountType"
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value)}
            options={[
              { value: "PERCENT", label: t("percentageOff") },
              { value: "FIXED_AMOUNT", label: t("amountOff") },
            ]}
            errors={errors}
          />
          {discountType === "PERCENT" ? (
            <TextField key="pct" label={t("percentageLabel")} name="discountValue" type="number" min={1} max={100} defaultValue={valueDefault} errors={errors} required />
          ) : (
            <MoneyField key="amt" label={t("amountLabel")} name="discountValue" currency={currency} defaultValue={valueDefault} errors={errors} required />
          )}
        </div>
        <TextField label={t("codeLabel")} name="code" defaultValue={str(item.code)} errors={errors} hint={t("codeHint")} />
        <CheckboxField
          name="autoApply"
          label={t("autoApplyLabel")}
          description={t("autoApplyDescription")}
          defaultChecked={isNew(item) ? true : Boolean(item.autoApply)}
        />
        <MoneyField
          label={t("minOrderLabel")}
          name="minOrder"
          currency={currency}
          defaultValue={item.minOrderCents ? centsToInput(item.minOrderCents as number) : ""}
          errors={errors}
          hint={t("minOrderHint")}
        />
      </FormSection>
      <FormSection title={t("coversTitle")}>
        <p className="text-[12px] text-ink-muted">{t("coversHint")}</p>
        <MultiPick label={t("serviceCategoriesLabel")} name="serviceCategoryIds" options={options.serviceCategoryOptions ?? []} selected={scope.serviceCategoryIds} />
        <MultiPick label={t("productCategoriesLabel")} name="productCategoryIds" options={options.productCategoryOptions ?? []} selected={scope.productCategoryIds} />
        <MultiPick label={t("individualTreatmentsLabel")} name="serviceIds" options={options.services} selected={scope.serviceIds} />
        <MultiPick label={t("individualProductsLabel")} name="productIds" options={options.products} selected={scope.productIds} />
      </FormSection>
      <FormSection title={t("whenTitle")}>
        <CheckboxField
          name="startNow"
          label={t("startImmediatelyLabel")}
          description={t("startImmediatelyDescription")}
          checked={startNow}
          onChange={setStartNow}
        />
        <div className="grid grid-cols-2 gap-3">
          {!startNow && <DateTimeField label={t("startsLabel")} name="startAt" iso={start} errors={errors} />}
          <DateTimeField label={t("endsLabel")} name="endAt" iso={end} errors={errors} />
        </div>
        <p className="text-[12px] text-ink-muted">{t("timesHint")}</p>
      </FormSection>
      <FormSection title={t("whoTitle")}>
        <SelectField
          label={t("clientsLabel")}
          name="customerSegment"
          value={segment}
          onChange={(e) => setSegment(e.target.value)}
          options={[
            { value: "ALL", label: t("everyone") },
            { value: "NEW", label: t("newClients") },
            { value: "MEMBERS", label: t("members") },
            { value: "NON_MEMBERS", label: t("nonMembers") },
            ...(options.tags.length ? [{ value: "TAGGED", label: t("clientsWithTag") }] : []),
          ]}
          errors={errors}
        />
        {segment === "TAGGED" && (
          <SelectField
            label={t("tagLabel")}
            name="segmentTagId"
            defaultValue={str(item.segmentTagId)}
            options={[{ value: "", label: t("chooseTag") }, ...options.tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
            errors={errors}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t("totalUsesLabel")} name="usageLimit" type="number" min={1} defaultValue={str(item.usageLimit)} errors={errors} hint={t("unlimitedHint")} />
          <TextField label={t("usesPerClientLabel")} name="perCustomerLimit" type="number" min={1} defaultValue={str(item.perCustomerLimit)} errors={errors} hint={t("unlimitedHint")} />
        </div>
        <CheckboxField name="appOnly" label={t("appOnlyLabel")} description={t("appOnlyDescription")} defaultChecked={Boolean(item.appOnly)} />
        <CheckboxField name="active" label={t("activeLabel")} description={t("activeDescription")} defaultChecked={activeDefault(item)} />
      </FormSection>
      <NotifyOffer
        merchantId={merchantId}
        offerTitle={title}
        offerDescription={description}
        startAt={start}
        clinicName={options.clinicName ?? t("yourClinic")}
        campaigns={(item.campaigns as OfferCampaign[]) ?? []}
        canSend={options.canSendMessages ?? false}
        errors={errors}
      />
    </div>
  );
}

export function MembershipPlanForm({ currency, item, errors }: ItemFormProps) {
  const t = useTranslations("portal.appBuilder.itemForms.membershipPlanForm");
  const [pauseAllowed, setPauseAllowed] = React.useState(isNew(item) ? true : Boolean(item.pauseAllowed));
  const members = Number(item.activeMembers ?? 0);
  const benefits = ((item.benefits as { description: string }[]) ?? []).map((b) => b.description).join("\n");
  return (
    <div className="space-y-5">
      {members > 0 && (
        <p className="rounded-[10px] bg-[var(--accent-amber)]/10 px-3 py-2 text-[12px] text-ink">
          {t("activeMembersNotice", { count: members })}
        </p>
      )}
      <FormSection title={t("planTitle")}>
        <TextField label={t("nameLabel")} name="name" defaultValue={str(item.name)} errors={errors} required />
        <TextAreaField label={t("descriptionLabel")} name="description" defaultValue={str(item.description)} errors={errors} />
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label={t("priceInclVatLabel")} name="price" currency={currency} defaultValue={centsToInput(item.priceCents as number)} errors={errors} required />
          <SelectField
            label={t("billedLabel")}
            name="billingFrequency"
            defaultValue={str(item.billingFrequency) || "MONTHLY"}
            options={[
              { value: "MONTHLY", label: t("monthly") },
              { value: "ANNUAL", label: t("yearly") },
            ]}
            errors={errors}
            disabled={members > 0}
          />
          {/* A disabled select is not submitted; send the locked value. */}
          {members > 0 && <input type="hidden" name="billingFrequency" value={str(item.billingFrequency)} />}
        </div>
        <TextAreaField label={t("benefitsLabel")} name="benefits" defaultValue={benefits} rows={4} errors={errors} hint={t("benefitsHint")} />
      </FormSection>
      <FormSection title={t("memberPerksTitle")}>
        <div className="grid grid-cols-2 gap-3">
          {/* Each rate covers its own half of the catalogue and nothing else,
              which is the easiest thing here to get wrong: a treatment
              discount does nothing for a member buying from the shelf. */}
          <TextField
            label={t("serviceDiscountLabel")}
            name="serviceDiscountPercent"
            type="number"
            min={1}
            max={100}
            defaultValue={str(item.serviceDiscountPercent)}
            errors={errors}
            hint={t("serviceDiscountHint")}
          />
          <TextField
            label={t("productDiscountLabel")}
            name="productDiscountPercent"
            type="number"
            min={1}
            max={100}
            defaultValue={str(item.productDiscountPercent)}
            errors={errors}
            hint={t("productDiscountHint")}
          />
        </div>
        <MoneyField label={t("includedCreditLabel")} name="includedCredit" currency={currency} defaultValue={centsToInput(item.includedCreditCents as number)} errors={errors} />
        {members > 0 && (
          <div className="rounded-[10px] border border-border p-3">
            <CheckboxField
              name="applyToExistingMembers"
              label={t("applyToExistingLabel")}
              description={t("applyToExistingDescription")}
              defaultChecked={false}
            />
          </div>
        )}
        <CheckboxField name="priorityAccess" label={t("priorityBookingLabel")} defaultChecked={Boolean(item.priorityAccess)} />
      </FormSection>
      <FormSection title={t("termsTitle")}>
        <TextField label={t("minimumTermLabel")} name="minimumCommitmentMonths" type="number" min={1} defaultValue={str(item.minimumCommitmentMonths)} errors={errors} />
        <CheckboxField name="pauseAllowed" label={t("pauseAllowedLabel")} checked={pauseAllowed} onChange={setPauseAllowed} />
        {pauseAllowed && <TextField label={t("longestPauseLabel")} name="maxPauseMonths" type="number" min={1} max={12} defaultValue={str(item.maxPauseMonths)} errors={errors} />}
        <TextAreaField label={t("cancellationPolicyLabel")} name="cancellationPolicy" defaultValue={str(item.cancellationPolicy)} errors={errors} />
        <CheckboxField name="active" label={t("openToNewLabel")} description={t("openToNewDescription")} defaultChecked={activeDefault(item)} />
      </FormSection>
    </div>
  );
}

export function RewardForm({ currency, item, options, errors }: ItemFormProps) {
  const t = useTranslations("portal.appBuilder.itemForms.rewardForm");
  const [type, setType] = React.useState(str(item.rewardType) || "DISCOUNT_PERCENT");
  return (
    <div className="space-y-5">
      <FormSection title={t("rewardTitle")}>
        <TextField label={t("nameLabel")} name="name" defaultValue={str(item.name)} errors={errors} required />
        <TextAreaField label={t("descriptionLabel")} name="description" defaultValue={str(item.description)} errors={errors} />
        <TextField label={t("pointsNeededLabel")} name="pointsCost" type="number" min={1} defaultValue={str(item.pointsCost)} errors={errors} required />
      </FormSection>
      <FormSection title={t("whatClientGetsTitle")}>
        <SelectField
          label={t("typeLabel")}
          name="rewardType"
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={[
            { value: "DISCOUNT_PERCENT", label: t("percentageOff") },
            { value: "DISCOUNT_AMOUNT", label: t("amountOff") },
            { value: "FREE_SERVICE", label: t("freeTreatment") },
            { value: "FREE_PRODUCT", label: t("freeProduct") },
          ]}
          errors={errors}
        />
        {type === "DISCOUNT_PERCENT" && (
          <TextField label={t("percentageLabel")} name="discountPercent" type="number" min={1} max={100} defaultValue={str(item.discountPercent)} errors={errors} required />
        )}
        {type === "DISCOUNT_AMOUNT" && (
          <MoneyField label={t("amountLabel")} name="discountAmount" currency={currency} defaultValue={centsToInput(item.discountAmountCents as number)} errors={errors} required />
        )}
        {type === "FREE_SERVICE" && (
          <SelectField
            label={t("treatmentLabel")}
            name="serviceId"
            defaultValue={str(item.serviceId)}
            options={[{ value: "", label: t("chooseTreatment") }, ...options.services.map((s) => ({ value: s.id, label: s.name }))]}
            errors={errors}
          />
        )}
        {type === "FREE_PRODUCT" && (
          <SelectField
            label={t("productLabel")}
            name="productId"
            defaultValue={str(item.productId)}
            options={[{ value: "", label: t("chooseProduct") }, ...options.products.map((p) => ({ value: p.id, label: p.name }))]}
            errors={errors}
          />
        )}
        <CheckboxField name="active" label={t("availableToRedeemLabel")} defaultChecked={activeDefault(item)} />
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
