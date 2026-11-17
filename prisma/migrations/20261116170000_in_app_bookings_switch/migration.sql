-- The app's own booking, switched per clinic by the platform.
--
-- Off for every clinic, existing and new: clinics book through their own
-- software, and the app links to it per treatment. A platform admin turns it
-- on for a clinic from the admin console; the demo seed turns it on for the
-- demo clinic. Nothing about existing appointments changes.
ALTER TABLE "Tenant" ADD COLUMN "inAppBookings" BOOLEAN NOT NULL DEFAULT false;
