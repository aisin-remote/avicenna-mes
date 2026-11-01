DROP INDEX "kanban"."TT_KANBAN_PAIRING_WIP_UNIQUE";--> statement-breakpoint
ALTER TABLE "kanban"."TT_KANBAN_PAIRING" ADD COLUMN "DTM_WIP_PRODUCED_AT" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "TT_KANBAN_PAIRING_WIP_IDX" ON "kanban"."TT_KANBAN_PAIRING" USING btree ("INT_WIP_KANBAN_ID");