ALTER TABLE `TM_ROUTE_PROCESS` ADD `CHR_SCAN_MODE` enum('PER_PIECE','PER_KANBAN') DEFAULT 'PER_PIECE' NOT NULL;--> statement-breakpoint
-- Baris yang SUDAH ADA mengikuti bawaan per jenis proses (modeScanBawaan di
-- contracts). Tanpa ini, tiga proses BODY yang tersemai kemarin lahir sebagai
-- PER_PIECE — dan scan pertama di injection ditolak "lini ini tidak memakai
-- kanban", persis kebalikan dari cara kerja BODY.
UPDATE `TM_ROUTE_PROCESS` SET `CHR_SCAN_MODE` = 'PER_KANBAN'
WHERE `CHR_PROCESS_TYPE` IN ('INJECTION', 'PAINTING', 'ASSEMBLING_BODY');
