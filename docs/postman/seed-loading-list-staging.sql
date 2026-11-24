-- ─────────────────────────────────────────────────────────────────────────────
-- Data dummy loading list di DB staging SAP (A_DB_STG, MSSQL) — sumber asli
-- GET /loading. Dipakai kalau yang mau diuji seluruh jalurnya:
--
--   staging → POST /staging/pull-delivery → TT_DELIVERY kita → GET /loading
--
-- Bedanya dengan seed-loading-list.sql (yang menulis langsung ke Postgres):
-- staging HANYA punya header dan rencana per item. Status dokumen, truckStatus,
-- pickedKanban, dan actualKanban tidak ada kolomnya di sini — itu milik MES.
-- Jadi semua dokumen hasil tarik selalu masuk sebagai DRAFT / PENDING / 0.
-- Untuk menguji baris berstatus macam-macam, pakai seed-loading-list.sql.
--
-- Cara pakai (A_DB_STG di 172.18.3.19):
--   sqlcmd -S 172.18.3.19 -U sa -P <pw> -d A_DB_STG -i seed-loading-list-staging.sql
--
-- Lalu tarik ke MES:
--   POST /staging/pull-delivery                            (uji coba, tidak menulis)
--   POST /staging/pull-delivery?uji=false                  (tanggal operasional hari ini)
--   POST /staging/pull-delivery?date=<kemarin>&uji=false   (buat dokumen 9900000006)
--
-- uji=false hanya menulis kalau STAGING_PULL_ENABLED=true. Controller tidak
-- pernah mengirim flag `manual`, jadi tanpa itu hasilnya selalu
-- "STAGING_PULL_ENABLED masih false". Nyalakan untuk satu proses saja, jangan
-- diubah di .env:   STAGING_PULL_ENABLED=true node dist/main.js
--
-- Dijalankan ulang = reset: semua CHR_DEL_NO '99%' dihapus lebih dulu. Nomor 99
-- dipilih supaya tidak pernah bertabrakan dengan nomor DN asli SAP (22xxxxxxxx).
--
-- PRASYARAT di master MES (sudah dibuat seed-loading-list.sql):
--   customer DUMMY-LL, part DM-LL-A (termapping) dan DM-LL-B (sengaja TIDAK
--   termapping). Tanpa itu pull melewati dokumennya dengan catatan
--   "customer ... belum ada di master" / "part staging yang belum masuk master".
-- ─────────────────────────────────────────────────────────────────────────────

SET NOCOUNT ON;

-- Jam A_DB_STG adalah UTC, bukan WIB — GETDATE() di sini 7 jam di belakang
-- jam API, dan di pagi hari memberi TANGGAL YANG SALAH. Tanggal operasional
-- karena itu dihitung di zona Jakarta dulu, baru digeser 6 jam seperti
-- DELIVERY_DAY_START_HOUR di MES.
DECLARE @jkt datetime2 = SYSDATETIMEOFFSET() AT TIME ZONE 'SE Asia Standard Time';
DECLARE @hari    char(8) = CONVERT(char(8), DATEADD(hour,  -6, @jkt), 112);
DECLARE @kemarin char(8) = CONVERT(char(8), DATEADD(hour, -30, @jkt), 112);

BEGIN TRAN;

-- Reset. Item dulu: tidak ada ON DELETE CASCADE di staging.
DELETE FROM TT_DELIVERY_ITEM WHERE CHR_DEL_NO LIKE '99%';
DELETE FROM TT_DELIVERY      WHERE CHR_DEL_NO LIKE '99%';

-- Header. CHR_DEL_NO char(10), CHR_DOK_NO char(10), CHR_CUS_NO char(10) — pas-pasan,
-- jangan dipanjangkan. CHR_CYCLE memakai format SAP '1-' (dibaca normalizeDeliveryCycle).
INSERT INTO TT_DELIVERY
  (CHR_DEL_NO, CHR_CUS_NO, CHR_CUS_DEST, CHR_DOK_NO, CHR_PDS_NO, CHR_CYCLE, CHR_DEL_DATE,
   CHR_PO_NO, CHR_CREATE_DATE, CHR_SORG, CHR_DIS_CHANNEL, CHR_DIVISION, CHR_DEL_TYPE,
   CHR_GI_DEL, CHR_QC_STATUS, CHR_DELETE_FLAG)
VALUES
  ('9900000001', 'DUMMY-LL', '0051-01', 'DOK-DUM-1', 'PDS DUMMY 01', '1-', @hari,
   'PO DUMMY 01', @hari, 'J922', 'C5', '01', 'ZD1A', NULL, '0', NULL),
  ('9900000002', 'DUMMY-LL', '0051-01', 'DOK-DUM-2', 'PDS DUMMY 02', '2-', @hari,
   'PO DUMMY 02', @hari, 'J922', 'C5', '01', 'ZD1A', NULL, '0', NULL),
  ('9900000003', 'DUMMY-LL', '0051-02', 'DOK-DUM-3', 'PDS DUMMY 03', '1-', @hari,
   'PO DUMMY 03', @hari, 'J922', 'C5', '01', 'ZD1A', NULL, '0', NULL),
  -- GI sudah jalan di SAP: sapGiStatus ikut tertarik, bukan null.
  ('9900000004', 'DUMMY-LL', '0051-02', 'DOK-DUM-4', 'PDS DUMMY 04', '3-', @hari,
   'PO DUMMY 04', @hari, 'J922', 'C5', '01', 'ZD1A', 'A',  '0', NULL),
  ('9900000005', 'DUMMY-LL', '0051-01', 'DOK-DUM-5', 'PDS DUMMY 05', '1-', @hari,
   'PO DUMMY 05', @hari, 'J922', 'C5', '01', 'ZD1A', NULL, '0', NULL),
  -- Tanggal kemarin: pull menyaring CHR_DEL_DATE = satu tanggal, jadi dokumen ini
  -- baru masuk kalau ?date=<kemarin> disebut. Sekaligus bahan uji ?all=1 di list.
  ('9900000006', 'DUMMY-LL', '0051-01', 'DOK-DUM-6', 'PDS DUMMY 06', '1-', @kemarin,
   'PO DUMMY 06', @kemarin, 'J922', 'C5', '01', 'ZD1A', NULL, '0', NULL);

-- Item. plannedKanban di MES = INT_TOTAL_QTY / INT_QTY_PER_BOX.
INSERT INTO TT_DELIVERY_ITEM
  (CHR_DEL_NO, CHR_DEL_ITEM, CHR_PART_NO, CHR_CUST_PART_NO, INT_TOTAL_QTY, INT_DEL_QTY,
   CHR_PART_NAME, INT_SCAN_QTY, INT_QTY_PER_BOX, CHR_ITEM_TYPE, CHR_DELETE_FLAG, INT_ACTUAL_DEL)
VALUES
  -- 01: satu part, bersih — 5 kanban × 20.
  ('9900000001', '000010', 'DM-LL-A', 'C-DM-LL-A', 100, 100, 'PART DUMMY LOADING LIST A', 0, 20, 'Y', NULL, 0),

  -- 02: dua part. DM-LL-B tidak punya baris TM_SHIPPING_PARTS, jadi customerPartId
  -- NULL → unmappedItems 1 → attentionReason 'Part customer belum termapping'.
  ('9900000002', '000010', 'DM-LL-A', 'C-DM-LL-A',  60,  60, 'PART DUMMY LOADING LIST A', 0, 20, 'Y', NULL, 0),
  ('9900000002', '000020', 'DM-LL-B', 'C-DM-LL-B',  20,  20, 'PART DUMMY LOADING LIST B', 0, 10, 'Y', NULL, 0),

  -- 03: INT_QTY_PER_BOX 0 dari SAP. CATATAN: ini TIDAK menghasilkan attentionReason
  -- 'Qty per box belum lengkap' — pull menambal nol itu dari qtyPerKanban di
  -- TM_SHIPPING_PARTS, jadi hasilnya 80/20 = 4 kanban yang bersih. Untuk menguji
  -- baris cacat itu, pakai LL-DUMMY-…-05 di seed-loading-list.sql.
  ('9900000003', '000010', 'DM-LL-A', 'C-DM-LL-A',  80,  80, 'PART DUMMY LOADING LIST A', 0,  0, 'Y', NULL, 0),

  -- 04: GI sudah 'A' di header.
  ('9900000004', '000010', 'DM-LL-A', 'C-DM-LL-A',  40,  40, 'PART DUMMY LOADING LIST A', 0, 20, 'Y', NULL, 0),

  -- 05: part yang sama pada dua nomor item SAP — sah, dan sering terjadi.
  ('9900000005', '000010', 'DM-LL-A', 'C-DM-LL-A',  40,  40, 'PART DUMMY LOADING LIST A', 0, 20, 'Y', NULL, 0),
  ('9900000005', '000020', 'DM-LL-A', 'C-DM-LL-A',  20,  20, 'PART DUMMY LOADING LIST A', 0, 20, 'Y', NULL, 0),

  -- 06: tanggal kemarin.
  ('9900000006', '000010', 'DM-LL-A', 'C-DM-LL-A', 100, 100, 'PART DUMMY LOADING LIST A', 0, 20, 'Y', NULL, 0);

COMMIT;

-- Ringkasan: yang harus terbaca oleh pull.
SELECT RTRIM(h.CHR_DEL_NO) AS delNo, RTRIM(h.CHR_CUS_NO) AS cust, h.CHR_DEL_DATE AS tanggal,
       RTRIM(h.CHR_CYCLE) AS cycle, ISNULL(RTRIM(h.CHR_GI_DEL), '-') AS giFlag,
       COUNT(*) AS items, SUM(l.INT_TOTAL_QTY) AS totalQty,
       SUM(CASE WHEN l.INT_QTY_PER_BOX > 0 THEN l.INT_TOTAL_QTY / l.INT_QTY_PER_BOX ELSE 0 END)
         AS plannedKanban
  FROM TT_DELIVERY h
  JOIN TT_DELIVERY_ITEM l ON l.CHR_DEL_NO = h.CHR_DEL_NO
 WHERE h.CHR_DEL_NO LIKE '99%'
 GROUP BY h.CHR_DEL_NO, h.CHR_CUS_NO, h.CHR_DEL_DATE, h.CHR_CYCLE, h.CHR_GI_DEL
 ORDER BY delNo;
