ALTER TABLE "master"."TM_PROCESS_PARTS" ADD COLUMN "INT_INPUT_LOCATION_ID" bigint;--> statement-breakpoint
ALTER TABLE "master"."TM_PROCESS_PARTS" ADD COLUMN "INT_OUTPUT_LOCATION_ID" bigint;--> statement-breakpoint
ALTER TABLE "master"."TM_PROCESS_PARTS" ADD COLUMN "CHR_SCAN_MODE" varchar(32);--> statement-breakpoint
ALTER TABLE "master"."TM_PROCESS_PARTS" ADD COLUMN "FLG_SAP_PRODUCTION_ENABLED" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "master"."TM_PROCESS_PARTS" ADD COLUMN "FLG_IS_PRIMARY" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "TM_PROCESS_PARTS_PART_PRIMARY_UNIQUE" ON "master"."TM_PROCESS_PARTS" USING btree ("INT_PART_ID") WHERE "master"."TM_PROCESS_PARTS"."FLG_IS_PRIMARY";--> statement-breakpoint
ALTER TABLE "master"."TM_PROCESS_PARTS" ADD CONSTRAINT "TM_PROCESS_PARTS_CHR_SCAN_MODE_CHK" CHECK ("master"."TM_PROCESS_PARTS"."CHR_SCAN_MODE" IN ('PART_SAJA', 'PART_KANBAN', 'KANBAN_BOX', 'PART_TANPA_KANBAN', 'PART_PINDAH_KARTU', 'KANBAN_MOLD', 'KANBAN_BOX_DANDORI', 'PER_PIECE', 'PER_KANBAN'));--> statement-breakpoint
/*
 * Salin nilai yang berlaku sekarang ke tiap baris rute, dengan urutan yang sama
 * seperti scan: Rute Proses lalu Line untuk SLOC, Line lalu Jenis Proses untuk
 * metode. Rute Proses yang nonaktif diabaikan, seperti di scan.
 */
UPDATE "master"."TM_PROCESS_PARTS" AS pp
SET
  "INT_INPUT_LOCATION_ID" = sumber.asal,
  "INT_OUTPUT_LOCATION_ID" = sumber.tujuan,
  "CHR_SCAN_MODE" = sumber.metode,
  "FLG_SAP_PRODUCTION_ENABLED" = sumber.sap
FROM (
  SELECT
    x."INT_ID" AS id,
    COALESCE(rp."INT_INPUT_LOCATION_ID", l."INT_INPUT_LOCATION_ID") AS asal,
    COALESCE(rp."INT_OUTPUT_LOCATION_ID", l."INT_OUTPUT_LOCATION_ID") AS tujuan,
    COALESCE(l."CHR_SCAN_MODE", pt."CHR_SCAN_MODE") AS metode,
    COALESCE(rp."FLG_SAP_PRODUCTION_ENABLED", false) AS sap
  FROM "master"."TM_PROCESS_PARTS" x
  JOIN "master"."TM_PROCESS_TYPE" pt ON pt."CHR_CODE" = x."CHR_PROCESS_TYPE"
  LEFT JOIN "master"."TM_LINE" l ON l."INT_ID" = x."INT_LINE_ID"
  LEFT JOIN "master"."TM_ROUTE_PROCESS" rp
    ON rp."INT_PLANT_ID" = x."INT_PLANT_ID"
   AND rp."CHR_PROCESS_TYPE" = x."CHR_PROCESS_TYPE"
   AND rp."FLG_IS_ACTIVE"
) sumber
WHERE pp."INT_ID" = sumber.id;--> statement-breakpoint
/*
 * Work center QR = baris yang lininya sama dengan lini part, karena itulah yang
 * dicetak hari ini. Kalau lebih dari satu langkah di lini itu, langkah terakhir
 * yang menang. Part yang lininya tidak ada di rutenya sengaja dibiarkan tanpa
 * baris utama, supaya terlihat di layar rute dan bukan ditebak di sini.
 */
UPDATE "master"."TM_PROCESS_PARTS"
SET "FLG_IS_PRIMARY" = true
WHERE "INT_ID" IN (
  SELECT DISTINCT ON (x."INT_PART_ID") x."INT_ID"
  FROM "master"."TM_PROCESS_PARTS" x
  JOIN "master"."TM_PARTS" p ON p."INT_ID" = x."INT_PART_ID" AND p."INT_LINE_ID" = x."INT_LINE_ID"
  WHERE x."FLG_IS_ACTIVE"
  ORDER BY x."INT_PART_ID", x."INT_SEQ_NO" DESC
);
