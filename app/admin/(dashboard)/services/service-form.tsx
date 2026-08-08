"use client";

import { useActionState } from "react";
import { Input, Label, Select, Textarea, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { ImageUpload } from "@/components/admin/image-upload";
import type { ServiceCategory, Service } from "@prisma/client";

export function ServiceForm({
  categories,
  service,
  action,
}: {
  categories: ServiceCategory[];
  service?: Service;
  action: (prevState: unknown, formData: FormData) => Promise<{ error?: string } | undefined>;
}) {
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={service?.name} required />
      </div>
      <div>
        <Label htmlFor="categoryId">Category</Label>
        <Select id="categoryId" name="categoryId" defaultValue={service?.categoryId} required>
          <option value="">Select a category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={3} defaultValue={service?.description ?? ""} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="price">Price (USD)</Label>
          <Input
            id="price"
            name="price"
            type="number"
            step="0.01"
            min="0"
            defaultValue={service ? (service.priceCents / 100).toFixed(2) : undefined}
            required
          />
        </div>
        <div>
          <Label htmlFor="durationMinutes">Duration (minutes)</Label>
          <Input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min="5"
            step="5"
            defaultValue={service?.durationMinutes}
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="prepInstructions">Preparation information</Label>
        <Textarea id="prepInstructions" name="prepInstructions" rows={2} defaultValue={service?.prepInstructions ?? ""} />
      </div>
      <div>
        <Label htmlFor="aftercareInstructions">Aftercare information</Label>
        <Textarea
          id="aftercareInstructions"
          name="aftercareInstructions"
          rows={2}
          defaultValue={service?.aftercareInstructions ?? ""}
        />
      </div>
      <ImageUpload name="imageUrl" label="Photo" defaultValue={service?.imageUrl} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="taxable" defaultChecked={service?.taxable ?? true} />
        Taxable
      </label>
      {service && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={service.active} />
          Active (visible to customers)
        </label>
      )}
      <FieldError>{state?.error}</FieldError>
      <SubmitButton className="w-auto">{service ? "Save changes" : "Create service"}</SubmitButton>
    </form>
  );
}
