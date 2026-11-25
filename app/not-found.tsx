import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotFoundView } from "@/components/not-found-view";
import { getClinicBrand } from "@/lib/clinic-brand";
import { currentClinicHostSlug } from "@/lib/public-clinic";

export const metadata: Metadata = { robots: { index: false } };

/**
 * Every 404 in the app. Branded only on a clinic's own domain — the header
 * that says so is set by the middleware alone — and neutral everywhere else.
 */
export default async function NotFound() {
  const t = await getTranslations("notFound");
  const slug = await currentClinicHostSlug();
  const clinic = slug ? await getClinicBrand(slug) : null;
  return <NotFoundView title={t("title")} body={t("body")} home={t("home")} clinic={clinic} />;
}
