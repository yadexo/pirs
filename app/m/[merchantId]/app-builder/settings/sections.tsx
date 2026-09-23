"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, Pill } from "@/components/ui/primitives";
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
  lockedReason = "Only the clinic owner can change these settings.",
  children,
}: {
  merchantId: string;
  save: SaveFn;
  canEdit: boolean;
  lockedReason?: string;
  children: (errors: FieldErrors) => React.ReactNode;
}) {
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
    toast.success("Saved");
    router.refresh();
  }

  return (
    <form ref={ref} onSubmit={onSubmit} noValidate className="space-y-6">
      {!canEdit && <p className="rounded-[10px] bg-app px-3 py-2 text-[12px] text-ink-muted">{lockedReason}</p>}
      <fieldset disabled={!canEdit || pending} className="space-y-6">
        {children(errors)}
      </fieldset>
      {canEdit && (
        <div className="flex justify-end border-t border-border pt-4">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save changes
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
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it instead.");
    }
  }
  return (
    <FormSection title="Your app link">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Generated on the server from our own URL — not user-supplied markup. */}
        <div className="h-36 w-36 shrink-0 rounded-[10px] border border-border bg-surface p-1" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <div className="min-w-0 space-y-3">
          <p className="text-[13px] text-ink-muted">Clients scan this code or open the link to get your app, then add it to their home screen with your icon.</p>
          <p className="truncate rounded-[8px] bg-app px-3 py-2 font-mono text-[12px] text-ink" title={url}>{url}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <a
              href={`/m/${merchantId}/app-qr`}
              download
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-pill border border-border bg-surface px-4 text-[13px] font-medium text-ink transition-colors hover:bg-app"
            >
              <Download className="h-3.5 w-3.5" /> Download QR (PNG)
            </a>
          </div>
        </div>
      </div>
    </FormSection>
  );
}

export function GeneralSection({ merchantId, data, canEdit }: { merchantId: string; data: Data<"general">; canEdit: boolean }) {
  const s = data.settings;
  const b = data.branding;
  return (
    <div className="space-y-8">
    <AppLinkCard merchantId={merchantId} url={data.appLink.url} qrSvg={data.appLink.qrSvg} />
    <SettingsForm merchantId={merchantId} save={saveGeneralSettingsAction} canEdit={canEdit}>
      {(errors) => (
        <>
          <FormSection title="The client app">
            <CheckboxField
              name="publiclyListed"
              label="List this clinic in the app's clinic search"
              description="Clients can find you by name. Anyone with your QR code or link can always open your app."
              defaultChecked={s ? s.publiclyListed : true}
            />
            <CheckboxField
              name="payLaterEnabled"
              label="Show pay-later"
              description="Adds the 'Treat today, pay later' row to Home and Shop."
              defaultChecked={Boolean(s?.payLaterEnabled)}
            />
          </FormSection>
          <FormSection title="Shop banner">
            <TextField label="Headline" name="shopBannerHeadline" defaultValue={str(s?.shopBannerHeadline)} placeholder="Treat today. Pay later. Earn rewards." maxLength={80} errors={errors} />
            <TextField label="Subtitle" name="shopBannerSubtitle" defaultValue={str(s?.shopBannerSubtitle)} placeholder="Free treatments & exclusive perks." maxLength={120} errors={errors} />
            <TextField label="Button label" name="shopBannerButtonLabel" defaultValue={str(s?.shopBannerButtonLabel)} placeholder="How does it work?" maxLength={30} errors={errors} hint="Leave any field empty to use the default shown." />
          </FormSection>
          <FormSection title="Money">
            <TextField
              label="Tax rate (%)"
              name="taxRatePercent"
              inputMode="decimal"
              defaultValue={s ? String(s.taxRateBasisPoints / 100) : "0"}
              errors={errors}
              hint="Added at checkout to taxable items."
              className="max-w-[180px]"
            />
          </FormSection>
          <FormSection title="Policies shown to clients">
            <TextAreaField label="Terms" name="termsContent" rows={5} defaultValue={str(b?.termsContent)} errors={errors} />
            <TextAreaField label="Privacy" name="privacyContent" rows={5} defaultValue={str(b?.privacyContent)} errors={errors} />
            <TextAreaField label="Cancellation policy" name="cancellationPolicy" rows={3} defaultValue={str(b?.cancellationPolicy)} errors={errors} />
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

export function BrandingSection({ merchantId, data, canEdit }: { merchantId: string; data: Data<"branding">; canEdit: boolean }) {
  const b = data.branding;
  const [color, setColor] = React.useState(str(b?.primaryColor) || "#0f766e");
  const [name, setName] = React.useState(str(b?.businessName));
  const { currencies, timeZones } = data;

  return (
    <SettingsForm merchantId={merchantId} save={saveBrandingAction} canEdit={canEdit}>
      {(errors) => (
        <>
          <FormSection title="Identity">
            <TextField label="Clinic name" name="businessName" value={name} onChange={(e) => setName(e.target.value)} errors={errors} required maxLength={120} />
            <div className="grid gap-4 sm:grid-cols-2">
              <ImageField label="Logo" name="logoUrl" merchantId={merchantId} defaultValue={b?.logoUrl} errors={errors} hint="Shown at the top of the app's Home." />
              <ImageField
                label="App icon"
                name="appIconUrl"
                merchantId={merchantId}
                purpose="app-icon"
                defaultValue={b?.appIconUrl}
                errors={errors}
                hint="Square, at least 512×512 (1024×1024 is best). Becomes the icon when clients add your app to their home screen."
              />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label htmlFor="primaryColor" className="mb-1.5 block text-[12px] font-medium">
                  Brand colour
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
                    aria-label="Brand colour hex"
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
                <span className="text-[12px] font-medium">{name || "Clinic name"}</span>
                <span className="rounded-pill px-3 py-1 text-[11px] font-semibold text-white" style={{ background: color }}>
                  Book
                </span>
              </div>
            </div>
          </FormSection>
          <FormSection title="Contact">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Email" name="contactEmail" type="email" defaultValue={str(b?.contactEmail)} errors={errors} />
              <TextField label="Phone" name="contactPhone" type="tel" defaultValue={str(b?.contactPhone)} errors={errors} />
            </div>
            <TextField label="Website" name="website" type="url" placeholder="https://" defaultValue={str(b?.website)} errors={errors} />
            <TextField label="Address" name="addressLine1" defaultValue={str(b?.addressLine1)} errors={errors} />
            <TextField label="Address line 2" name="addressLine2" defaultValue={str(b?.addressLine2)} errors={errors} />
            <div className="grid gap-3 sm:grid-cols-4">
              <TextField label="City" name="city" defaultValue={str(b?.city)} errors={errors} className="sm:col-span-2" />
              <TextField label="Postcode" name="postalCode" defaultValue={str(b?.postalCode)} errors={errors} />
              <TextField label="Country" name="country" defaultValue={str(b?.country)} errors={errors} />
            </div>
          </FormSection>
          <FormSection title="Region">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Currency"
                name="currency"
                defaultValue={str(b?.currency) || "EUR"}
                options={currencies.map((c) => ({ value: c, label: c }))}
                errors={errors}
                disabled={data.currencyLocked}
                hint={data.currencyLocked ? "Locked: this clinic has already taken payments." : undefined}
              />
              {data.currencyLocked && <input type="hidden" name="currency" value={str(b?.currency)} />}
              <SelectField label="Time zone" name="timeZone" defaultValue={str(b?.timeZone) || "Europe/Amsterdam"} options={timeZones.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))} errors={errors} />
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
    toast.success("Role saved");
    router.refresh();
  }

  const categories = [...new Set(data.allPermissions.map((p) => p.category))];

  return (
    <div className="space-y-8">
      {!canEdit && <p className="rounded-[10px] bg-app px-3 py-2 text-[12px] text-ink-muted">Only the clinic owner can manage the team.</p>}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">People</h3>
          {canEdit && (
            <Button size="sm" onClick={() => { setInviting(true); setInviteLink(null); setErrors(undefined); }}>
              <Plus className="h-3.5 w-3.5" /> Invite staff
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
                    <Pill tone="primary">Owner</Pill>
                  ) : (
                    <>
                      {u.status === "INVITED" && <Pill tone="amber">Invited</Pill>}
                      {p && !p.active && <Pill tone="neutral">Deactivated</Pill>}
                      {p && (
                        <select
                          aria-label={`Role for ${p.firstName}`}
                          defaultValue={p.roleId ?? ""}
                          disabled={!canEdit}
                          onChange={(e) => run(setStaffRoleAction(merchantId, p.id, e.target.value || null), "Role updated")}
                          className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px]"
                        >
                          <option value="">No role (no access)</option>
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
                          Resend invite
                        </Button>
                      )}
                      {canEdit && p && u.status !== "INVITED" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => run(setStaffActiveAction(merchantId, p.id, !p.active), p.active ? "Access removed" : "Access restored")}
                        >
                          {p.active ? "Deactivate" : "Reactivate"}
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
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Roles</h3>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => { setRoleEditor({ id: null, name: "", permissions: [] }); setErrors(undefined); }}>
              <Plus className="h-3.5 w-3.5" /> New role
            </Button>
          )}
        </div>
        {data.roles.length === 0 ? (
          <p className="text-[12px] text-ink-muted">No roles yet. A staff member without a role can sign in but do nothing.</p>
        ) : (
          <ul className="divide-y divide-border rounded-card border border-border">
            {data.roles.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{r.name}</p>
                  <p className="truncate text-[11px] text-ink-muted">
                    {r.permissions.length ? r.permissions.map((k) => data.allPermissions.find((p) => p.key === k)?.label ?? k).join(", ") : "No permissions"} ·{" "}
                    {r.members} {r.members === 1 ? "person" : "people"}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setRoleEditor({ id: r.id, name: r.name, permissions: r.permissions }); setErrors(undefined); }}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => run(deleteRoleAction(merchantId, r.id), "Role deleted")}>
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Drawer open={inviting} onClose={() => setInviting(false)} title={inviteLink ? "Invitation ready" : "Invite staff"}>
        {inviteLink ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-muted">
              {inviteLink.emailed
                ? "We've emailed them a link to set their password. You can also send this link yourself:"
                : "Email isn't set up yet, so send them this link yourself:"}
            </p>
            <CopyBox value={inviteLink.link} />
            <p className="text-[12px] text-ink-muted">It works once and expires in 7 days.</p>
            <Button onClick={() => setInviting(false)} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={invite} noValidate className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <TextField label="First name" name="firstName" errors={errors} required />
              <TextField label="Last name" name="lastName" errors={errors} required />
            </div>
            <TextField label="Email" name="email" type="email" errors={errors} required />
            <TextField label="Job title" name="title" errors={errors} hint="Optional, e.g. Physiotherapist." />
            <SelectField label="Role" name="roleId" errors={errors} options={[{ value: "", label: "No role yet" }, ...data.roles.map((r) => ({ value: r.id, label: r.name }))]} />
            <Button type="submit" disabled={pending} className="w-full">
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Send invitation
            </Button>
          </form>
        )}
      </Drawer>

      <Drawer open={roleEditor !== null} onClose={() => setRoleEditor(null)} title={roleEditor?.id ? "Edit role" : "New role"}>
        {roleEditor && (
          <form onSubmit={saveRole} noValidate className="space-y-4">
            <TextField label="Role name" name="name" defaultValue={roleEditor.name} errors={errors} required />
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
              Save role
            </Button>
          </form>
        )}
      </Drawer>
    </div>
  );
}

function CopyBox({ value }: { value: string }) {
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
        {copied ? "Copied" : "Copy"}
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
    toast.success("Location saved");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {!canEdit && <p className="rounded-[10px] bg-app px-3 py-2 text-[12px] text-ink-muted">Only the clinic owner can change locations.</p>}
      <div className="flex justify-end">
        {canEdit && (
          <Button size="sm" onClick={() => { setEditing("new"); setErrors(undefined); }}>
            <Plus className="h-3.5 w-3.5" /> Add location
          </Button>
        )}
      </div>
      {data.locations.length === 0 ? (
        <p className="text-[12px] text-ink-muted">No locations yet. Clients see your address and opening hours from here.</p>
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border">
          {data.locations.map((l) => (
            <li key={l.id}>
              <button type="button" disabled={!canEdit} onClick={() => { setEditing(l); setErrors(undefined); }} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-app disabled:hover:bg-transparent">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">{l.name}</span>
                  <span className="block truncate text-[11px] text-ink-muted">{[l.addressLine1, l.city].filter(Boolean).join(", ") || "No address"}</span>
                </span>
                {l.isPrimary && <Pill tone="primary">Primary</Pill>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={current ? current.name : "New location"}
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
                  toast.success("Location removed");
                  router.refresh();
                }}
              >
                Remove
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" form="location-form" size="sm" disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save location
            </Button>
          </div>
        }
      >
        {editing !== null && (
          <form id="location-form" key={current?.id ?? "new"} onSubmit={save} noValidate className="space-y-5">
            <FormSection title="Where">
              <TextField label="Name" name="name" defaultValue={str(current?.name)} errors={errors} required />
              <TextField label="Address" name="addressLine1" defaultValue={str(current?.addressLine1)} errors={errors} />
              <TextField label="Address line 2" name="addressLine2" defaultValue={str(current?.addressLine2)} errors={errors} />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="City" name="city" defaultValue={str(current?.city)} errors={errors} />
                <TextField label="Postcode" name="postalCode" defaultValue={str(current?.postalCode)} errors={errors} />
                <TextField label="Region" name="region" defaultValue={str(current?.region)} errors={errors} />
                <TextField label="Country" name="country" defaultValue={str(current?.country)} errors={errors} />
              </div>
              <TextField label="Phone" name="phone" type="tel" defaultValue={str(current?.phone)} errors={errors} hint="The app's 'Call now' button dials this." />
              <CheckboxField name="isPrimary" label="Primary location" description="Shown first in the client app." defaultChecked={Boolean(current?.isPrimary)} />
            </FormSection>
            <FormSection title="Opening hours">
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
  const [closed, setClosed] = React.useState(value === null);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 text-[13px] font-medium">{WEEKDAY_LABEL[day]}</span>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
          <input type="checkbox" name={`${day}.closed`} checked={closed} onChange={(e) => setClosed(e.target.checked)} className="accent-[var(--primary)]" />
          Closed
        </label>
        {!closed && (
          <>
            <input type="time" name={`${day}.open`} defaultValue={value?.open ?? "09:00"} aria-label={`${WEEKDAY_LABEL[day]} opens`} aria-invalid={Boolean(error)} className="h-9 rounded-[10px] border border-border bg-surface px-2 text-[13px]" />
            <span className="text-ink-faint">–</span>
            <input type="time" name={`${day}.close`} defaultValue={value?.close ?? "17:00"} aria-label={`${WEEKDAY_LABEL[day]} closes`} className="h-9 rounded-[10px] border border-border bg-surface px-2 text-[13px]" />
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
  const p = data.programme;
  return (
    <SettingsForm merchantId={merchantId} save={saveLoyaltyRulesAction} canEdit={canEdit} lockedReason="You need the 'Adjust loyalty points' permission to change these.">
      {(errors) => (
        <>
          <FormSection title="Programme">
            <CheckboxField name="active" label="Loyalty programme on" description="Clients earn and redeem points." defaultChecked={p ? p.active : true} />
          </FormSection>
          <FormSection title="How clients earn">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={`Points per ${currency} 1 spent`} name="pointsPerUnit" inputMode="decimal" defaultValue={p ? String(Math.round(p.pointsPerCents * 100 * 100) / 100) : "1"} errors={errors} />
              <TextField label="Points per clinic visit" name="pointsPerVisit" type="number" min={0} defaultValue={str(p?.pointsPerVisit ?? 0)} errors={errors} hint="Awarded when the clinic scans their code." />
              <TextField label="Points for referring a friend" name="referralPoints" type="number" min={0} defaultValue={str(p?.referralPoints ?? 0)} errors={errors} />
              <TextField label="Birthday bonus" name="birthdayPoints" type="number" min={0} defaultValue={str(p?.birthdayPoints ?? 0)} errors={errors} />
              <TextField label="Points for a Google review" name="reviewPoints" type="number" min={0} defaultValue={str(p?.reviewPoints ?? 0)} errors={errors} />
              <TextField label="Points expire after (days)" name="pointsExpiryDays" type="number" min={1} defaultValue={str(p?.pointsExpiryDays)} errors={errors} hint="Empty = never." />
            </div>
            <TextField label="Google review link" name="googleReviewUrl" type="url" placeholder="https://g.page/r/…/review" defaultValue={str(data.googleReviewUrl)} errors={errors} hint="Rows worth 0 points are hidden from the app." />
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
  const s = data.settings;
  const [mode, setMode] = React.useState(str(s?.bookingMode) || "IN_APP");
  return (
    <SettingsForm merchantId={merchantId} save={saveBookingSettingsAction} canEdit={canEdit} lockedReason="You need the 'Manage appointments' permission to change these.">
      {(errors) => (
        <>
          <FormSection title="Where clients book">
            <SelectField
              label="Booking"
              name="bookingMode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              options={[
                { value: "IN_APP", label: "In the app, from staff availability" },
                { value: "EXTERNAL", label: "On our own booking website" },
              ]}
              errors={errors}
            />
            {mode === "EXTERNAL" && <TextField label="Booking link" name="externalBookingUrl" type="url" placeholder="https://" defaultValue={str(s?.externalBookingUrl)} errors={errors} required />}
          </FormSection>
          <FormSection title="Rules">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Cancellation notice (hours)" name="appointmentCancellationHours" type="number" min={0} defaultValue={str(s?.appointmentCancellationHours ?? 24)} errors={errors} hint="Clients can't cancel in the app later than this." />
              <TextField label="Reminder before (hours)" name="appointmentReminderHours" type="number" min={0} defaultValue={str(s?.appointmentReminderHours ?? 24)} errors={errors} />
            </div>
          </FormSection>
          <FormSection title="Deposit">
            <p className="text-[12px] text-ink-muted">
              Leave both at zero and booking stays free: clients pay at the clinic. With a deposit set, the appointment is held as requested until the client pays
              it. Deposits need Stripe connected and active.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Deposit (% of the treatment price)"
                name="bookingDepositPercent"
                type="number"
                min={0}
                max={100}
                defaultValue={str(s?.bookingDepositPercent ?? 0)}
                errors={errors}
              />
              <MoneyField
                label="Or a fixed deposit"
                name="bookingDeposit"
                currency={currency}
                defaultValue={centsToInput(s?.bookingDepositFixedCents ?? 0)}
                errors={errors}
                hint="A fixed amount wins over the percentage."
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
  const s = data.settings;
  const on = (v: boolean | undefined) => v ?? true;
  return (
    <SettingsForm merchantId={merchantId} save={saveNotificationSettingsAction} canEdit={canEdit}>
      {() => (
        <FormSection title="Send clients a message when">
          <p className="text-[12px] text-ink-muted">Each client&apos;s own notification preferences are always respected.</p>
          <CheckboxField name="notifyBookingConfirmations" label="A booking is confirmed, changed or cancelled" defaultChecked={on(s?.notifyBookingConfirmations)} />
          <CheckboxField name="notifyAppointmentReminders" label="An appointment is coming up" defaultChecked={on(s?.notifyAppointmentReminders)} />
          <CheckboxField name="notifyPointsEarned" label="They earn points or unlock a reward" defaultChecked={on(s?.notifyPointsEarned)} />
          <CheckboxField name="notifyMembershipBilling" label="A membership renews or a payment fails" defaultChecked={on(s?.notifyMembershipBilling)} />
        </FormSection>
      )}
    </SettingsForm>
  );
}

// ---------------------------------------------------------------------------
// Integrations (read-only until payments are connected per clinic)
// ---------------------------------------------------------------------------

const STRIPE_NOTICES: Record<string, { tone: "info" | "warn"; text: string }> = {
  returned: { tone: "info", text: "Welcome back from Stripe. The status below is what Stripe reports right now." },
  "not-configured": { tone: "warn", text: "Stripe isn't set up on this platform yet, so accounts can't be connected. Contact support." },
  "owner-only": { tone: "warn", text: "Only the clinic owner can connect or manage Stripe." },
  "no-country": { tone: "warn", text: "Add your clinic's country to its address (Settings → Branding) before connecting Stripe." },
  "country-changed": { tone: "warn", text: "Your clinic's country changed since this page loaded. Check it below and confirm again." },
  "not-confirmed": { tone: "warn", text: "Confirm the country below before continuing to Stripe." },
  failed: { tone: "warn", text: "Stripe couldn't be reached or refused the request. Try again in a moment." },
};

const STRIPE_STATUS: Record<
  Data<"integrations">["stripe"]["status"],
  { label: string; tone: "green" | "amber" | "neutral" | "red"; detail: string }
> = {
  NOT_CONNECTED: { label: "Not connected", tone: "neutral", detail: "Connect your own Stripe account so clients' payments go straight to you." },
  ONBOARDING: { label: "Setup not finished", tone: "amber", detail: "Your Stripe account exists, but Stripe still needs details from you." },
  PENDING_VERIFICATION: {
    label: "Pending verification",
    tone: "amber",
    detail: "You've sent your details to Stripe. It is still verifying them, and payments stay off until Stripe approves the account.",
  },
  ACTIVE: { label: "Connected", tone: "green", detail: "Stripe has enabled card payments on your account." },
  RESTRICTED: { label: "Action needed", tone: "red", detail: "Stripe has paused payments on your account until you provide more information." },
};

function StripeConnectCard({ merchantId, stripe, isOwner }: { merchantId: string; stripe: Data<"integrations">["stripe"]; isOwner: boolean }) {
  const [confirming, setConfirming] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const status = STRIPE_STATUS[stripe.status];
  const base = `/m/${encodeURIComponent(merchantId)}/stripe`;

  return (
    <div className="rounded-card border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold">Stripe payments</p>
          <p className="mt-0.5 text-[12px] text-ink-muted">{status.detail}</p>
        </div>
        <Pill tone={status.tone}>{status.label}</Pill>
      </div>

      {stripe.connected && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div>
            <dt className="text-ink-muted">Card payments</dt>
            <dd className="font-medium">{stripe.chargesEnabled ? "Enabled" : "Not yet"}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Payouts to your bank</dt>
            <dd className="font-medium">{stripe.payoutsEnabled ? "Enabled" : "Not yet"}</dd>
          </div>
          {stripe.accountCountry && (
            <div>
              <dt className="text-ink-muted">Account country</dt>
              <dd className="font-medium">{stripe.accountCountry}</dd>
            </div>
          )}
          {stripe.checkedAt && (
            <div>
              <dt className="text-ink-muted">Last checked with Stripe</dt>
              <dd className="font-medium">{new Date(stripe.checkedAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="mt-4 space-y-3">
        {!stripe.configured ? (
          <p className="rounded-[10px] bg-app px-3 py-2 text-[12px] text-ink-muted">Stripe isn&apos;t set up on this platform yet. Contact support.</p>
        ) : !isOwner ? (
          <p className="rounded-[10px] bg-app px-3 py-2 text-[12px] text-ink-muted">Only the clinic owner can connect or manage Stripe.</p>
        ) : stripe.status === "NOT_CONNECTED" ? (
          !stripe.countryCode ? (
            <p className="rounded-[10px] bg-[var(--accent-amber)]/10 px-3 py-2 text-[12px] text-ink">
              {stripe.addressCountry
                ? `We can't tell which country "${stripe.addressCountry}" is. `
                : "Your clinic's address has no country yet. "}
              Set it under{" "}
              <a className="font-medium underline" href={`/m/${encodeURIComponent(merchantId)}/app-builder?tab=settings&section=branding`}>
                Settings → Branding
              </a>{" "}
              first — your Stripe account is created in that country.
            </p>
          ) : !confirming ? (
            <Button type="button" onClick={() => setConfirming(true)}>
              Connect Stripe
            </Button>
          ) : (
            <form method="post" action={`${base}/connect`} onSubmit={() => setSubmitting(true)} className="space-y-3 rounded-[10px] border border-border p-3">
              <input type="hidden" name="country" value={stripe.countryCode} />
              <p className="text-[13px]">
                Your Stripe account will be created in <strong>{stripe.countryLabel}</strong>, taken from your clinic&apos;s address. Stripe
                doesn&apos;t allow changing the country afterwards.
              </p>
              <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                <input type="checkbox" name="confirmed" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
                <span>Yes, my business is based in {stripe.countryLabel}.</span>
              </label>
              <p className="text-[12px] text-ink-muted">
                Wrong country? Correct your address under{" "}
                <a className="underline" href={`/m/${encodeURIComponent(merchantId)}/app-builder?tab=settings&section=branding`}>
                  Settings → Branding
                </a>{" "}
                first.
              </p>
              <div className="flex gap-2">
                <Button type="submit" disabled={!confirmed || submitting}>
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Continue to Stripe
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={submitting}>
                  Cancel
                </Button>
              </div>
            </form>
          )
        ) : stripe.status === "ONBOARDING" ? (
          <form method="post" action={`${base}/connect`} onSubmit={() => setSubmitting(true)}>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Continue setup on Stripe
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <a
              href={`${base}/return`}
              className="inline-flex h-9 items-center rounded-pill border border-border bg-surface px-4 text-[13px] font-medium text-ink hover:bg-app"
            >
              Check status now
            </a>
            <a
              href="https://dashboard.stripe.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-pill border border-border bg-surface px-4 text-[13px] font-medium text-ink hover:bg-app"
            >
              Open Stripe Dashboard
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
  const shownNotice = notice ? STRIPE_NOTICES[notice] : undefined;
  const rows = [
    {
      name: "Email",
      state: data.email === "resend" ? "Connected" : "Not set up",
      tone: data.email === "resend" ? ("green" as const) : ("amber" as const),
      detail: data.email === "resend" ? "Invitations, resets and receipts are emailed." : "Emails are not delivered. Staff invitation links must be shared by hand.",
    },
    {
      name: "Push notifications",
      state: data.push === "webpush" ? "Connected" : "Not set up",
      tone: data.push === "webpush" ? ("green" as const) : ("neutral" as const),
      detail: "Messages to clients' phones.",
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
        <p className="text-[12px] text-ink-muted">Checkout in the client app still runs in test mode: no real money moves until payments are switched to Stripe.</p>
      )}
      <div>
        <p className="mb-2 text-[12px] text-ink-muted">These are configured by the platform. Contact support to change them.</p>
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
  if (data.rows.length === 0) return <p className="text-[12px] text-ink-muted">Nothing recorded yet.</p>;
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full text-left text-[12px]">
        <thead className="border-b border-border bg-app text-[11px] uppercase tracking-wide text-ink-faint">
          <tr>
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Who</th>
            <th className="px-3 py-2 font-medium">What</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{new Date(r.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
              <td className="px-3 py-2">
                {r.actorUser?.email ?? (r.actorType === "SYSTEM" ? "System" : "—")}
                {r.actorType === "PLATFORM_ADMIN" && <span className="ml-1 text-ink-faint">(agency)</span>}
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
