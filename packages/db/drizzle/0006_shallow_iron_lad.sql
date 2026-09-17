-- Lingkup jenis NG dipindah dari JENIS proses ke GRUP proses.
--
-- "Crack" berlaku di lini Casting WIP maupun Casting FG; menyimpannya sebagai
-- CASTING_WIP membuat tombolnya hilang dari layar lini FG, dan orang di situ
-- tidak punya jenis NG apa pun untuk dipilih.
--
-- Nilai lama dipindahkan LEBIH DULU. Langsung DROP akan menghapus lingkup
-- setiap jenis NG yang sudah terdaftar tanpa jejak, dan semuanya berubah
-- menjadi "berlaku di semua proses" tanpa ada yang memintanya.
UPDATE `TM_NG` SET `CHR_PROCESS_GROUP` = CASE `CHR_PROCESS_TYPE`
  WHEN 'CASTING_WIP'     THEN 'CASTING'
  WHEN 'CASTING_FG'      THEN 'CASTING'
  WHEN 'MACHINING_WIP'   THEN 'MACHINING'
  WHEN 'MACHINING_FG'    THEN 'MACHINING'
  WHEN 'ASSEMBLING_UNIT' THEN 'ASSEMBLING'
  WHEN 'ASSEMBLING_BODY' THEN 'ASSEMBLING'
  WHEN 'MELTING'         THEN 'MELTING'
  WHEN 'INJECTION'       THEN 'INJECTION'
  WHEN 'PAINTING'        THEN 'PAINTING'
  WHEN 'DELIVERY'        THEN 'DELIVERY'
  ELSE NULL
END
WHERE `CHR_PROCESS_TYPE` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `TM_NG` DROP COLUMN `CHR_PROCESS_TYPE`;
