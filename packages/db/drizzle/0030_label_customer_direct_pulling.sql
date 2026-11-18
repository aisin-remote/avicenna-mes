ALTER TABLE "org"."TM_PLANT" ADD COLUMN "FLG_DIRECT_PULLING_LINE" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "master"."TM_CUST" ADD COLUMN "INT_LABEL_LENGTH" integer;--> statement-breakpoint
ALTER TABLE "master"."TM_CUST" ADD COLUMN "INT_LABEL_PART_START" integer;--> statement-breakpoint
ALTER TABLE "master"."TM_CUST" ADD COLUMN "INT_LABEL_PART_LENGTH" integer;--> statement-breakpoint
ALTER TABLE "master"."TM_CUST" ADD COLUMN "INT_LABEL_SERIAL_START" integer;--> statement-breakpoint
ALTER TABLE "master"."TM_CUST" ADD COLUMN "INT_LABEL_SERIAL_LENGTH" integer;--> statement-breakpoint
-- Handika 16-17 Nov 2026: di UNIT kanban customer di line = direct pulling; BODY tidak.
UPDATE "org"."TM_PLANT" SET "FLG_DIRECT_PULLING_LINE" = true WHERE "CHR_CODE" = 'UNIT';
