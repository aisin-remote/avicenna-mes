-- ─────────────────────────────────────────────────────────────────────────────
-- Data trial API RFID (POST /api/rfid/loading/rfid/batch) — versi SQL murni.
--
-- Cara pakai: ganti token di bawah, lalu jalankan seluruh file di DB tujuan,
-- misalnya di server:
--   docker exec -i avicenna-postgres psql -U avicenna -d avicenna < seed-rfid-trial.sql
-- atau tempel ke pgAdmin / DBeaver lalu Run.
--
-- Setiap kali dijalankan membuat loading list BARU (LL-RFID-<tanggal>-01, -02, …)
-- berisi dua part dummy (A: 3 kanban × 20, B: 2 kanban × 10), plus perangkat
-- RFID (token di-reset ke nilai di bawah). Hasil untuk Postman tampil di akhir.
--
-- Sengaja TIDAK menambah stok FG (beda dengan db:seed-rfid-trial): scan RFID
-- tidak butuh stok; tutup pulling hanya akan memberi peringatan saldo kurang.
-- Semua dalam satu blok: gagal di tengah = tidak ada yang tertulis.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_device_code  text := 'RFID-TRIAL-01';
  v_device_token text := 'ganti-token-ini';   -- ← GANTI sebelum dijalankan

  v_date  date := ((now() AT TIME ZONE 'Asia/Jakarta') - interval '6 hours')::date;
  v_key   text := to_char(v_date, 'YYYYMMDD');
  v_plant bigint; v_plant_code text; v_fg bigint; v_stage bigint;
  v_cust  bigint; v_del bigint; v_part bigint; v_map bigint;
  v_sfx   text; v_doc text;
  it record;
BEGIN
  IF v_device_token = 'ganti-token-ini' THEN
    RAISE EXCEPTION 'Ganti v_device_token dulu di bagian atas file.';
  END IF;

  SELECT "INT_ID", "CHR_CODE" INTO v_plant, v_plant_code FROM org."TM_PLANT"
   ORDER BY (upper("CHR_CODE") = 'BODY') DESC, "INT_ID" LIMIT 1;
  IF v_plant IS NULL THEN RAISE EXCEPTION 'Belum ada plant.'; END IF;
  SELECT "INT_ID" INTO v_fg FROM inventory."TM_LOCATION"
   WHERE "INT_PLANT_ID" = v_plant AND "CHR_KIND" = 'FINISH_GOOD' ORDER BY "INT_ID" LIMIT 1;
  SELECT "INT_ID" INTO v_stage FROM inventory."TM_LOCATION"
   WHERE "INT_PLANT_ID" = v_plant AND "CHR_KIND" = 'STAGING' ORDER BY "INT_ID" LIMIT 1;
  IF v_fg IS NULL OR v_stage IS NULL THEN
    RAISE EXCEPTION 'Plant % belum punya SLOC FINISH_GOOD dan STAGING.', v_plant_code;
  END IF;

  SELECT "INT_ID" INTO v_cust FROM master."TM_CUST" WHERE "CHR_CUST_NO" = 'TRIAL-RFID' LIMIT 1;
  IF v_cust IS NULL THEN
    INSERT INTO master."TM_CUST"
      ("CHR_CUST_NO", "CHR_CUST_NAME", "CHR_DOCK", "CHR_PART_NUMBER_FORMAT", "FLG_DIRECT_KANBAN")
    VALUES ('TRIAL-RFID', 'CUSTOMER DUMMY RFID', 'DOCK RFID', 'NONE', false)
    RETURNING "INT_ID" INTO v_cust;
  END IF;

  -- Nomor urut berikutnya hari ini; advisory lock supaya dua orang tidak dapat nomor sama.
  PERFORM pg_advisory_xact_lock(hashtextextended('seed-rfid-trial', 0));
  SELECT v_key || '-' || lpad((coalesce(max(substring("CHR_DEL_NO" FROM '-(\d+)$')::int), 0) + 1)::text, 2, '0')
    INTO v_sfx FROM logistics."TT_DELIVERY" WHERE "CHR_DEL_NO" LIKE 'LL-RFID-' || v_key || '-%';
  v_doc := 'LL-RFID-' || v_sfx;

  INSERT INTO logistics."TT_DELIVERY"
    ("INT_PLANT_ID", "INT_CUSTOMER_ID", "CHR_DEL_NO", "CHR_DOK_NO", "CHR_PDS_NO", "DTM_DEL_DATE",
     "INT_CYCLE", "CHR_CUS_DEST", "DTM_PLAN_TIME", "INT_LOCATION_ID", "INT_STAGING_LOCATION_ID",
     "CHR_STATUS", "CHR_TRUCK_STATUS")
  VALUES (v_plant, v_cust, v_doc, 'MNF-RFID-' || v_sfx, 'PDS-RFID-' || v_sfx, v_date,
     1, 'DOCK RFID', '13:00:00', v_fg, v_stage, 'DRAFT', 'ARRIVED')
  RETURNING "INT_ID" INTO v_del;

  FOR it IN SELECT * FROM (VALUES ('A', 20, 3, 10), ('B', 10, 2, 20)) AS t(letter, per_box, kanban, item_no) LOOP
    INSERT INTO master."TM_PARTS"
      ("INT_PLANT_ID", "CHR_PART_NO", "CHR_PART_NAME", "CHR_BACK_NO", "CHR_PROCESS_TYPE",
       "CHR_PART_TYPE", "CHR_TRACKING_MODE", "CHR_PART_UOM", "INT_QTY_PER_BOX")
    VALUES (v_plant, 'TR-RFID-' || it.letter || '-' || v_sfx, 'PART RFID TRIAL ' || it.letter, 'RF' || it.letter,
       CASE WHEN upper(v_plant_code) = 'BODY' THEN 'ASSEMBLING_BODY_FG' ELSE 'ASSEMBLING_UNIT_FG' END,
       'FINISHED_GOOD', 'QUANTITY', 'PC', it.per_box)
    RETURNING "INT_ID" INTO v_part;

    -- Format NONE: customerPart di tag RFID = nomor ini apa adanya.
    INSERT INTO master."TM_SHIPPING_PARTS"
      ("INT_PART_ID", "INT_CUSTOMER_ID", "CHR_CUS_PART_NO", "CHR_CUS_BACK_NO", "INT_QTY_PER_BOX")
    VALUES (v_part, v_cust, 'C-TR-RFID-' || it.letter || '-' || v_sfx, 'RF' || it.letter, it.per_box)
    RETURNING "INT_ID" INTO v_map;

    INSERT INTO logistics."TT_DELIVERY_ITEM"
      ("INT_DELIVERY_ID", "INT_PART_ID", "INT_CUSTOMER_PART_ID", "CHR_CUST_PART_NO", "CHR_DEL_ITEM",
       "INT_DEL_QTY", "INT_PLANNED_KANBAN", "INT_TOTAL_QTY", "INT_QTY_PER_BOX")
    VALUES (v_del, v_part, v_map, 'C-TR-RFID-' || it.letter || '-' || v_sfx, lpad(it.item_no::text, 6, '0'),
       it.per_box * it.kanban, it.kanban, it.per_box * it.kanban, it.per_box);
  END LOOP;

  INSERT INTO org."TM_DEVICE" ("CHR_CODE", "CHR_NAME", "INT_PLANT_ID", "CHR_KIND", "CHR_TOKEN_HASH")
  VALUES (v_device_code, 'RFID READER TRIAL', v_plant, 'RFID', crypt(v_device_token, gen_salt('bf', 10)))
  ON CONFLICT ("CHR_CODE") DO UPDATE SET
    "INT_PLANT_ID" = EXCLUDED."INT_PLANT_ID", "CHR_KIND" = 'RFID', "FLG_IS_ACTIVE" = true,
    "CHR_TOKEN_HASH" = EXCLUDED."CHR_TOKEN_HASH", "DTM_UPDATED_AT" = now();
END $$;

-- Hasil untuk Postman: loading list trial terbaru beserta part-nya.
SELECT d."INT_ID" AS "deliveryId", d."CHR_DEL_NO" AS "documentCode", d."CHR_DOK_NO" AS manifest,
       i."CHR_CUST_PART_NO" AS "customerPart", i."INT_PLANNED_KANBAN" AS "plannedKanban",
       (SELECT "CHR_CODE" FROM org."TM_DEVICE" WHERE "CHR_NAME" = 'RFID READER TRIAL'
         ORDER BY "DTM_UPDATED_AT" DESC LIMIT 1) AS "deviceCode"
  FROM logistics."TT_DELIVERY" d
  JOIN logistics."TT_DELIVERY_ITEM" i ON i."INT_DELIVERY_ID" = d."INT_ID"
 WHERE d."INT_ID" = (SELECT max("INT_ID") FROM logistics."TT_DELIVERY" WHERE "CHR_DEL_NO" LIKE 'LL-RFID-%')
 ORDER BY i."INT_ID";
