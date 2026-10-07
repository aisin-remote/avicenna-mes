ALTER TABLE `TM_ROUTE_PROCESS` MODIFY COLUMN `CHR_SCAN_MODE` enum('PART_SAJA','PART_KANBAN','KANBAN_BOX','PART_TANPA_KANBAN','PART_PINDAH_KARTU','PER_PIECE','PER_KANBAN') NOT NULL DEFAULT 'PART_SAJA';--> statement-breakpoint
-- Baris yang ada diisi metode EKSPLISIT yang sama persis dengan perilakunya
-- sekarang, supaya tidak ada satu lini pun yang berubah cara scan-nya karena
-- migrasi ini. Yang dulu PER_PIECE berarti dua hal berbeda: kanban wajib di
-- lini yang menghasilkan barang jadi, dilarang di lini WIP.
UPDATE `TM_ROUTE_PROCESS`
SET `CHR_SCAN_MODE` = 'KANBAN_BOX'
WHERE `CHR_SCAN_MODE` = 'PER_KANBAN';
--> statement-breakpoint
UPDATE `TM_ROUTE_PROCESS`
SET `CHR_SCAN_MODE` = 'PART_KANBAN'
WHERE `CHR_SCAN_MODE` = 'PER_PIECE'
  AND `CHR_PROCESS_TYPE` IN ('CASTING_FG', 'MACHINING_FG', 'ASSEMBLING_UNIT', 'ASSEMBLING_BODY');
--> statement-breakpoint
UPDATE `TM_ROUTE_PROCESS`
SET `CHR_SCAN_MODE` = 'PART_SAJA'
WHERE `CHR_SCAN_MODE` = 'PER_PIECE';
