import { eq, asc } from 'drizzle-orm';
import {
  katalogProses,
  type GrupProses,
  type JenisProses,
  type KatalogProses,
} from '@avicenna/contracts';
import { processGroups, processTypes } from './schema/index';
import type { Database } from './client';

/**
 * Membaca katalog jenis proses dari master.
 *
 * Satu-satunya pintu ke TM_PROCESS_TYPE untuk kode yang butuh kosakatanya.
 * Dipakai skrip (seed, selaraskan) dan layanan API yang menyimpannya di
 * memori — lihat ProcessTypeService.
 *
 * `termasukNonaktif` dibutuhkan pembaca RIWAYAT: proses yang dinonaktifkan
 * hari ini tetap ada di scan tahun lalu, dan laporan yang tidak bisa menyebut
 * namanya akan menampilkan kode mentah kepada orang yang tidak mengenalnya.
 * Yang menyusun rute baru tidak boleh melihatnya — itulah guna `daftar`, yang
 * hanya memuat yang aktif.
 */
export async function bacaKatalogProses(
  db: Database,
  opsi: { termasukNonaktif?: boolean } = {},
): Promise<KatalogProses> {
  const q = db
    .select({
      code: processTypes.code,
      label: processTypes.label,
      processGroup: processTypes.processGroup,
      sapClass: processTypes.sapClass,
      scanMode: processTypes.scanMode,
      sortOrder: processTypes.sortOrder,
      isActive: processTypes.isActive,
    })
    .from(processTypes)
    .orderBy(asc(processTypes.sortOrder), asc(processTypes.code));

  const baris = opsi.termasukNonaktif ? await q : await q.where(eq(processTypes.isActive, true));
  // Grup selalu dibaca utuh: katalog sendiri yang memisahkan yang aktif.
  const grup = await db
    .select({
      code: processGroups.code,
      label: processGroups.label,
      sortOrder: processGroups.sortOrder,
      isActive: processGroups.isActive,
    })
    .from(processGroups)
    .orderBy(asc(processGroups.sortOrder), asc(processGroups.code));
  return katalogProses(baris as JenisProses[], grup as GrupProses[]);
}
