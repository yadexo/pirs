"use client";

import { useActionState, useState } from "react";
import { updateBrandingAction } from "@/lib/actions/branding";
import { Input, Label, Textarea, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { ImageUpload } from "@/components/admin/image-upload";
import { Card } from "@/components/ui/card";
import type { TenantBranding } from "@prisma/client";

export function BrandingForm({ branding }: { branding: TenantBranding | null }) {
  const [state, formAction] = useActionState(updateBrandingAction, undefined);
  const [businessName, setBusinessName] = useState(branding?.businessName ?? "Your Clinic");
  const [primaryColor, setPrimaryColor] = useState(branding?.primaryColor ?? "#0f766e");
  const [secondaryColor, setSecondaryColor] = useState(branding?.secondaryColor ?? "#0891b2");
  const [accentColor, setAccentColor] = useState(branding?.accentColor ?? "#f59e0b");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <form action={formAction} className="space-y-4">
        <div>
          <Label htmlFor="businessName">Business name</Label>
          <Input id="businessName" name="businessName" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
        </div>

        <ImageUpload name="logoUrl" label="Logo" defaultValue={branding?.logoUrl} />
        <ImageUpload name="coverImageUrl" label="Cover image" defaultValue={branding?.coverImageUrl} />

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="primaryColor">Primary color</Label>
            <Input id="primaryColor" name="primaryColor" type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-10 p-1" />
          </div>
          <div>
            <Label htmlFor="secondaryColor">Secondary color</Label>
            <Input id="secondaryColor" name="secondaryColor" type="color" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} className="h-10 p-1" />
          </div>
          <div>
            <Label htmlFor="accentColor">Accent color</Label>
            <Input id="accentColor" name="accentColor" type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-10 p-1" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="contactEmail">Contact email</Label>
            <Input id="contactEmail" name="contactEmail" type="email" defaultValue={branding?.contactEmail ?? ""} />
          </div>
          <div>
            <Label htmlFor="contactPhone">Contact phone</Label>
            <Input id="contactPhone" name="contactPhone" defaultValue={branding?.contactPhone ?? ""} />
          </div>
        </div>

        <div>
          <Label htmlFor="addressLine1">Address</Label>
          <Input id="addressLine1" name="addressLine1" defaultValue={branding?.addressLine1 ?? ""} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Input name="city" placeholder="City" defaultValue={branding?.city ?? ""} />
          <Input name="region" placeholder="State" defaultValue={branding?.region ?? ""} />
          <Input name="postalCode" placeholder="ZIP" defaultValue={branding?.postalCode ?? ""} />
        </div>
        <Input name="country" placeholder="Country" defaultValue={branding?.country ?? ""} />

        <div>
          <Label htmlFor="website">Website</Label>
          <Input id="website" name="website" defaultValue={branding?.website ?? ""} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="currency">Currency</Label>
            <Input id="currency" name="currency" defaultValue={branding?.currency ?? "USD"} maxLength={3} required />
          </div>
          <div>
            <Label htmlFor="timeZone">Time zone</Label>
            <Input id="timeZone" name="timeZone" defaultValue={branding?.timeZone ?? "America/New_York"} required />
          </div>
        </div>

        <div>
          <Label htmlFor="cancellationPolicy">Cancellation policy</Label>
          <Textarea id="cancellationPolicy" name="cancellationPolicy" rows={2} defaultValue={branding?.cancellationPolicy ?? ""} />
        </div>
        <div>
          <Label htmlFor="termsContent">Terms &amp; conditions</Label>
          <Textarea id="termsContent" name="termsContent" rows={3} defaultValue={branding?.termsContent ?? ""} />
        </div>
        <div>
          <Label htmlFor="privacyContent">Privacy policy</Label>
          <Textarea id="privacyContent" name="privacyContent" rows={3} defaultValue={branding?.privacyContent ?? ""} />
        </div>

        <FieldError>{state?.error}</FieldError>
        <SubmitButton className="w-auto">Save branding</SubmitButton>
      </form>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <p className="mb-2 text-sm font-medium text-ink-muted">Live preview</p>
        <Card className="overflow-hidden">
          <div style={{ backgroundColor: primaryColor }} className="p-4 text-white">
            <p className="text-xs opacity-80">Welcome to</p>
            <p className="text-lg font-semibold">{businessName}</p>
          </div>
          <div className="space-y-2 p-4">
            <div style={{ backgroundColor: `${secondaryColor}20`, color: secondaryColor }} className="rounded-md px-3 py-2 text-sm font-medium">
              Book an appointment
            </div>
            <div style={{ backgroundColor: `${accentColor}20`, color: accentColor }} className="rounded-md px-3 py-2 text-sm font-medium">
              Active promotion
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
