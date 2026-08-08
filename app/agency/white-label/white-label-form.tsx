"use client";

import { useActionState } from "react";
import { Panel } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { saveWhiteLabelAction } from "@/lib/actions/agency";

export interface WhiteLabelSettings {
  name: string;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  customDomain: string | null;
  supportLabel: string | null;
  supportUrl: string | null;
  senderName: string | null;
  loginBgUrl: string | null;
}

const field =
  "h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary";
const label = "mb-1.5 block text-[12px] font-medium";

export function WhiteLabelForm({ settings }: { settings: WhiteLabelSettings | null }) {
  const [state, formAction, pending] = useActionState(saveWhiteLabelAction, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <Panel className="p-5">
        <h2 className="text-[14px] font-medium">Brand</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className={label}>
              Brand name
            </label>
            <input id="name" name="name" defaultValue={settings?.name ?? "DezaAI"} required className={field} />
          </div>
          <div>
            <label htmlFor="primaryColor" className={label}>
              Primary color
            </label>
            <input
              id="primaryColor"
              name="primaryColor"
              type="color"
              defaultValue={settings?.primaryColor ?? "#2DD4D9"}
              className={`${field} p-1`}
            />
          </div>
          <div>
            <label htmlFor="logoLightUrl" className={label}>
              Logo (light)
            </label>
            <input id="logoLightUrl" name="logoLightUrl" defaultValue={settings?.logoLightUrl ?? ""} className={field} />
          </div>
          <div>
            <label htmlFor="logoDarkUrl" className={label}>
              Logo (dark)
            </label>
            <input id="logoDarkUrl" name="logoDarkUrl" defaultValue={settings?.logoDarkUrl ?? ""} className={field} />
          </div>
          <div>
            <label htmlFor="faviconUrl" className={label}>
              Favicon
            </label>
            <input id="faviconUrl" name="faviconUrl" defaultValue={settings?.faviconUrl ?? ""} className={field} />
          </div>
          <div>
            <label htmlFor="loginBgUrl" className={label}>
              Login background
            </label>
            <input id="loginBgUrl" name="loginBgUrl" defaultValue={settings?.loginBgUrl ?? ""} className={field} />
          </div>
        </div>
      </Panel>

      <Panel className="p-5">
        <h2 className="text-[14px] font-medium">Domain &amp; email</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="customDomain" className={label}>
              Custom domain
            </label>
            <input id="customDomain" name="customDomain" placeholder="app.yourbrand.com" defaultValue={settings?.customDomain ?? ""} className={field} />
          </div>
          <div>
            <label htmlFor="senderName" className={label}>
              Sender email name
            </label>
            <input id="senderName" name="senderName" defaultValue={settings?.senderName ?? ""} className={field} />
          </div>
        </div>
      </Panel>

      <Panel className="p-5">
        <h2 className="text-[14px] font-medium">Support</h2>
        <p className="mt-1 text-[12px] text-ink-muted">Drives the &ldquo;Need Support?&rdquo; card in the sidebar at both levels.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="supportLabel" className={label}>
              Support link label
            </label>
            <input id="supportLabel" name="supportLabel" placeholder="Contact support" defaultValue={settings?.supportLabel ?? ""} className={field} />
          </div>
          <div>
            <label htmlFor="supportUrl" className={label}>
              Support URL
            </label>
            <input id="supportUrl" name="supportUrl" placeholder="https://…" defaultValue={settings?.supportUrl ?? ""} className={field} />
          </div>
        </div>
      </Panel>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          Save changes
        </Button>
        {state?.error && <p className="text-[12px] text-[var(--accent-red)]">{state.error}</p>}
        {state?.success && <p className="text-[12px] text-[var(--accent-green)]">Saved.</p>}
      </div>
    </form>
  );
}
