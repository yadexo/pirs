"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Panel, Pill, Drawer } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";
import type { FieldErrors } from "@/components/merchant/form";
import {
  archiveItemAction,
  getAppBuilderItemAction,
  getAppBuilderOptionsAction,
  savePackageAction,
  saveMembershipPlanAction,
  saveProductAction,
  savePromotionAction,
  saveRewardAction,
  saveServiceAction,
  setItemActiveAction,
  type ItemKind,
} from "@/lib/actions/app-builder";
import { describeActionFailure } from "@/lib/action-failure";
import { NO_USAGE, warnBeforeDelete, whyHidden, type PromotionUsage } from "@/lib/promotion-usage";
import { defaultFilterFor } from "@/lib/app-builder-filters";
import { FORMS, type FormOptions } from "./item-forms";

export interface CatalogItem {
  kind: ItemKind;
  id: string;
  name: string;
  meta: string;
  /** Something the clinic must fix before clients can use this. */
  warning?: string;
  priceCents: number | null;
  active: boolean;
}

type TabKey = "custom-plans" | "offers" | "products" | "membership" | "rewards";

/** Per-tab copy, built from translations so it can't go stale against KIND_LABEL. */
function tabConfig(t: ReturnType<typeof useTranslations>): Record<TabKey, { heading: string; create: string; empty: string; filters: [string, string][]; kinds: ItemKind[] }> {
  return {
    "custom-plans": { heading: t("tabs.customPlans.heading"), create: t("tabs.customPlans.create"), empty: t("tabs.customPlans.empty"), filters: [["all", t("filterAll")]], kinds: ["package"] },
    offers: {
      heading: t("tabs.offers.heading"),
      create: t("tabs.offers.create"),
      empty: t("tabs.offers.empty"),
      filters: [
        ["all", t("filterAll")],
        ["visible", t("visible")],
        // An offer that was used is hidden rather than deleted, so this is
        // where those go to be found again — or left out of the way.
        ["hidden", t("hidden")],
        ["campaigns", t("filterCampaigns")],
      ],
      kinds: ["promotion"],
    },
    products: {
      heading: t("tabs.products.heading"),
      create: t("tabs.products.create"),
      empty: t("tabs.products.empty"),
      filters: [
        ["all", t("filterAll")],
        ["service", t("filterTreatments")],
        ["product", t("filterProducts")],
      ],
      kinds: ["service", "product"],
    },
    membership: { heading: t("tabs.membership.heading"), create: t("tabs.membership.create"), empty: t("tabs.membership.empty"), filters: [["all", t("filterAll")]], kinds: ["membershipPlan"] },
    rewards: { heading: t("tabs.rewards.heading"), create: t("tabs.rewards.create"), empty: t("tabs.rewards.empty"), filters: [["all", t("filterAll")]], kinds: ["reward"] },
  };
}

function kindLabels(t: ReturnType<typeof useTranslations>): Record<ItemKind, string> {
  return {
    service: t("kindLabel.service"),
    product: t("kindLabel.product"),
    package: t("kindLabel.package"),
    promotion: t("kindLabel.promotion"),
    membershipPlan: t("kindLabel.membershipPlan"),
    reward: t("kindLabel.reward"),
    campaign: t("kindLabel.campaign"),
  };
}

const SAVE: Partial<Record<ItemKind, (merchantId: string, id: string | null, fd: FormData) => ReturnType<typeof saveServiceAction>>> = {
  service: saveServiceAction,
  product: saveProductAction,
  package: savePackageAction,
  promotion: savePromotionAction,
  membershipPlan: saveMembershipPlanAction,
  reward: saveRewardAction,
};

type Editor =
  | { mode: "closed" }
  | { mode: "choose" }
  | { mode: "loading"; kind: ItemKind; id: string | null }
  | { mode: "open"; kind: ItemKind; id: string | null; item: Record<string, unknown> };

export function CatalogTab({
  merchantId,
  tab,
  q,
  typeFilter,
  currency,
  items,
}: {
  merchantId: string;
  tab: string;
  q: string;
  typeFilter: string;
  currency: string;
  items: CatalogItem[];
}) {
  const t = useTranslations("portal.appBuilder.catalogTab");
  const tc = useTranslations("common");
  const router = useRouter();
  const TAB_CONFIG = tabConfig(t);
  const KIND_LABEL = kindLabels(t);
  const config = TAB_CONFIG[(tab as TabKey) in TAB_CONFIG ? (tab as TabKey) : "custom-plans"];
  const [editor, setEditor] = React.useState<Editor>({ mode: "closed" });
  const [options, setOptions] = React.useState<FormOptions | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<null | "save" | "toggle" | "archive">(null);
  const [confirmArchive, setConfirmArchive] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  /**
   * What this offer is already tangled up in, counted when it was loaded, so
   * the Remove button can say what it will do before it is pressed. Anything
   * else in App Builder has its own fixed rule and nothing to warn about.
   */
  const promotionUsage: PromotionUsage =
    editor.mode === "open" && editor.kind === "promotion" && editor.item._count
      ? (editor.item._count as PromotionUsage)
      : NO_USAGE;
  const deleteWarning = editor.mode === "open" && editor.kind === "promotion" ? warnBeforeDelete(promotionUsage) : null;

  function navigate(next: Partial<{ q: string; type: string }>) {
    const merged = { q, type: typeFilter, ...next };
    const sp = new URLSearchParams({ tab });
    if (merged.q) sp.set("q", merged.q);
    if (merged.type !== defaultFilterFor(tab)) sp.set("type", merged.type);
    router.push(`/m/${merchantId}/app-builder?${sp}`);
  }

  const close = React.useCallback(() => {
    setEditor({ mode: "closed" });
    setErrors(undefined);
    setFormError(null);
    setConfirmArchive(false);
  }, []);

  async function open(kind: ItemKind, id: string | null) {
    setErrors(undefined);
    setFormError(null);
    setConfirmArchive(false);
    setEditor({ mode: "loading", kind, id });

    const [opts, loaded] = await Promise.all([
      options ? Promise.resolve(null) : getAppBuilderOptionsAction(merchantId, kind),
      id ? getAppBuilderItemAction(merchantId, kind, id) : Promise.resolve(null),
    ]);
    if (opts && "error" in opts) {
      toast.error(opts.error);
      return close();
    }
    if (loaded && "error" in loaded) {
      toast.error(loaded.error);
      return close();
    }
    if (opts) setOptions(opts);
    setEditor({ mode: "open", kind, id, item: loaded ? loaded.item : {} });
  }

  function startCreate() {
    if (config.kinds.length > 1) setEditor({ mode: "choose" });
    else void open(config.kinds[0]!, null);
  }

  const createdLabel = editor.mode === "open" && (editor.kind === "product" || editor.kind === "service") ? t("kindLabel.product") : KIND_LABEL[editor.mode === "open" ? editor.kind : "product"];

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Nothing below may end without either saving or saying why. A silent
    // return here looks exactly like a dead button: the drawer stays open with
    // the old values and no request is ever made.
    if (editor.mode !== "open") {
      setFormError(t("editorNotReady"));
      return;
    }
    const action = SAVE[editor.kind];
    if (!action) {
      setFormError(t("savingNotSupported", { kind: KIND_LABEL[editor.kind] }));
      return;
    }

    setBusy("save");
    setFormError(null);

    // Read before awaiting: React clears currentTarget once the handler yields.
    const form = e.currentTarget;
    let res: Awaited<ReturnType<typeof action>>;
    try {
      res = await action(merchantId, editor.id, new FormData(form));
    } catch (err) {
      setBusy(null);
      setFormError(describeActionFailure(err));
      return;
    }
    setBusy(null);
    if ("error" in res) {
      setErrors(res.fieldErrors);
      setFormError(res.error);
      // Bring the first highlighted field into view.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    toast.success(editor.id ? t("saved") : t("createdToast", { kind: capitalise(createdLabel) }));
    setOptions(null); // categories and pickers may have changed
    close();
    router.refresh();
  }

  async function toggleActive() {
    if (editor.mode !== "open" || !editor.id) return;
    const next = !editor.item.active;
    setBusy("toggle");
    const res = await setItemActiveAction(merchantId, editor.kind, editor.id, next);
    setBusy(null);
    if ("error" in res) return toast.error(res.error);
    toast.success(next ? t("nowVisible") : t("nowHidden"));
    close();
    router.refresh();
  }

  async function archive() {
    if (editor.mode !== "open" || !editor.id) return;
    setBusy("archive");
    const res = await archiveItemAction(merchantId, editor.kind, editor.id);
    setBusy(null);
    if ("error" in res) {
      setConfirmArchive(false);
      return toast.error(res.error);
    }
    // Hidden and deleted look the same from here — the row simply changes —
    // so the clinic is told which one it got, and why.
    const explanation = res.hidden ? whyHidden(res.usage) : null;
    toast.success(explanation ?? t("removed"));
    close();
    router.refresh();
  }

  const Form = editor.mode === "open" ? FORMS[editor.kind] : undefined;
  const kindLabel = editor.mode === "open" || editor.mode === "loading" ? KIND_LABEL[editor.kind] : t("kindLabel.item");
  // Everything sold in the shop is "a product" to the clinic, whatever it
  // chooses to call the thing itself inside the form.
  const isShopItem = editor.mode === "open" && (editor.kind === "product" || editor.kind === "service");
  const title =
    editor.mode === "choose"
      ? config.create
      : isShopItem
        ? editor.id
          ? t("editProduct")
          : t("createProduct")
        : editor.mode === "open" && editor.id
          ? String(editor.item.name ?? editor.item.title ?? t("editKind", { kind: kindLabel }))
          : t("newKind", { kind: kindLabel });
  const saveLabel = editor.mode === "open" && editor.id ? t("saveChanges") : isShopItem ? t("createProduct") : t("createKind", { kind: kindLabel });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{config.heading}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ q: new FormData(e.currentTarget).get("q") as string });
            }}
            className="relative"
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <input
              name="q"
              defaultValue={q}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchAria", { heading: config.heading })}
              className="h-8 w-44 rounded-[10px] border border-border bg-surface pl-8 pr-3 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </form>
          {config.filters.length > 1 && (
            <select
              value={typeFilter}
              onChange={(e) => navigate({ type: e.target.value })}
              aria-label={t("filterAria")}
              className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px] outline-none"
            >
              {config.filters.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
          {!(tab === "offers" && typeFilter === "campaigns") && (
            <Button size="sm" onClick={startCreate}>
              <CirclePlus className="h-3.5 w-3.5" /> {config.create}
            </Button>
          )}
        </div>
      </div>

      <Panel>
        {items.length === 0 ? (
          <EmptyState title={config.empty} />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <button
                  type="button"
                  onClick={() => (item.kind === "campaign" ? undefined : void open(item.kind, item.id))}
                  disabled={item.kind === "campaign"}
                  className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-app disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold">{item.name}</span>
                    <span className="block text-[11px] text-ink-muted">{item.meta}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {item.warning && <Pill tone="amber">{item.warning}</Pill>}
                    {item.priceCents !== null && <span className="tabular text-[13px] font-medium">{formatMoney(item.priceCents, currency)}</span>}
                    <Pill tone={item.active ? "green" : "neutral"}>{item.active ? t("visible") : t("hidden")}</Pill>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Drawer
        open={editor.mode !== "closed"}
        onClose={close}
        onBack={editor.mode === "open" ? close : undefined}
        title={title}
        width="max-w-[560px]"
        footer={
          editor.mode === "open" ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {editor.id && !confirmArchive && (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={toggleActive} disabled={busy !== null}>
                      {busy === "toggle" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {editor.item.active ? t("hideFromApp") : t("showInApp")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmArchive(true)} disabled={busy !== null}>
                      {t("remove")}
                    </Button>
                  </>
                )}
                {confirmArchive && (
                  <>
                    <span className="max-w-md text-[12px] text-ink-muted">{deleteWarning ?? t("removeThisKind", { kind: kindLabel })}</span>
                    <Button type="button" variant="danger" size="sm" onClick={archive} disabled={busy !== null}>
                      {busy === "archive" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {t("remove")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmArchive(false)}>
                      {t("keep")}
                    </Button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={close}>
                  {tc("cancel")}
                </Button>
                {/* Targets the form by id, so it must not be offered before
                    that form exists — a submit button pointing at nothing is
                    a button that does nothing, silently. */}
                <Button type="submit" size="sm" form="app-builder-form" disabled={busy !== null || !options}>
                  {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {saveLabel}
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        {editor.mode === "choose" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {config.kinds.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => void open(k, null)}
                className="rounded-card border border-border p-4 text-left hover:border-primary hover:bg-primary-soft"
              >
                <span className="block text-[14px] font-semibold">{capitalise(KIND_LABEL[k])}</span>
                <span className="mt-1 block text-[12px] text-ink-muted">{k === "service" ? t("serviceExplanation") : t("productLikeExplanation")}</span>
              </button>
            ))}
          </div>
        )}

        {editor.mode === "loading" && (
          <div className="flex h-40 items-center justify-center text-ink-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {editor.mode === "open" && Form && options && (
          <form id="app-builder-form" ref={formRef} onSubmit={save} noValidate>
            {formError && (
              <p role="alert" className="mb-4 rounded-[10px] bg-[var(--accent-red)]/10 px-3 py-2 text-[12px] text-[var(--accent-red)]">
                {formError}
              </p>
            )}
            {/* Remount per item so defaultValues reset between records. */}
            <Form key={`${editor.kind}-${editor.id ?? "new"}`} merchantId={merchantId} currency={currency} item={editor.item} options={options} errors={errors} />
          </form>
        )}
      </Drawer>
    </>
  );
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
