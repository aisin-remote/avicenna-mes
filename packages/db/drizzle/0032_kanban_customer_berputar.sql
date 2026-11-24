ALTER TABLE "master"."TM_CUST" ADD COLUMN "FLG_KANBAN_RETURNABLE" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Handika 24 Nov 2026: kanban RFID TMMIN kembali dari customer dan di-reset saat delivery.
UPDATE "master"."TM_CUST" SET "FLG_KANBAN_RETURNABLE" = true WHERE "CHR_CUST_NO" = 'TMMIN';
