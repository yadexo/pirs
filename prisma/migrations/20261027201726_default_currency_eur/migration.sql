-- Clinics are moving to a three-currency choice (EUR/USD/GBP), defaulting to
-- EUR. Existing clinics that never picked one, or picked USD under the old
-- wide-open currency list, move to EUR here. Anything already on EUR or GBP
-- (including any real clinic already billing in one of those) is untouched.
UPDATE "TenantBranding" SET "currency" = 'EUR' WHERE "currency" IS NULL OR "currency" = '' OR "currency" = 'USD';
