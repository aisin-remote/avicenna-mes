-- ─────────────────────────────────────────────────────────────────────────────
-- Data dummy untuk GET /loading (list loading list).
--
--   docker exec -i avicenna-postgres psql -U avicenna -d avicenna < seed-loading-list.sql
--
-- Membuat 6 loading list LL-DUMMY-<tanggal>-NN yang masing-masing menguji satu
-- cabang dari endpoint list: status, truckStatus, filter tanggal, pencarian q,
-- dan attentionReason. Dijalankan ulang = reset (LL-DUMMY-% dihapus lebih dulu),
-- jadi aman dipakai berkali-kali. Master part/customer dummy dipakai bersama.
--
-- Yang bisa diuji setelahnya (GET /loading, pakai Bearer token):
--   ?perPage=10                  → 5 dokumen hari ini (-01..-05), -06 tidak ikut
--   ?all=1                       → 6 dokumen, -06 (hari lalu) ikut
--   ?date=<kemarin>              → hanya -06
--   ?q=DUMMY LOADING             → cocok lewat nama customer
--   ?q=LL-DUMMY                  → cocok lewat nomor dokumen; PDS & manifest juga
--   ?attention=only              → -03 (pulling kurang) dan -05 (qty per box 0)
--   ?perPage=2&page=2            → paginasi; urutan deliveryDate lalu id, menurun
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_date  date := ((now() AT TIME ZONE 'Asia/Jakarta') - interval '6 hours')::date;
  v_key   text;
  v_plant bigint; v_plant_code text; v_fg bigint; v_stage bigint;
  v_cust bigint; v_part_a bigint; v_part_b bigint; v_map_a bigint;
  v_del bigint; v_doc text;
  s record;
BEGIN
  v_key := to_char(v_date, 'YYYYMMDD');

  SELECT "INT_ID", "CHR_CODE" INTO v_plant, v_plant_code FROM org."TM_PLANT"
   ORDER BY (upper("CHR_CODE") = 'BODY') DESC, "INT_ID" LIMIT 1;
  IF v_plant IS NULL THEN RAISE EXCEPTION 'Belum ada plant. Jalankan db:seed dulu.'; END IF;

  SELECT "INT_ID" INTO v_fg FROM inventory."TM_LOCATION"
   WHERE "INT_PLANT_ID" = v_plant AND "CHR_KIND" = 'FINISH_GOOD' ORDER BY "INT_ID" LIMIT 1;
  SELECT "INT_ID" INTO v_stage FROM inventory."TM_LOCATION"
   WHERE "INT_PLANT_ID" = v_plant AND "CHR_KIND" = 'STAGING' ORDER BY "INT_ID" LIMIT 1;
  IF v_fg IS NULL OR v_stage IS NULL THEN
    RAISE EXCEPTION 'Plant % belum punya SLOC FINISH_GOOD dan STAGING.', v_plant_code;
  END IF;

  -- Nama customer dipakai menguji ?q= (cocok lewat nama, bukan hanya nomor dokumen).
  SELECT "INT_ID" INTO v_cust FROM master."TM_CUST" WHERE "CHR_CUST_NO" = 'DUMMY-LL' LIMIT 1;
  IF v_cust IS NULL THEN
    INSERT INTO master."TM_CUST"
      ("CHR_CUST_NO", "CHR_CUST_NAME", "CHR_DOCK", "CHR_PART_NUMBER_FORMAT", "FLG_DIRECT_KANBAN")
    VALUES ('DUMMY-LL', 'CUSTOMER DUMMY LOADING LIST', 'DOCK DUMMY', 'NONE', false)
    RETURNING "INT_ID" INTO v_cust;
  END IF;

  -- Part A termapping (normal); part B sengaja tanpa mapping, untuk baris cacat.
  SELECT "INT_ID" INTO v_part_a FROM master."TM_PARTS"
   WHERE "INT_PLANT_ID" = v_plant AND "CHR_PART_NO" = 'DM-LL-A' LIMIT 1;
  IF v_part_a IS NULL THEN
    INSERT INTO master."TM_PARTS"
      ("INT_PLANT_ID", "CHR_PART_NO", "CHR_PART_NAME", "CHR_BACK_NO", "CHR_PROCESS_TYPE",
       "CHR_PART_TYPE", "CHR_TRACKING_MODE", "CHR_PART_UOM", "INT_QTY_PER_BOX")
    VALUES (v_plant, 'DM-LL-A', 'PART DUMMY LOADING LIST A', 'DLA',
       CASE WHEN upper(v_plant_code) = 'BODY' THEN 'ASSEMBLING_BODY_FG' ELSE 'ASSEMBLING_UNIT_FG' END,
       'FINISHED_GOOD', 'QUANTITY', 'PC', 20)
    RETURNING "INT_ID" INTO v_part_a;
  END IF;

  SELECT "INT_ID" INTO v_part_b FROM master."TM_PARTS"
   WHERE "INT_PLANT_ID" = v_plant AND "CHR_PART_NO" = 'DM-LL-B' LIMIT 1;
  IF v_part_b IS NULL THEN
    INSERT INTO master."TM_PARTS"
      ("INT_PLANT_ID", "CHR_PART_NO", "CHR_PART_NAME", "CHR_BACK_NO", "CHR_PROCESS_TYPE",
       "CHR_PART_TYPE", "CHR_TRACKING_MODE", "CHR_PART_UOM", "INT_QTY_PER_BOX")
    VALUES (v_plant, 'DM-LL-B', 'PART DUMMY LOADING LIST B', 'DLB',
       CASE WHEN upper(v_plant_code) = 'BODY' THEN 'ASSEMBLING_BODY_FG' ELSE 'ASSEMBLING_UNIT_FG' END,
       'FINISHED_GOOD', 'QUANTITY', 'PC', 10)
    RETURNING "INT_ID" INTO v_part_b;
  END IF;

  SELECT "INT_ID" INTO v_map_a FROM master."TM_SHIPPING_PARTS"
   WHERE "INT_PART_ID" = v_part_a AND "INT_CUSTOMER_ID" = v_cust LIMIT 1;
  IF v_map_a IS NULL THEN
    INSERT INTO master."TM_SHIPPING_PARTS"
      ("INT_PART_ID", "INT_CUSTOMER_ID", "CHR_CUS_PART_NO", "CHR_CUS_BACK_NO", "INT_QTY_PER_BOX")
    VALUES (v_part_a, v_cust, 'C-DM-LL-A', 'DLA', 20)
    RETURNING "INT_ID" INTO v_map_a;
  END IF;

  -- Reset: baris lama dibuang dulu, item ikut terhapus lewat ON DELETE CASCADE.
  DELETE FROM logistics."TT_DELIVERY" WHERE "CHR_DEL_NO" LIKE 'LL-DUMMY-%';

  FOR s IN SELECT * FROM (VALUES
    --  nn    status     truk      hari plan pick act cyc  cacat
    ('01', 'DRAFT',   'PENDING',   0,  5,  0,  0,  1, false),  -- baseline, attentionReason null
    ('02', 'PICKING', 'ARRIVED',   0,  5,  3,  0,  1, false),  -- pulling sedang jalan
    ('03', 'PICKED',  'ARRIVED',   0,  5,  3,  0,  2, false),  -- 'Pulling selesai dengan kekurangan'
    ('04', 'SHIPPED', 'DEPARTED',  0,  5,  5,  5,  1, false),  -- selesai bersih
    ('05', 'DRAFT',   'PENDING',   0,  4,  0,  0,  1, true ),  -- qty per box 0 + part belum mapping + SLOC kosong
    ('06', 'DRAFT',   'PENDING',  -1,  5,  0,  0,  1, false)   -- hari lalu: muncul hanya dgn ?date= / ?all=1
  ) AS t(nn, status, truck, day_offset, planned, picked, actual, cycle, broken) LOOP

    v_doc := 'LL-DUMMY-' || v_key || '-' || s.nn;

    INSERT INTO logistics."TT_DELIVERY"
      ("INT_PLANT_ID", "INT_CUSTOMER_ID", "CHR_DEL_NO", "CHR_DOK_NO", "CHR_PDS_NO", "CHR_PO_NO",
       "CHR_DEL_TYPE", "DTM_DEL_DATE", "INT_CYCLE", "CHR_CUS_DEST", "DTM_PLAN_TIME",
       "INT_LOCATION_ID", "INT_STAGING_LOCATION_ID", "CHR_STATUS", "CHR_TRUCK_STATUS",
       "CHR_TRUCK_NUMBER", "CHR_DRIVER_NAME", "DTM_ARRIVED_AT", "DTM_DEPARTED_AT")
    VALUES (v_plant, v_cust, v_doc,
       'MNF-DUMMY-' || v_key || '-' || s.nn, 'PDS-DUMMY-' || v_key || '-' || s.nn,
       'PO-DUMMY-' || s.nn, 'LF', v_date + s.day_offset, s.cycle, 'DOCK DUMMY', '13:00:00',
       -- Skenario cacat: SLOC dikosongkan supaya missingSloc ikut teruji.
       CASE WHEN s.broken THEN NULL ELSE v_fg END,
       CASE WHEN s.broken THEN NULL ELSE v_stage END,
       s.status, s.truck, 'B 1234 DUM', 'DRIVER DUMMY ' || s.nn,
       CASE WHEN s.truck IN ('ARRIVED', 'LOADING', 'DEPARTED') THEN now() - interval '3 hours' END,
       CASE WHEN s.truck = 'DEPARTED' THEN now() - interval '1 hour' END)
    RETURNING "INT_ID" INTO v_del;

    IF s.broken THEN
      -- Dua baris cacat: qty per box 0, dan part customer belum termapping.
      INSERT INTO logistics."TT_DELIVERY_ITEM"
        ("INT_DELIVERY_ID", "INT_PART_ID", "INT_CUSTOMER_PART_ID", "CHR_CUST_PART_NO",
         "CHR_DEL_ITEM", "INT_DEL_QTY", "INT_PLANNED_KANBAN", "INT_TOTAL_QTY", "INT_QTY_PER_BOX",
         "INT_PICKED_KANBAN", "INT_ACTUAL_KANBAN")
      VALUES
        (v_del, v_part_a, v_map_a, 'C-DM-LL-A', '000010', 40, 2, 40,  0, 0, 0),
        (v_del, v_part_b, NULL,    'C-DM-LL-B', '000020', 20, 2, 20, 10, 0, 0);
    ELSE
      INSERT INTO logistics."TT_DELIVERY_ITEM"
        ("INT_DELIVERY_ID", "INT_PART_ID", "INT_CUSTOMER_PART_ID", "CHR_CUST_PART_NO",
         "CHR_DEL_ITEM", "INT_DEL_QTY", "INT_PLANNED_KANBAN", "INT_TOTAL_QTY", "INT_QTY_PER_BOX",
         "INT_PICKED_KANBAN", "INT_SCAN_QTY", "INT_ACTUAL_KANBAN", "INT_ACTUAL_DEL")
      VALUES (v_del, v_part_a, v_map_a, 'C-DM-LL-A', '000010',
         s.planned * 20, s.planned, s.planned * 20, 20,
         s.picked, s.picked * 20, s.actual, s.actual * 20);
    END IF;
  END LOOP;
END $$;

-- Ringkasan: persis angka yang harus muncul di GET /loading.
SELECT d."CHR_DEL_NO" AS "documentNumber", d."DTM_DEL_DATE" AS "deliveryDate",
       d."CHR_STATUS" AS status, d."CHR_TRUCK_STATUS" AS "truckStatus", d."INT_CYCLE" AS cycle,
       sum(i."INT_PLANNED_KANBAN") AS "plannedKanban",
       sum(i."INT_PICKED_KANBAN")  AS "pickedKanban",
       sum(i."INT_ACTUAL_KANBAN")  AS "actualKanban",
       count(*) FILTER (WHERE i."INT_CUSTOMER_PART_ID" IS NULL) AS "unmappedItems",
       count(*) FILTER (WHERE i."INT_QTY_PER_BOX" <= 0)         AS "invalidQtyPerBox",
       (d."INT_LOCATION_ID" IS NULL OR d."INT_STAGING_LOCATION_ID" IS NULL) AS "missingSloc"
  FROM logistics."TT_DELIVERY" d
  JOIN logistics."TT_DELIVERY_ITEM" i ON i."INT_DELIVERY_ID" = d."INT_ID"
 WHERE d."CHR_DEL_NO" LIKE 'LL-DUMMY-%'
 GROUP BY d."INT_ID", d."CHR_DEL_NO", d."DTM_DEL_DATE", d."CHR_STATUS", d."CHR_TRUCK_STATUS",
          d."INT_CYCLE", d."INT_LOCATION_ID", d."INT_STAGING_LOCATION_ID"
 ORDER BY d."CHR_DEL_NO";
