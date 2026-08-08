"use client";

import { useActionState } from "react";
import { Input, Label, Select, Textarea, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { ImageUpload } from "@/components/admin/image-upload";
import type { ProductCategory, Product } from "@prisma/client";

export function ProductForm({
  categories,
  product,
  action,
}: {
  categories: ProductCategory[];
  product?: Product;
  action: (prevState: unknown, formData: FormData) => Promise<{ error?: string } | undefined>;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const firstImage = Array.isArray(product?.images) ? (product?.images as string[])[0] : undefined;

  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={product?.name} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="categoryId">Category</Label>
          <Select id="categoryId" name="categoryId" defaultValue={product?.categoryId} required>
            <option value="">Select a category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" name="sku" defaultValue={product?.sku} required />
        </div>
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={3} defaultValue={product?.description ?? ""} />
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
            defaultValue={product ? (product.priceCents / 100).toFixed(2) : undefined}
            required
          />
        </div>
        <div>
          <Label htmlFor="inventoryQuantity">Starting inventory</Label>
          <Input
            id="inventoryQuantity"
            name="inventoryQuantity"
            type="number"
            min="0"
            defaultValue={product?.inventoryQuantity ?? 0}
            required
          />
        </div>
      </div>
      <ImageUpload name="imageUrl" label="Photo" defaultValue={firstImage} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="taxable" defaultChecked={product?.taxable ?? true} />
        Taxable
      </label>
      {product && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={product.active} />
          Active (visible to customers)
        </label>
      )}
      <FieldError>{state?.error}</FieldError>
      <SubmitButton className="w-auto">{product ? "Save changes" : "Create product"}</SubmitButton>
    </form>
  );
}
