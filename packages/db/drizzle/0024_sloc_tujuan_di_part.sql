ALTER TABLE "master"."TM_PARTS" ADD COLUMN "INT_OUTPUT_LOCATION_ID" bigint;--> statement-breakpoint
/*
 * Isi awal dari rute: SLOC keluar baris rute aktif part itu, yang utama lebih
 * dulu, lalu urutan terkecil. Sesudah ini rute tidak dibaca lagi untuk SLOC
 * tujuan, jadi scan tetap masuk ke gudang yang sama seperti sebelum migrasi.
 */
UPDATE "master"."TM_PARTS" AS p
SET "INT_OUTPUT_LOCATION_ID" = sumber.tujuan
FROM (
  SELECT DISTINCT ON (pp."INT_PART_ID")
    pp."INT_PART_ID" AS part_id,
    pp."INT_OUTPUT_LOCATION_ID" AS tujuan
  FROM "master"."TM_PROCESS_PARTS" AS pp
  WHERE pp."FLG_IS_ACTIVE" AND pp."INT_OUTPUT_LOCATION_ID" IS NOT NULL
  ORDER BY pp."INT_PART_ID", pp."FLG_IS_PRIMARY" DESC, pp."INT_SEQ_NO", pp."INT_ID"
) AS sumber
WHERE p."INT_ID" = sumber.part_id;
