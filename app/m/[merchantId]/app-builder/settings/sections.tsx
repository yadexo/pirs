"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Drawer, Pill } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import {
  CheckboxField,
  FormSection,
  ImageField,
  MoneyField,
  SelectField,
  TextAreaField,
  TextField,
  centsToInput,
  type FieldErrors,
} from "@/components/merchant/form";
import {
  archiveLocationAction,
  deleteRoleAction,
  inviteStaffAction,
  resendInviteAction,
  saveBookingSettingsAction,
  saveBrandingAction,
  saveGeneralSettingsAction,
  saveLocationAction,
  saveLoyaltyRulesAction,
  saveNotificationSettingsAction,
  saveRoleAction,
  setStaffActiveAction,
  setStaffRoleAction,
} from "@/lib/actions/clinic-settings";
import type { ActionResult } from "@/lib/merchant-action";
import { WEEKDAYS, WEEKDAY_LABEL, isOpeningHours, type OpeningHours } from "@/lib/opening-hours";
import type { SettingsData } from "./load";
import { BroadcastForm } from "./broadcast";
import { DailyLimitField } from "./daily-limit";
import { DEFAULT_WINDOW_END, DEFAULT_WINDOW_START } from "@/lib/marketing-window";
import { SendingWindowFields } from "./sending-window";

type Data<S extends SettingsData["section"]> = Extract<SettingsData, { section: S }>;
type SaveFn = (merchantId: string, fd: FormData) => Promise<ActionResult>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// ---------------------------------------------------------------------------
// Shared: a section form that saves, shows field errors, and confirms.
// ---------------------------------------------------------------------------

function SettingsForm({
  merchantId,
  save,
  canEdit,
  lockedReason,
  children,
}: {
  merchantId: string;
  save: SaveFn;
  canEdit: boolean;
  lockedReason?: string;
  children: (errors: FieldErrors) => React.ReactNode;
}) {
  const t = useTranslations("portal.appBuilder.settings.sections.form");
  const router = useRouter();
  const [errors, setErrors] = React.useState<FieldErrors>();
  const [pending, setPending] = React.useState(false);
  const ref = React.useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canEdit) return;
    setPending(true);
    const res = await save(merchantId, new FormData(e.currentTarget));
    setPending(false);
    if ("error" in res) {
      setErrors(res.fieldErrors);
      toast.error(res.error);
      requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    setErrors(undefined);
    toast.success(t("saved"));
    router.refresh();
  }

  return (
    <form ref={ref} onSubmit={onSubmit} noValidate className="space-y-6">
      {!canEdit && <p className="rounded-[10px] bg-app px-3 py-2 text-[12px] text-ink-muted">{lockedReason ?? t("lockedReasonDefault")}</p>}
      <fieldset disabled={!canEdit || pending} className="space-y-6">
        {children(errors)}
      </fieldset>
      {canEdit && (
        <div className="flex justify-end border-t border-border pt-4">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("saveChanges")}
          </Button>
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

/**
 * The clinic's own link and QR code. Posters and the front desk use it; it
 * opens the clinic's app and offers sign-up, whether or not the clinic is
 * listed in search.
 */
function AppLinkCard({ merchantId, url, qrSvg }: { merchantId: string; url: string; qrSvg: string }) {
  const t = useTranslations("portal.appBuilder.settings.sections.general");
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("copyError"));
    }
  }
  return (
    <FormSection title={t("appLinkTitle")}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Generated on the server from our own URL — not user-supplied markup. */}
        <div className="h-36 w-36 shrink-0 rounded-[10px] border border-border bg-surface p-1" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <div className="min-w-0 space-y-3">
          <p className="text-[13px] text-ink-muted">{t("appLinkDescription")}</p>
          <p className="truncate rounded-[8px] bg-app px-3 py-2 font-mono text-[12px] text-ink" title={url}>{url}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t("copied") : t("copyLink")}
            </Button>
            <a
              href={`/m/${merchantId}/app-qr`}
              download
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-pill border border-border bg-surface px-4 text-[13px] font-medium text-ink transition-colors hover:bg-app"
            >
              <Download className="h-3.5 w-3.5" /> {t("downloadQr")}
            </a>
          </div>
        </div>
      </div>
    </FormSection>
  );
}

export function GeneralSection({ merchantId, data, canEdit }: { merchantId: string; data: Data<"general">; canEdit: boolean }) {
  const t = useTranslations("portal.appBuilder.settings.sections.general");
  const s = data.settings;
  const b = data.branding;
  return (
    <div className="space-y-8">
    <AppLinkCard merchantId={merchantId} url={data.appLink.url} qrSvg={data.appLink.qrSvg} />
    <SettingsForm merchantId={merchantId} save={saveGeneralSettingsAction} canEdit={canEdit}>
      {(errors) => (
        <>
          <FormSection title={t("clientAppTitle")}>
            <CheckboxField
              name="publiclyListed"
              label={t("publiclyListedLabel")}
              description={t("publiclyListedDescription")}
              defaultChecked={s ? s.publiclyListed : true}
            />
            <CheckboxField
              name="payLaterEnabled"
              label={t("payLaterLabel")}
              description={t("payLaterDescription")}
              defaultChecked={Boolean(s?.payLaterEnabled)}
            />
          </FormSection>
          <FormSection title={t("shopBannerTitle")}>
            <TextField label={t("headlineLabel")} name="shopBannerHeadline" defaultValue={str(s?.shopBannerHeadline)} placeholder={t("headlinePlaceholder")} maxLength={80} errors={errors} />
            <TextField label={t("subtitleLabel")} name="shopBannerSubtitle" defaultValue={str(s?.shopBannerSubtitle)} placeholder={t("subtitlePlaceholder")} maxLength={120} errors={errors} />
            <TextField label={t("buttonLabelLabel")} name="shopBannerButtonLabel" defaultValue={str(s?.shopBannerButtonLabel)} placeholder={t("buttonLabelPlaceholder")} maxLength={30} errors={errors} hint={t("shopBannerHint")} />
          </FormSection>
          <FormSection title={t("languageTitle")}>
            <SelectField
              label={t("defaultLocaleLabel")}
              name="defaultClientLocale"
              defaultValue={s?.defaultClientLocale ?? "nl"}
              options={[
                { value: "nl", label: t("dutch") },
                { value: "en", label: t("english") },
              ]}
              hint={t("defaultLocaleHint")}
            />
            <SelectField
              label={t("toneLabel")}
              name="clientFormality"
              defaultValue={s?.clientFormality ?? "INFORMAL"}
              options={[
                { value: "INFORMAL", label: t("toneInformal") },
                { value: "FORMAL", label: t("toneFormal") },
              ]}
              hint={t("toneHint")}
            />
          </FormSection>
          <FormSection title={t("moneyTitle")}>
            <TextField
              label={t("vatRateLabel")}
              name="vatRatePercent"
              inputMode="decimal"
              defaultValue={s ? String(s.vatRateBasisPoints / 100) : "21"}
              errors={errors}
              hint={t("vatRateHint")}
              className="max-w-[180px]"
            />
          </FormSection>
          <FormSection title={t("policiesTitle")}>
            <TextAreaField label={t("termsLabel")} name="termsContent" rows={5} defaultValue={str(b?.termsContent)} errors={errors} />
            <TextAreaField label={t("privacyLabel")} name="privacyContent" rows={5} defaultValue={str(b?.privacyContent)} errors={errors} />
            <TextAreaField label={t("cancellationPolicyLabel")} name="cancellationPolicy" rows={3} defaultValue={str(b?.cancellationPolicy)} errors={errors} />
          </FormSection>
        </>
      )}
    </SettingsForm>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

/** A rough approximation of the generated icon — the real one (lib/app-icon.ts)
 *  always does the right thing regardless of how close this preview gets. */
function HomeScreenIconPreview({ logoUrl, color, name }: { logoUrl: string | null; color: string; name: string }) {
  return (
    <div
      className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden shadow-sm"
      style={{ borderRadius: "22%", background: color }}
      aria-hidden="true"
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-[22px] font-bold text-white">{(name || "C").charAt(0).toUpperCase()}</span>
      )}
    </div>
  );
}

function LaunchScreenPreview({
  logoUrl,
  color,
  name,
  background,
}: {
  logoUrl: string | null;
  color: string;
  name: string;
  background: "brand" | "white";
}) {
  const bg = background === "white" ? "#ffffff" : color;
  const onBg = background === "white" ? "#111318" : "#ffffff";
  return (
    <div
      className="flex h-28 w-16 shrink-0 flex-col items-center justify-center rounded-[14px] border border-border shadow-sm"
      style={{ background: bg }}
      aria-hidden="true"
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-8 w-8 object-contain" />
      ) : (
        <span className="text-[16px] font-bold" style={{ color: onBg }}>
          {(name || "C").charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

export function BrandingSection({ merchantId, data, canEdit }: { merchantId: string; data: Data<"branding">; canEdit: boolean }) {
  const t = useTranslations("portal.appBuilder.settings.sections.branding");
  const b = data.branding;
  const [color, setColor] = React.useState(str(b?.primaryColor) || "#0f766e");
  const [name, setName] = React.useState(str(b?.businessName));
  const [appIconUrl, setAppIconUrl] = React.useState<string | null>(b?.appIconUrl ?? null);
  const [launchBackground, setLaunchBackground] = React.useState<"brand" | "white">(b?.launchBackground === "white" ? "white" : "brand");
  const { currencies, timeZones } = data;

  return (
    <SettingsForm merchantId={merchantId} save={saveBrandingAction} canEdit={canEdit}>
      {(errors) => (
        <>
          <FormSection title={t("identityTitle")}>
            <TextField label={t("clinicNameLabel")} name="businessName" value={name} onChange={(e) => setName(e.target.value)} errors={errors} required maxLength={120} />
            <div className="grid gap-4 sm:grid-cols-2">
              <ImageField label={t("logoLabel")} name="logoUrl" merchantId={merchantId} purpose="logo" defaultValue={b?.logoUrl} errors={errors} hint={t("logoHint")} />
              <ImageField
                label={t("appIconLabel")}
                name="appIconUrl"
                merchantId={merchantId}
                purpose="app-icon"
                defaultValue={b?.appIconUrl}
                errors={errors}
                onChange={(urls) => setAppIconUrl(urls[0] ?? null)}
                hint={t("appIconHint")}
              />
            </div>
            <ImageField
              label={t("coverLabel")}
              name="coverImageUrl"
              merchantId={merchantId}
              purpose="cover-image"
              defaultValue={b?.coverImageUrl}
              errors={errors}
              hint={t("coverHint")}
            />
            <div className="flex items-center gap-3">
              <HomeScreenIconPreview logoUrl={appIconUrl} color={color} name={name} />
              <p className="max-w-xs text-[12px] text-ink-muted">{t("iconPreviewHint")}</p>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label htmlFor="primaryColor" className="mb-1.5 block text-[12px] font-medium">
                  {t("brandColorLabel")}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="primaryColor"
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded-[10px] border border-border bg-surface p-1"
                  />
                  <input
                    name="primaryColor"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    aria-label={t("brandColorHexAria")}
                    aria-invalid={Boolean(errors?.primaryColor)}
                    className="h-10 w-28 rounded-[10px] border border-border bg-surface px-3 font-mono text-[13px]"
                  />
                </div>
                {errors?.primaryColor && <p className="mt-1 text-[12px] text-[var(--accent-red)]">{errors.primaryColor}</p>}
              </div>
              {/* A small preview of how the accent reads on a button in the client app. */}
              <div className="flex items-center gap-2 rounded-[10px] border border-border px-3 py-2" aria-hidden="true">
                {b?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.logoUrl} alt="" className="h-7 w-7 rounded-md object-cover" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-md text-[12px] font-semibold text-white" style={{ background: color }}>
                    {(name || "C").charAt(0)}
                  </span>
                )}
                <span className="text-[12px] font-medium">{name || t("clinicNameFallback")}</span>
                <span className="rounded-pill px-3 py-1 text-[11px] font-semibold text-white" style={{ background: color }}>
                  {t("bookPill")}
                </span>
              </div>
            </div>
          </FormSection>
          <FormSection title={t("launchScreenTitle")}>
            <p className="-mt-1 text-[12px] text-ink-muted">{t("launchScreenDescription")}</p>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex gap-3" role="radiogroup" aria-label={t("launchBackgroundAria")}>
                {(["brand", "white"] as const).map((opt) => (
                  <label
                    key={opt}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-medium",
                      launchBackground === opt ? "border-ink" : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name="launchBackground"
                      value={opt}
                      checked={launchBackground === opt}
                      onChange={() => setLaunchBackground(opt)}
                      className="h-3.5 w-3.5"
                    />
                    {opt === "brand" ? t("brandColorOption") : t("whiteOption")}
                  </label>
                ))}
              </div>
              <LaunchScreenPreview logoUrl={appIconUrl} color={color} name={name} background={launchBackground} />
            </div>
            <p className="rounded-[10px] bg-surface-subtle px-3 py-2 text-[12px] text-ink-muted">
              {t("reAddHint")}
            </p>
          </FormSection>
          <FormSection title={t("contactTitle")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t("emailLabel")} name="contactEmail" type="email" defaultValue={str(b?.contactEmail)} errors={errors} />
              <TextField label={t("phoneLabel")} name="contactPhone" type="tel" defaultValue={str(b?.contactPhone)} errors={errors} />
            </div>
            <TextField label={t("websiteLabel")} name="website" type="url" placeholder="https://" defaultValue={str(b?.website)} errors={errors} />
            <TextField label={t("addressLabel")} name="addressLine1" defaultValue={str(b?.addressLine1)} errors={errors} />
            <TextField label={t("addressLine2Label")} name="addressLine2" defaultValue={str(b?.addressLine2)} errors={errors} />
            <div className="grid gap-3 sm:grid-cols-4">
              <TextField label={t("cityLabel")} name="city" defaultValue={str(b?.city)} errors={errors} className="sm:col-span-2" />
              <TextField label={t("postalCodeLabel")} name="postalCode" defaultValue={str(b?.postalCode)} errors={errors} />
              <TextField label={t("countryLabel")} name="country" defaultValue={str(b?.country)} errors={errors} />
            </div>
          </FormSection>
          <FormSection title={t("regionTitle")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label={t("currencyLabel")}
                name="currency"
                defaultValue={str(b?.currency) || "EUR"}
                options={currencies.map((c) => ({ value: c, label: c }))}
                errors={errors}
                disabled={data.currencyLocked}
                hint={data.currencyLocked ? t("currencyLockedHint") : undefined}
              />
              {data.currencyLocked && <input type="hidden" name="currency" value={str(b?.currency)} />}
              <SelectField label={t("timeZoneLabel")} name="timeZone" defaultValue={str(b?.timeZone) || "Europe/Amsterdam"} options={timeZones.map((tz) => ({ value: tz, label: tz.replace(/_/g, " ") }))} errors={errors} />
            </div>
          </FormSection>
        </>
      )}
    </SettingsForm>
  );
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export function TeamSection({ merchantId, data, canEdit }: { merchantId: string; data: Data<"team">; canEdit: boolean }) {
  const t = useTranslations("portal.appBuilder.settings.sections.team");
  const tc = useTranslations("common");
  const router = useRouter();
  const [inviting, setInviting] = React.useState(false);
  const [inviteLink, setInviteLink] = React.useState<{ link: string; emailed: boolean } | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>();
  const [pending, setPending] = React.useState(false);
  const [roleEditor, setRoleEditor] = React.useState<null | { id: string | null; name: string; permissions: string[] }>(null);

  async function run(p: Promise<ActionResult>, success: string) {
    const res = await p;
    if ("error" in res) return toast.error(res.error);
    toast.success(success);
    router.refresh();
  }

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const res = await inviteStaffAction(merchantId, new FormData(e.currentTarget));
    setPending(false);
    if ("error" in res) {
      setErrors(res.fieldErrors);
      return toast.error(res.error);
    }
    setErrors(undefined);
    setInviteLink({ link: res.inviteLink, emailed: res.emailed });
    router.refresh();
  }

  async function saveRole(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!roleEditor) return;
    setPending(true);
    const res = await saveRoleAction(merchantId, roleEditor.id, new FormData(e.currentTarget));
    setPending(false);
    if ("error" in res) {
      setErrors(res.fieldErrors);
      return toast.error(res.error);
    }
    setErrors(undefined);
    setRoleEditor(null);
    toast.success(t("roleSavedToast"));
    router.refresh();
  }

  const categories = [...new Set(data.allPermissions.map((p) => p.category))];

  return (
    <div className="space-y-8">
      {!canEdit && <p className="rounded-[10px] bg-app px-3 py-2 text-[12px] text-ink-muted">{t("ownerOnly")}</p>}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("peopleTitle")}</h3>
          {canEdit && (
            <Button size="sm" onClick={() => { setInviting(true); setInviteLink(null); setErrors(undefined); }}>
              <Plus className="h-3.5 w-3.5" /> {t("inviteStaff")}
            </Button>
          )}
        </div>
        <ul className="divide-y divide-border rounded-card border border-border">
          {data.users.map((u) => {
            const p = u.staffProfile;
            const isOwner = u.role === "TENANT_ADMIN";
            return (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold">{p ? `${p.firstName} ${p.lastName}` : u.email}</p>
                  <p className="truncate text-[11px] text-ink-muted">
                    {u.email}
                    {p?.title ? ` · ${p.title}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isOwner ? (
                    <Pill tone="primary">{t("ownerPill")}</Pill>
                  ) : (
                    <>
                      {u.status === "INVITED" && <Pill tone="amber">{t("invitedPill")}</Pill>}
                      {p && !p.active && <Pill tone="neutral">{t("deactivatedPill")}</Pill>}
                      {p && (
                        <select
                          aria-label={t("roleForAria", { name: p.firstName })}
                          defaultValue={p.roleId ?? ""}
                          disabled={!canEdit}
                          onChange={(e) => run(setStaffRoleAction(merchantId, p.id, e.target.value || null), t("roleUpdatedToast"))}
                          className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px]"
                        >
                          <option value="">{t("noRoleOption")}</option>
                          {data.roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {canEdit && p && u.status === "INVITED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const res = await resendInviteAction(merchantId, p.id);
                            if ("error" in res) return toast.error(res.error);
                            setInviteLink({ link: res.inviteLink, emailed: res.emailed });
                            setInviting(true);
                          }}
                        >
                          {t("resendInvite")}
                        </Button>
                      )}
                      {canEdit && p && u.status !== "INVITED" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => run(setStaffActiveAction(merchantId, p.id, !p.active), p.active ? t("accessRemovedToast") : t("accessRestoredToast"))}
                        >
                          {p.active ? t("deactivate") : t("reactivate")}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("rolesTitle")}</h3>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => { setRoleEditor({ id: null, name: "", permissions: [] }); setErrors(undefined); }}>
              <Plus className="h-3.5 w-3.5" /> {t("newRole")}
            </Button>
          )}
        </div>
        {data.roles.length === 0 ? (
          <p className="text-[12px] text-ink-muted">{t("noRolesYet")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-card border border-border">
            {data.roles.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{r.name}</p>
                  <p className="truncate text-[11px] text-ink-muted">
                    {r.permissions.length ? r.permissions.map((k) => data.allPermissions.find((p) => p.key === k)?.label ?? k).join(", ") : t("noPermissions")} ·{" "}
                    {t("membersCount", { count: r.members })}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setRoleEditor({ id: r.id, name: r.name, permissions: r.permissions }); setErrors(undefined); }}>
                      {tc("edit")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => run(deleteRoleAction(merchantId, r.id), t("roleDeletedToast"))}>
                      {tc("delete")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Drawer open={inviting} onClose={() => setInviting(false)} title={inviteLink ? t("invitationReadyTitle") : t("inviteStaff")}>
        {inviteLink ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-muted">
              {inviteLink.emailed ? t("emailedHint") : t("noEmailHint")}
            </p>
            <CopyBox value={inviteLink.link} />
            <p className="text-[12px] text-ink-muted">{t("linkExpiryHint")}</p>
            <Button onClick={() => setInviting(false)} className="w-full">
              {tc("done")}
            </Button>
          </div>
        ) : (
          <form onSubmit={invite} noValidate className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <TextField label={t("firstNameLabel")} name="firstName" errors={errors} required />
              <TextField label={t("lastNameLabel")} name="lastName" errors={errors} required />
            </div>
            <TextField label={t("emailLabel")} name="email" type="email" errors={errors} required />
            <TextField label={t("jobTitleLabel")} name="title" errors={errors} hint={t("jobTitleHint")} />
            <SelectField label={t("roleLabel")} name="roleId" errors={errors} options={[{ value: "", label: t("noRoleYetOption") }, ...data.roles.map((r) => ({ value: r.id, label: r.name }))]} />
            <Button type="submit" disabled={pending} className="w-full">
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("sendInvitation")}
            </Button>
          </form>
        )}
      </Drawer>

      <Drawer open={roleEditor !== null} onClose={() => setRoleEditor(null)} title={roleEditor?.id ? t("editRoleTitle") : t("newRole")}>
        {roleEditor && (
          <form onSubmit={saveRole} noValidate className="space-y-4">
            <TextField label={t("roleNameLabel")} name="name" defaultValue={roleEditor.name} errors={errors} required />
            {categories.map((c) => (
              <FormSection key={c} title={c}>
                {data.allPermissions
                  .filter((p) => p.category === c)
                  .map((p) => (
                    <CheckboxField key={p.key} name="permissions" label={p.label} defaultChecked={roleEditor.permissions.includes(p.key)} />
                  ))}
              </FormSection>
            ))}
            <Button type="submit" disabled={pending} className="w-full">
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("saveRole")}
            </Button>
          </form>
        )}
      </Drawer>
    </div>
  );
}

function CopyBox({ value }: { value: string }) {
  const t = useTranslations("portal.appBuilder.settings.sections.team");
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-border bg-app p-2">
      <code className="min-w-0 flex-1 truncate text-[12px]">{value}</code>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? t("copyBoxCopied") : t("copyBoxCopy")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

type LocationRow = Data<"locations">["locations"][number];

const DEFAULT_HOURS: OpeningHours = { mon: { open: "09:00", close: "17:00" }, tue: { open: "09:00", close: "17:00" }, wed: { open: "09:00", close: "17:00" }, thu: { open: "09:00", close: "17:00" }, fri: { open: "09:00", close: "17:00" }, sat: null, sun: null };

export function LocationsSection({ merchantId, data, canEdit }: { merchantId: string; data: Data<"locations">; canEdit: boolean }) {
  const t = useTranslations("portal.appBuilder.settings.sections.locations");
  const router = useRouter();
  const [editing, setEditing] = React.useState<LocationRow | "new" | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>();
  const [pending, setPending] = React.useState(false);

  const current = editing && editing !== "new" ? editing : null;
  const hours: OpeningHours = current && isOpeningHours(current.openingHours) ? current.openingHours : DEFAULT_HOURS;

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const res = await saveLocationAction(merchantId, current?.id ?? null, new FormData(e.currentTarget));
    setPending(false);
    if ("error" in res) {
      setErrors(res.fieldErrors);
      return toast.error(res.error);
    }
    setEditing(null);
    toast.success(t("savedToast"));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {!canEdit && <p className="rounded-[10px] bg-app px-3 py-2 text-[12px] text-ink-muted">{t("ownerOnly")}</p>}
      <div className="flex justify-end">
        {canEdit && (
          <Button size="sm" onClick={() => { setEditing("new"); setErrors(undefined); }}>
            <Plus className="h-3.5 w-3.5" /> {t("addLocation")}
          </Button>
        )}
      </div>
      {data.locations.length === 0 ? (
        <p className="text-[12px] text-ink-muted">{t("noLocationsYet")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border">
          {data.locations.map((l) => (
            <li key={l.id}>
              <button type="button" disabled={!canEdit} onClick={() => { setEditing(l); setErrors(undefined); }} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-app disabled:hover:bg-transparent">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">{l.name}</span>
                  <span className="block truncate text-[11px] text-ink-muted">{[l.addressLine1, l.city].filter(Boolean).join(", ") || t("noAddress")}</span>
                </span>
                {l.isPrimary && <Pill tone="primary">{t("primaryPill")}</Pill>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={current ? current.name : t("newLocationTitle")}
        footer={
          <div className="flex w-full items-center justify-between">
            {current ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={async () => {
                  const res = await archiveLocationAction(merchantId, current.id);
                  if ("error" in res) return toast.error(res.error);
                  setEditing(null);
                  toast.success(t("removedToast"));
                  router.refresh();
                }}
              >
                {t("remove")}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" form="location-form" size="sm" disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("saveLocation")}
            </Button>
          </div>
        }
      >
        {editing !== null && (
          <form id="location-form" key={current?.id ?? "new"} onSubmit={save} noValidate className="space-y-5">
            <FormSection title={t("whereTitle")}>
              <TextField label={t("nameLabel")} name="name" defaultValue={str(current?.name)} errors={errors} required />
              <TextField label={t("addressLabel")} name="addressLine1" defaultValue={str(current?.addressLine1)} errors={errors} />
              <TextField label={t("addressLine2Label")} name="addressLine2" defaultValue={str(current?.addressLine2)} errors={errors} />
              <div className="grid grid-cols-2 gap-3">
                <TextField label={t("cityLabel")} name="city" defaultValue={str(current?.city)} errors={errors} />
                <TextField label={t("postalCodeLabel")} name="postalCode" defaultValue={str(current?.postalCode)} errors={errors} />
                <TextField label={t("regionLabel")} name="region" defaultValue={str(current?.region)} errors={errors} />
                <TextField label={t("countryLabel")} name="country" defaultValue={str(current?.country)} errors={errors} />
              </div>
              <TextField label={t("phoneLabel")} name="phone" type="tel" defaultValue={str(current?.phone)} errors={errors} hint={t("phoneHint")} />
              <CheckboxField name="isPrimary" label={t("isPrimaryLabel")} description={t("isPrimaryDescription")} defaultChecked={Boolean(current?.isPrimary)} />
            </FormSection>
            <FormSection title={t("openingHoursTitle")}>
              {WEEKDAYS.map((d) => (
                <DayHours key={d} day={d} value={hours[d]} error={errors?.[`${d}.open`]} />
              ))}
            </FormSection>
          </form>
        )}
      </Drawer>
    </div>
  );
}

function DayHours({ day, value, error }: { day: (typeof WEEKDAYS)[number]; value: { open: string; close: string } | null; error?: string }) {
  const t = useTranslations("portal.appBuilder.settings.sections.locations");
  const [closed, setClosed] = React.useState(value === null);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 text-[13px] font-medium">{WEEKDAY_LABEL[day]}</span>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
          <input type="checkbox" name={`${day}.closed`} checked={closed} onChange={(e) => setClosed(e.target.checked)} className="accent-[var(--primary)]" />
          {t("closedLabel")}
        </label>
        {!closed && (
          <>
            <input type="time" name={`${day}.open`} defaultValue={value?.open ?? "09:00"} aria-label={t("opensAria", { day: WEEKDAY_LABEL[day] })} aria-invalid={Boolean(error)} className="h-9 rounded-[10px] border border-border bg-surface px-2 text-[13px]" />
            <span className="text-ink-faint">–</span>
            <input type="time" name={`${day}.close`} defaultValue={value?.close ?? "17:00"} aria-label={t("closesAria", { day: WEEKDAY_LABEL[day] })} className="h-9 rounded-[10px] border border-border bg-surface px-2 text-[13px]" />
          </>
        )}
      </div>
      {error && <p className="mt-1 text-[12px] text-[var(--accent-red)]">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loyalty rules
// ---------------------------------------------------------------------------

export function LoyaltySection({ merchantId, data, canEdit, currency }: { merchantId: string; data: Data<"loyalty-rules">; canEdit: boolean; currency: string }) {
  const t = useTranslations("portal.appBuilder.settings.sections.loyalty");
  const p = data.programme;
  return (
    <SettingsForm merchantId={merchantId} save={saveLoyaltyRulesAction} canEdit={canEdit} lockedReason={t("lockedReason")}>
      {(errors) => (
        <>
          <FormSection title={t("programmeTitle")}>
            <CheckboxField name="active" label={t("activeLabel")} description={t("activeDescription")} defaultChecked={p ? p.active : true} />
          </FormSection>
          <FormSection title={t("howClientsEarnTitle")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t("pointsPerUnitLabel", { currency })} name="pointsPerUnit" inputMode="decimal" defaultValue={p ? String(Math.round(p.pointsPerCents * 100 * 100) / 100) : "1"} errors={errors} />
              <TextField label={t("pointsPerVisitLabel")} name="pointsPerVisit" type="number" min={0} defaultValue={str(p?.pointsPerVisit ?? 0)} errors={errors} hint={t("pointsPerVisitHint")} />
              <TextField label={t("referralPointsLabel")} name="referralPoints" type="number" min={0} defaultValue={str(p?.referralPoints ?? 0)} errors={errors} />
              <TextField label={t("birthdayBonusLabel")} name="birthdayPoints" type="number" min={0} defaultValue={str(p?.birthdayPoints ?? 0)} errors={errors} />
              <TextField label={t("reviewPointsLabel")} name="reviewPoints" type="number" min={0} defaultValue={str(p?.reviewPoints ?? 0)} errors={errors} />
              <TextField label={t("pointsExpiryLabel")} name="pointsExpiryDays" type="number" min={1} defaultValue={str(p?.pointsExpiryDays)} errors={errors} hint={t("pointsExpiryHint")} />
            </div>
            <TextField label={t("googleReviewUrlLabel")} name="googleReviewUrl" type="url" placeholder="https://g.page/r/…/review" defaultValue={str(data.googleReviewUrl)} errors={errors} hint={t("googleReviewUrlHint")} />
          </FormSection>
        </>
      )}
    </SettingsForm>
  );
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export function BookingSection({ merchantId, data, canEdit, currency }: { merchantId: string; data: Data<"booking">; canEdit: boolean; currency: string }) {
  const t = useTranslations("portal.appBuilder.settings.sections.booking");
  const s = data.settings;
  const [mode, setMode] = React.useState(str(s?.bookingMode) || "IN_APP");
  return (
    <SettingsForm merchantId={merchantId} save={saveBookingSettingsAction} canEdit={canEdit} lockedReason={t("lockedReason")}>
      {(errors) => (
        <>
          <FormSection title={t("whereTitle")}>
            <SelectField
              label={t("bookingModeLabel")}
              name="bookingMode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              options={[
                { value: "IN_APP", label: t("inAppOption") },
                { value: "EXTERNAL", label: t("externalOption") },
              ]}
              errors={errors}
            />
            {mode === "EXTERNAL" && <TextField label={t("externalUrlLabel")} name="externalBookingUrl" type="url" placeholder="https://" defaultValue={str(s?.externalBookingUrl)} errors={errors} required />}
          </FormSection>
          <FormSection title={t("rulesTitle")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t("cancellationHoursLabel")} name="appointmentCancellationHours" type="number" min={0} defaultValue={str(s?.appointmentCancellationHours ?? 24)} errors={errors} hint={t("cancellationHoursHint")} />
              <TextField label={t("reminderHoursLabel")} name="appointmentReminderHours" type="number" min={0} defaultValue={str(s?.appointmentReminderHours ?? 24)} errors={errors} />
            </div>
          </FormSection>
          <FormSection title={t("depositTitle")}>
            <p className="text-[12px] text-ink-muted">
              {t("depositDescription")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label={t("depositPercentLabel")}
                name="bookingDepositPercent"
                type="number"
                min={0}
                max={100}
                defaultValue={str(s?.bookingDepositPercent ?? 0)}
                errors={errors}
              />
              <MoneyField
                label={t("depositFixedLabel")}
                name="bookingDeposit"
                currency={currency}
                defaultValue={centsToInput(s?.bookingDepositFixedCents ?? 0)}
                errors={errors}
                hint={t("depositFixedHint")}
              />
            </div>
          </FormSection>
        </>
      )}
    </SettingsForm>
  );
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function NotificationsSection({ merchantId, data, canEdit }: { merchantId: string; data: Data<"notifications">; canEdit: boolean }) {
  const t = useTranslations("portal.appBuilder.settings.sections.notifications");
  const s = data.settings;
  const on = (v: boolean | undefined) => v ?? true;
  return (
    <>
      {canEdit && (
        <BroadcastForm merchantId={merchantId} devices={data.subscribedDevices} products={data.products} campaigns={data.campaigns} />
      )}
      <SettingsForm merchantId={merchantId} save={saveNotificationSettingsAction} canEdit={canEdit}>
        {() => (
          <FormSection title={t("sendWhenTitle")}>
            <p className="text-[12px] text-ink-muted">{t("respectedHint")}</p>
            <CheckboxField name="notifyBookingConfirmations" label={t("bookingLabel")} defaultChecked={on(s?.notifyBookingConfirmations)} />
            <CheckboxField name="notifyAppointmentReminders" label={t("reminderLabel")} defaultChecked={on(s?.notifyAppointmentReminders)} />
            <CheckboxField name="notifyPointsEarned" label={t("pointsLabel")} defaultChecked={on(s?.notifyPointsEarned)} />
            <CheckboxField name="notifyMembershipBilling" label={t("membershipLabel")} defaultChecked={on(s?.notifyMembershipBilling)} />
          </FormSection>
        )}
      </SettingsForm>
      <SettingsForm merchantId={merchantId} save={saveNotificationSettingsAction} canEdit={canEdit}>
        {(errors) => (
          <FormSection title={t("marketingWindowTitle")}>
            <p className="text-[12px] text-ink-muted">
              {t("marketingWindowDescription")}
            </p>
            <SendingWindowFields
              startMinutes={s?.marketingWindowStartMinutes ?? DEFAULT_WINDOW_START}
              endMinutes={s?.marketingWindowEndMinutes ?? DEFAULT_WINDOW_END}
              errors={errors}
            />
            <DailyLimitField defaultValue={s?.marketingDailyLimit ?? 1} errors={errors} />
          </FormSection>
        )}
      </SettingsForm>
      <SettingsForm merchantId={merchantId} save={saveNotificationSettingsAction} canEdit={canEdit}>
        {(errors) => (
          <FormSection title={t("birthdaysTitle")}>
            <p className="text-[12px] text-ink-muted">
              {t("birthdaysDescription")}
            </p>
            <CheckboxField name="birthdayMessageEnabled" label={t("birthdayEnabledLabel")} defaultChecked={s?.birthdayMessageEnabled ?? false} />
            <TextAreaField
              label={t("messageLabel")}
              name="birthdayMessage"
              rows={2}
              maxLength={200}
              defaultValue={s?.birthdayMessage ?? ""}
              placeholder={t("messagePlaceholder")}
              errors={errors}
            />
            <TextField
              label={t("discountPercentLabel")}
              name="birthdayDiscountPercent"
              type="number"
              min={0}
              max={100}
              defaultValue={String(s?.birthdayDiscountPercent ?? 0)}
              hint={t("discountPercentHint")}
              errors={errors}
            />
            <TextField
              label={t("validDaysLabel")}
              name="birthdayDiscountDays"
              type="number"
              min={1}
              max={365}
              defaultValue={String(s?.birthdayDiscountDays ?? 14)}
              errors={errors}
            />
          </FormSection>
        )}
      </SettingsForm>
    </>
  );
}

// ---------------------------------------------------------------------------
// Integrations (read-only until payments are connected per clinic)
// ---------------------------------------------------------------------------

function stripeNotices(t: ReturnType<typeof useTranslations>): Record<string, { tone: "info" | "warn"; text: string }> {
  return {
    returned: { tone: "info", text: t("notices.returned") },
    "not-configured": { tone: "warn", text: t("notices.notConfigured") },
    "owner-only": { tone: "warn", text: t("notices.ownerOnly") },
    "no-country": { tone: "warn", text: t("notices.noCountry") },
    "country-changed": { tone: "warn", text: t("notices.countryChanged") },
    "not-confirmed": { tone: "warn", text: t("notices.notConfirmed") },
    failed: { tone: "warn", text: t("notices.failed") },
  };
}

function stripeStatusMap(
  t: ReturnType<typeof useTranslations>,
): Record<Data<"integrations">["stripe"]["status"], { label: string; tone: "green" | "amber" | "neutral" | "red"; detail: string }> {
  return {
    NOT_CONNECTED: { label: t("status.notConnectedLabel"), tone: "neutral", detail: t("status.notConnectedDetail") },
    ONBOARDING: { label: t("status.onboardingLabel"), tone: "amber", detail: t("status.onboardingDetail") },
    PENDING_VERIFICATION: { label: t("status.pendingLabel"), tone: "amber", detail: t("status.pendingDetail") },
    ACTIVE: { label: t("status.activeLabel"), tone: "green", detail: t("status.activeDetail") },
    RESTRICTED: { label: t("status.restrictedLabel"), tone: "red", detail: t("status.restrictedDetail") },
  };
}

function StripeConnectCard({ merchantId, stripe, isOwner }: { merchantId: string; stripe: Data<"integrations">["stripe"]; isOwner: boolean }) {
  const t = useTranslations("portal.appBuilder.settings.sections.integrations");
  const tc = useTranslations("common");
  const [confirming, setConfirming] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const status = stripeStatusMap(t)[stripe.status];
  const base = `/m/${encodeURIComponent(merchantId)}/stripe`;

  return (
    <div className="rounded-card border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold">{t("stripeTitle")}</p>
          <p className="mt-0.5 text-[12px] text-ink-muted">{status.detail}</p>
        </div>
        <Pill tone={status.tone}>{status.label}</Pill>
      </div>

      {stripe.connected && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div>
            <dt className="text-ink-muted">{t("cardPaymentsLabel")}</dt>
            <dd className="font-medium">{stripe.chargesEnabled ? t("enabled") : t("notYet")}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">{t("payoutsLabel")}</dt>
            <dd className="font-medium">{stripe.payoutsEnabled ? t("enabled") : t("notYet")}</dd>
          </div>
          {stripe.accountCountry && (
            <div>
              <dt className="text-ink-muted">{t("accountCountryLabel")}</dt>
              <dd className="font-medium">{stripe.accountCountry}</dd>
            </div>
          )}
          {stripe.checkedAt && (
            <div>
              <dt className="text-ink-muted">{t("lastCheckedLabel")}</dt>
              <dd className="font-medium">{new Date(stripe.checkedAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="mt-4 space-y-3">
        {!stripe.configured ? (
          <p className="rounded-[10px] bg-app px-3 py-2 text-[12px] text-ink-muted">{t("notConfiguredBody")}</p>
        ) : !isOwner ? (
          <p className="rounded-[10px] bg-app px-3 py-2 text-[12px] text-ink-muted">{t("ownerOnlyBody")}</p>
        ) : stripe.status === "NOT_CONNECTED" ? (
          !stripe.countryCode ? (
            <p className="rounded-[10px] bg-[var(--accent-amber)]/10 px-3 py-2 text-[12px] text-ink">
              {stripe.addressCountry ? t("unknownCountry", { country: stripe.addressCountry }) : t("noCountryBody")}{" "}
              {t("setCountryPrefix")}{" "}
              <a className="font-medium underline" href={`/m/${encodeURIComponent(merchantId)}/app-builder?tab=settings&section=branding`}>
                {t("settingsBrandingLink")}
              </a>{" "}
              {t("setCountrySuffix")}
            </p>
          ) : !confirming ? (
            <Button type="button" onClick={() => setConfirming(true)}>
              {t("connectStripe")}
            </Button>
          ) : (
            <form method="post" action={`${base}/connect`} onSubmit={() => setSubmitting(true)} className="space-y-3 rounded-[10px] border border-border p-3">
              <input type="hidden" name="country" value={stripe.countryCode} />
              <p className="text-[13px]">
                {t.rich("countryConfirmText", { country: stripe.countryLabel ?? "", strong: (chunks) => <strong>{chunks}</strong> })}
              </p>
              <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                <input type="checkbox" name="confirmed" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
                <span>{t("confirmCountryLabel", { country: stripe.countryLabel ?? "" })}</span>
              </label>
              <p className="text-[12px] text-ink-muted">
                {t("wrongCountryPrefix")}{" "}
                <a className="underline" href={`/m/${encodeURIComponent(merchantId)}/app-builder?tab=settings&section=branding`}>
                  {t("settingsBrandingLink")}
                </a>{" "}
                {t("wrongCountrySuffix")}
              </p>
              <div className="flex gap-2">
                <Button type="submit" disabled={!confirmed || submitting}>
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t("continueToStripe")}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={submitting}>
                  {tc("cancel")}
                </Button>
              </div>
            </form>
          )
        ) : stripe.status === "ONBOARDING" ? (
          <form method="post" action={`${base}/connect`} onSubmit={() => setSubmitting(true)}>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("continueSetup")}
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <a
              href={`${base}/return`}
              className="inline-flex h-9 items-center rounded-pill border border-border bg-surface px-4 text-[13px] font-medium text-ink hover:bg-app"
            >
              {t("checkStatusNow")}
            </a>
            <a
              href="https://dashboard.stripe.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-pill border border-border bg-surface px-4 text-[13px] font-medium text-ink hover:bg-app"
            >
              {t("openDashboard")}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function IntegrationsSection({
  merchantId,
  data,
  isOwner,
  notice,
}: {
  merchantId: string;
  data: Data<"integrations">;
  isOwner: boolean;
  notice: string | null;
}) {
  const t = useTranslations("portal.appBuilder.settings.sections.integrations");
  const shownNotice = notice ? stripeNotices(t)[notice] : undefined;
  const rows = [
    {
      name: t("emailRowName"),
      state: data.email === "resend" ? t("connected") : t("notSetUp"),
      tone: data.email === "resend" ? ("green" as const) : ("amber" as const),
      detail: data.email === "resend" ? t("emailDetailConnected") : t("emailDetailNotConnected"),
    },
    {
      name: t("pushRowName"),
      state: data.push === "webpush" ? t("connected") : t("notSetUp"),
      tone: data.push === "webpush" ? ("green" as const) : ("neutral" as const),
      detail: t("pushDetail"),
    },
  ];
  return (
    <div className="space-y-4">
      {shownNotice && (
        <p
          role="status"
          className={`rounded-[10px] px-3 py-2 text-[12px] text-ink ${shownNotice.tone === "warn" ? "bg-[var(--accent-amber)]/10" : "bg-primary-soft"}`}
        >
          {shownNotice.text}
        </p>
      )}
      <StripeConnectCard merchantId={merchantId} stripe={data.stripe} isOwner={isOwner} />
      {data.payments !== "stripe" && (
        <p className="text-[12px] text-ink-muted">{t("testModeNotice")}</p>
      )}
      <div>
        <p className="mb-2 text-[12px] text-ink-muted">{t("platformConfiguredNotice")}</p>
        <ul className="divide-y divide-border rounded-card border border-border">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-[13px] font-semibold">{r.name}</p>
                <p className="text-[11px] text-ink-muted">{r.detail}</p>
              </div>
              <Pill tone={r.tone}>{r.state}</Pill>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export function AuditLogSection({ data }: { data: Data<"audit-log"> }) {
  const t = useTranslations("portal.appBuilder.settings.sections.auditLog");
  if (data.rows.length === 0) return <p className="text-[12px] text-ink-muted">{t("empty")}</p>;
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full text-left text-[12px]">
        <thead className="border-b border-border bg-app text-[11px] uppercase tracking-wide text-ink-faint">
          <tr>
            <th className="px-3 py-2 font-medium">{t("whenHeader")}</th>
            <th className="px-3 py-2 font-medium">{t("whoHeader")}</th>
            <th className="px-3 py-2 font-medium">{t("whatHeader")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{new Date(r.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
              <td className="px-3 py-2">
                {r.actorUser?.email ?? (r.actorType === "SYSTEM" ? t("systemActor") : "—")}
                {r.actorType === "PLATFORM_ADMIN" && <span className="ml-1 text-ink-faint">{t("agencySuffix")}</span>}
              </td>
              <td className="px-3 py-2">
                <span className="font-medium">{r.action.replace(/[._]/g, " ")}</span>
                {r.reason && <span className="text-ink-muted"> — {r.reason}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
