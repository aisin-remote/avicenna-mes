DROP INDEX "master"."TM_PROCESS_PARTS_PART_PROCESS_UNIQUE";--> statement-breakpoint
DROP INDEX "master"."TM_PROCESS_PARTS_PART_SEQ_UNIQUE";--> statement-breakpoint
ALTER TABLE "master"."TM_PROCESS_PARTS" ADD COLUMN "INT_TRANSFER_LOCATION_ID" bigint;--> statement-breakpoint
ALTER TABLE "master"."TM_PROCESS_PARTS" ADD COLUMN "FLG_SAP_TRANSFER_ENABLED" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "master"."TM_PROCESS_PARTS" ADD COLUMN "CHR_SAP_TRANSFER_MVT" varchar(3);--> statement-breakpoint
ALTER TABLE "master"."TM_PROCESS_PARTS" ADD COLUMN "FLG_REQUIRE_PAIRING" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "TM_PROCESS_PARTS_PART_LINE_UNIQUE" ON "master"."TM_PROCESS_PARTS" USING btree ("INT_PART_ID","INT_LINE_ID") WHERE "master"."TM_PROCESS_PARTS"."INT_LINE_ID" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "TM_PROCESS_PARTS_PART_PROCESS_NOLINE_UNIQUE" ON "master"."TM_PROCESS_PARTS" USING btree ("INT_PART_ID","CHR_PROCESS_TYPE") WHERE "master"."TM_PROCESS_PARTS"."INT_LINE_ID" is null;--> statement-breakpoint
/*
 * Sisa isi Rute Proses yang belum ada di baris rute: transfer dan wajib belanja.
 * Rute Proses nonaktif diabaikan, seperti di scan. SLOC dan izin produksi sudah
 * disalin migrasi 0022 dan mungkin sudah disunting, jadi tidak disentuh.
 */
UPDATE "master"."TM_PROCESS_PARTS" AS pp
SET
  "INT_TRANSFER_LOCATION_ID" = rp."INT_TRANSFER_LOCATION_ID",
  "FLG_SAP_TRANSFER_ENABLED" = rp."FLG_SAP_TRANSFER_ENABLED",
  "CHR_SAP_TRANSFER_MVT" = rp."CHR_SAP_TRANSFER_MVT",
  "FLG_REQUIRE_PAIRING" = rp."FLG_REQUIRE_PAIRING"
FROM "master"."TM_ROUTE_PROCESS" AS rp
WHERE rp."INT_PLANT_ID" = pp."INT_PLANT_ID"
  AND rp."CHR_PROCESS_TYPE" = pp."CHR_PROCESS_TYPE"
  AND rp."FLG_IS_ACTIVE";
