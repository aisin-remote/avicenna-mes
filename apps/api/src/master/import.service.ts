import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { eq, and, inArray, type Database } from '@avicenna/db';
import { getMasterTable } from '@avicenna/db';
import {
  ENTITY_DEFS,
  buildCreateSchema,
  kolomImpor,
  KUNCI_ALAMI,
  MAKS_BARIS_IMPOR,
  type MasterEntity,
  type KolomImpor,
  type BarisDitolak,
  type HasilImpor,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';

/** Baris pertama berkas adalah judul, jadi data pertama ada di baris 2. */
const BARIS_JUDUL = 1;

@Injectable()
export class MasterImportService {
  private readonly logger = new Logger(MasterImportService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  /* ──────────────────────────────────────────────────────────────────────────
   * TEMPLATE
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * Membuat berkas .xlsx kosong berisi judul kolom yang benar.
   *
   * Template disediakan, bukan dibiarkan orang mengarang sendiri. Berkas yang
   * dibuat dari nol hampir selalu salah di hal yang sama: judul kolom
   * diterjemahkan sendiri, kolom referensi diisi nama alih-alih kode, dan
   * kolom wajib hilang. Semuanya baru ketahuan setelah diunggah.
   */
  async template(entity: MasterEntity): Promise<Buffer> {
    const def = ENTITY_DEFS[entity];
    const kolom = kolomImpor(entity);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Avicenna MES';
    wb.created = new Date();

    const ws = wb.addWorksheet('Data');
    const bantuan = wb.addWorksheet('Petunjuk');

    /*
     * Lembar referensi disembunyikan, bukan dihapus.
     *
     * Daftar kode yang sah harus ada DI DALAM berkas supaya dropdown Excel
     * bisa menunjuknya. Dibiarkan terlihat, orang akan mengira itu bagian dari
     * data yang harus diisi.
     */
    const ref = wb.addWorksheet('_ref', { state: 'veryHidden' });

    ws.columns = kolom.map((k) => ({
      header: k.header,
      key: k.name,
      width: Math.max(14, Math.min(40, k.header.length + 6)),
    }));

    const judul = ws.getRow(BARIS_JUDUL);
    judul.font = { bold: true };
    judul.alignment = { vertical: 'middle' };
    judul.height = 22;

    // Kolom wajib ditandai di judulnya sendiri. Catatan di lembar lain terlalu
    // jauh dari tempat orang mengetik untuk benar-benar terbaca.
    kolom.forEach((k, i) => {
      const sel = judul.getCell(i + 1);
      sel.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: k.required ? 'FFFCE4E4' : 'FFEFEFEF' },
      };
      if (k.required) sel.value = `${k.header} *`;
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    await this.pasangPilihan(ws, ref, kolom, entity);

    /* ── Lembar petunjuk ─────────────────────────────────────────────────── */
    bantuan.columns = [
      { header: 'Kolom', width: 26 },
      { header: 'Wajib', width: 8 },
      { header: 'Isi', width: 70 },
    ];
    bantuan.getRow(1).font = { bold: true };
    bantuan.addRow([`TEMPLATE ${def.label.toUpperCase()}`, '', def.description]);
    bantuan.addRow([]);
    bantuan.addRow(['Aturan', '', 'Unggahan MENAMBAH baris baru. Baris yang kodenya sudah ada DITOLAK, tidak ditimpa.']);
    bantuan.addRow(['', '', 'Perubahan data yang sudah ada dilakukan lewat layar masternya, bukan lewat unggahan.']);
    bantuan.addRow(['', '', `Maksimal ${MAKS_BARIS_IMPOR} baris per berkas.`]);
    bantuan.addRow(['', '', 'Jangan mengubah judul kolom di lembar Data — judul itu yang dipakai mengenali kolom.']);
    bantuan.addRow([]);
    for (const k of kolom) {
      const isi: string[] = [];
      if (k.kind === 'reference') {
        isi.push(`Isi KODE ${ENTITY_DEFS[k.refEntity!].label.toLowerCase()}, bukan angka id.`);
      }
      if (k.options) isi.push(`Pilihan: ${k.options.join(', ')}`);
      if (k.kind === 'boolean') isi.push('Isi: YA atau TIDAK');
      if (k.kind === 'date') isi.push('Format: YYYY-MM-DD');
      if (k.hint) isi.push(k.hint);
      bantuan.addRow([k.header, k.required ? 'WAJIB' : '', isi.join(' ') || '—']);
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  /**
   * Memasang dropdown pada kolom pilihan dan kolom referensi.
   *
   * Dropdown mencegah kesalahan yang paling mahal untuk diperbaiki: kode yang
   * salah ketik lolos dari mata, tertolak saat diunggah, lalu orangnya
   * membetulkan satu per satu dari daftar galat alih-alih dari daftar pilihan.
   */
  private async pasangPilihan(
    ws: ExcelJS.Worksheet,
    ref: ExcelJS.Worksheet,
    kolom: KolomImpor[],
    entity: MasterEntity,
  ): Promise<void> {
    // Sampai baris ini saja dropdown dipasang. Cukup besar untuk master mana
    // pun di AIIA, dan tidak membuat berkasnya membengkak.
    const SAMPAI = 500;
    let kolomRef = 0;

    for (const [i, k] of kolom.entries()) {
      let nilai: string[] | undefined;

      if (k.kind === 'boolean') nilai = ['YA', 'TIDAK'];
      else if (k.options) nilai = [...k.options];
      else if (k.kind === 'reference' && k.refEntity) {
        nilai = await this.kodeReferensi(k.refEntity);
      }

      if (!nilai || nilai.length === 0) continue;

      /*
       * Daftar panjang ditaruh di lembar tersembunyi lalu ditunjuk dengan
       * rentang. Excel membatasi daftar yang ditulis langsung di rumus sekitar
       * 255 karakter — melewatinya membuat berkasnya dianggap rusak dan
       * DITOLAK saat dibuka, bukan sekadar kehilangan dropdown-nya.
       */
      kolomRef += 1;
      const huruf = ref.getColumn(kolomRef).letter;
      ref.getCell(`${huruf}1`).value = k.name;
      nilai.forEach((v, j) => {
        ref.getCell(`${huruf}${j + 2}`).value = v;
      });
      const rentang = `_ref!$${huruf}$2:$${huruf}$${nilai.length + 1}`;

      /*
       * Dipasang sebagai RENTANG, bukan sel per sel.
       *
       * Menyetel dataValidation tiap sel membuat 499 baris kosong benar-benar
       * terwujud di berkas: ukurannya membengkak, dan baris data yang
       * ditambahkan program lain mendarat di baris 501 — bukan baris 2.
       */
      const hurufKolom = ws.getColumn(i + 1).letter;
      /*
       * Cast: exceljs menyediakan dataValidations.add() saat berjalan tetapi
       * belum mendeklarasikannya di .d.ts miliknya. Sudah diperiksa langsung —
       * rentang tidak mewujudkan baris kosong, dan addRow tetap mendarat di
       * baris 2.
       */
      (ws as unknown as {
        dataValidations: { add: (r: string, v: ExcelJS.DataValidation) => void };
      }).dataValidations.add(`${hurufKolom}${BARIS_JUDUL + 1}:${hurufKolom}${SAMPAI}`, {
        type: 'list',
        allowBlank: !k.required,
        formulae: [rentang],
        showErrorMessage: true,
        errorTitle: 'Nilai tidak dikenal',
        error: 'Pilih dari daftar. Nilai lain akan ditolak saat diunggah.',
      });
    }
    this.logger.debug(`template ${entity}: ${kolomRef} kolom berdropdown`);
  }

  /** Kode yang sah untuk sebuah entitas referensi, untuk isi dropdown. */
  private async kodeReferensi(entity: MasterEntity): Promise<string[]> {
    const kunci = KUNCI_ALAMI[entity];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tabel = getMasterTable(entity) as any;
    const punyaAktif = ENTITY_DEFS[entity].fields.some((f) => f.name === 'isActive');

    const rows = await this.db
      .select()
      .from(tabel)
      .where(punyaAktif ? eq(tabel.isActive, true) : undefined)
      .limit(1000);

    return [
      ...new Set(
        rows
          .map((r: Record<string, unknown>) => r[kunci.kolom])
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    ].sort();
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * UNGGAH
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * Membaca berkas, memeriksa tiap baris, lalu menambah yang lolos.
   *
   * `ujiSaja` memeriksa tanpa menulis apa pun — layar memakainya untuk
   * menampilkan pratinjau sebelum orang menekan simpan. Unggahan master tanpa
   * pratinjau berarti kesalahan baru ketahuan setelah ratusan baris masuk.
   */
  async impor(entity: MasterEntity, berkas: Buffer, ujiSaja: boolean): Promise<HasilImpor> {
    const kolom = kolomImpor(entity);
    const wb = new ExcelJS.Workbook();

    try {
      await wb.xlsx.load(berkas as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException(
        'Berkas tidak bisa dibaca sebagai Excel (.xlsx). Pakai template yang disediakan.',
      );
    }

    // Lembar "Data" dipakai bila ada; kalau tidak, lembar pertama. Orang sering
    // menyalin data ke lembar baru dan menamainya sendiri.
    const ws = wb.getWorksheet('Data') ?? wb.worksheets[0];
    if (!ws) throw new BadRequestException('Berkas Excel tidak punya lembar apa pun.');

    const petaKolom = this.petakanJudul(ws, kolom);

    const ditolak: BarisDitolak[] = [];
    const siap: Array<{ baris: number; nilai: Record<string, unknown> }> = [];

    const totalBaris = Math.max(0, ws.actualRowCount - BARIS_JUDUL);
    if (totalBaris > MAKS_BARIS_IMPOR) {
      throw new BadRequestException(
        `Berkas berisi ${totalBaris} baris, melebihi batas ${MAKS_BARIS_IMPOR}. Pecah menjadi beberapa berkas.`,
      );
    }

    const skema = buildCreateSchema(entity);
    const refCache = new Map<string, Map<string, number>>();

    for (let nomor = BARIS_JUDUL + 1; nomor <= ws.rowCount; nomor += 1) {
      const row = ws.getRow(nomor);
      const mentah: Record<string, unknown> = {};
      let adaIsi = false;

      for (const k of kolom) {
        const idx = petaKolom.get(k.name);
        if (!idx) continue;
        const v = bacaSel(row.getCell(idx));
        if (v !== undefined && v !== '') adaIsi = true;
        mentah[k.name] = v;
      }

      // Baris kosong dilewati diam-diam: Excel sering menyimpan ratusan baris
      // kosong di bawah data, dan melaporkannya sebagai galat membuat daftar
      // penolakan penuh derau.
      if (!adaIsi) continue;

      const nilai = await this.terjemahkanReferensi(entity, kolom, mentah, refCache, nomor, ditolak);
      if (!nilai) continue;

      const hasil = skema.safeParse(nilai);
      if (!hasil.success) {
        /*
         * SELURUH galat baris dilaporkan, bukan yang pertama saja.
         *
         * Orang membetulkan berkas Excel sekaligus, lalu mengunggahnya lagi.
         * Melaporkan satu galat per baris berarti ia mengulang unggah sebanyak
         * jumlah kolom yang salah — dan tiap putaran terasa seperti sistem
         * menemukan masalah baru yang sebelumnya disembunyikan.
         *
         * Judulnya dipakai judul kolom Excel, bukan nama field: orang tidak
         * pernah melihat "partNumberFormat" di mana pun, yang ia lihat
         * "Format Part Number".
         */
        for (const i of hasil.error.issues) {
          const field = i.path.join('.');
          ditolak.push({
            baris: nomor,
            kolom: kolom.find((k) => k.name === field)?.header ?? field ?? null,
            sebab: i.message,
          });
        }
        continue;
      }

      siap.push({ baris: nomor, nilai: hasil.data as Record<string, unknown> });
    }

    await this.buangYangSudahAda(entity, siap, ditolak);

    let ditulis = 0;
    if (!ujiSaja && siap.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tabel = getMasterTable(entity) as any;
      /*
       * Satu transaksi untuk seluruh berkas.
       *
       * Unggahan yang separuh masuk adalah keadaan yang paling sulit
       * dibereskan: orang tidak tahu baris mana yang sudah ada, lalu
       * mengunggah ulang seluruhnya dan yang berhasil tadi ditolak sebagai
       * kembar. Semuanya masuk, atau tidak sama sekali.
       */
      await this.db.transaction(async (tx) => {
        for (const s of siap) {
          await tx.insert(tabel).values(s.nilai);
          ditulis += 1;
        }
      });
    }

    return {
      ujiSaja,
      totalBaris: siap.length + ditolak.length,
      diterima: siap.length,
      ditulis,
      ditolak: ditolak.sort((a, b) => a.baris - b.baris),
    };
  }

  /**
   * Mencocokkan judul kolom di berkas dengan kolom yang diharapkan.
   *
   * Dicocokkan dengan judulnya, BUKAN urutan kolom. Orang menyisipkan dan
   * memindah kolom di Excel tanpa merasa mengubah apa pun; kalau urutan yang
   * dipakai, seluruh data mendarat di kolom yang bergeser satu — dan setiap
   * barisnya terlihat sah.
   */
  private petakanJudul(ws: ExcelJS.Worksheet, kolom: KolomImpor[]): Map<string, number> {
    const judul = ws.getRow(BARIS_JUDUL);
    const peta = new Map<string, number>();
    const terlihat: string[] = [];

    judul.eachCell((sel, idx) => {
      const teks = String(sel.value ?? '').replace(/\*/g, '').trim().toLowerCase();
      if (!teks) return;
      terlihat.push(teks);
      const cocok = kolom.find((k) => k.header.toLowerCase() === teks || k.name.toLowerCase() === teks);
      if (cocok) peta.set(cocok.name, idx);
    });

    const wajibHilang = kolom.filter((k) => k.required && !peta.has(k.name));
    if (wajibHilang.length > 0) {
      throw new BadRequestException(
        `Kolom wajib tidak ada di berkas: ${wajibHilang.map((k) => k.header).join(', ')}. ` +
          'Pakai template yang disediakan, dan jangan mengubah judul kolomnya.',
      );
    }
    return peta;
  }

  /**
   * Mengganti kode referensi menjadi id.
   *
   * Referensi yang kodenya hanya unik per pabrik dicari DI DALAM pabrik baris
   * itu — "DC-01" di UNIT dan di BODY adalah dua lini berbeda, dan menautkan
   * ke yang keliru tidak terlihat sampai laporan per pabrik dibandingkan.
   */
  private async terjemahkanReferensi(
    entity: MasterEntity,
    kolom: KolomImpor[],
    mentah: Record<string, unknown>,
    cache: Map<string, Map<string, number>>,
    nomor: number,
    ditolak: BarisDitolak[],
  ): Promise<Record<string, unknown> | null> {
    const hasil: Record<string, unknown> = { ...mentah };

    // Pabrik diselesaikan lebih dulu; referensi lain bergantung padanya.
    const kolomPabrik = kolom.find((k) => k.refEntity === 'plants');
    let plantId: number | undefined;

    if (kolomPabrik) {
      const kode = teks(mentah[kolomPabrik.name]);
      if (kode) {
        plantId = (await this.petaKode('plants', undefined, cache)).get(kode.toUpperCase());
        if (!plantId) {
          ditolak.push({ baris: nomor, kolom: kolomPabrik.header, sebab: `Pabrik "${kode}" tidak ada` });
          return null;
        }
        hasil[kolomPabrik.name] = plantId;
      }
    }

    for (const k of kolom) {
      if (k.kind !== 'reference' || !k.refEntity || k.refEntity === 'plants') continue;
      const kode = teks(mentah[k.name]);
      if (!kode) {
        hasil[k.name] = undefined;
        continue;
      }

      const perPabrik = KUNCI_ALAMI[k.refEntity].perPabrik;
      if (perPabrik && !plantId) {
        ditolak.push({
          baris: nomor,
          kolom: k.header,
          sebab: `Pabrik harus diisi lebih dulu — kode ${ENTITY_DEFS[k.refEntity].label.toLowerCase()} hanya unik di dalam satu pabrik`,
        });
        return null;
      }

      const peta = await this.petaKode(k.refEntity, perPabrik ? plantId : undefined, cache);
      const id = peta.get(kode.toUpperCase());
      if (!id) {
        ditolak.push({
          baris: nomor,
          kolom: k.header,
          sebab: `${ENTITY_DEFS[k.refEntity].singular} "${kode}" tidak ada${perPabrik ? ' di pabrik ini' : ''}`,
        });
        return null;
      }
      hasil[k.name] = id;
    }

    // Boolean ditulis orang dalam bahasa manusia, bukan true/false.
    for (const k of kolom) {
      if (k.kind !== 'boolean') continue;
      const v = teks(mentah[k.name]);
      if (v === undefined) continue;
      hasil[k.name] = /^(ya|y|true|1|aktif)$/i.test(v);
    }

    void entity;
    return hasil;
  }

  /** Peta kode -> id untuk sebuah entitas, dicache per pemanggilan impor. */
  private async petaKode(
    entity: MasterEntity,
    plantId: number | undefined,
    cache: Map<string, Map<string, number>>,
  ): Promise<Map<string, number>> {
    const kunciCache = `${entity}|${plantId ?? '-'}`;
    const ada = cache.get(kunciCache);
    if (ada) return ada;

    const k = KUNCI_ALAMI[entity];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tabel = getMasterTable(entity) as any;

    const rows = await this.db
      .select()
      .from(tabel)
      .where(plantId ? eq(tabel.plantId, plantId) : undefined);

    const peta = new Map<string, number>();
    for (const r of rows as Array<Record<string, unknown>>) {
      const kode = r[k.kolom];
      if (typeof kode === 'string') peta.set(kode.toUpperCase(), Number(r.id));
    }
    cache.set(kunciCache, peta);
    return peta;
  }

  /**
   * Membuang baris yang kodenya SUDAH ADA di database.
   *
   * Inilah yang membuat unggahan "menambah, bukan menimpa". Diperiksa dalam
   * satu query untuk seluruh berkas, bukan satu per baris: berkas 500 baris
   * akan menghasilkan 500 perjalanan ke database, dan orangnya menunggu.
   */
  private async buangYangSudahAda(
    entity: MasterEntity,
    siap: Array<{ baris: number; nilai: Record<string, unknown> }>,
    ditolak: BarisDitolak[],
  ): Promise<void> {
    if (siap.length === 0) return;
    const k = KUNCI_ALAMI[entity];
    const kolomKunci = ENTITY_DEFS[entity].fields.find((f) => f.name === k.kolom);

    /*
     * Entitas tanpa kode sendiri (kanban, rute, BOM) dilewati di sini.
     *
     * Identitasnya gabungan beberapa kolom, dan menebak gabungan yang benar
     * lebih berbahaya daripada membiarkan database yang menolak: UNIQUE index
     * di sana sudah menjaganya, dan seluruh berkas dibatalkan bersama karena
     * penulisannya satu transaksi.
     */
    if (!kolomKunci || kolomKunci.kind === 'number' || kolomKunci.kind === 'decimal') return;

    const kode = siap
      .map((s) => s.nilai[k.kolom])
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (kode.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tabel = getMasterTable(entity) as any;
    const rows = await this.db
      .select()
      .from(tabel)
      .where(inArray(tabel[k.kolom], kode));

    const sudahAda = new Set(
      (rows as Array<Record<string, unknown>>).map(
        (r) => `${k.perPabrik ? r.plantId : '-'}|${String(r[k.kolom]).toUpperCase()}`,
      ),
    );

    for (let i = siap.length - 1; i >= 0; i -= 1) {
      const s = siap[i]!;
      const nilaiKode = s.nilai[k.kolom];
      if (typeof nilaiKode !== 'string') continue;
      const kunci = `${k.perPabrik ? s.nilai.plantId : '-'}|${nilaiKode.toUpperCase()}`;
      if (sudahAda.has(kunci)) {
        ditolak.push({
          baris: s.baris,
          kolom: kolomKunci.label,
          sebab: `"${nilaiKode}" sudah ada. Unggahan hanya menambah; ubah lewat layar masternya.`,
        });
        siap.splice(i, 1);
      }
    }

    // Kembar DI DALAM berkas itu sendiri juga ditolak — kalau tidak, transaksi
    // gagal di tengah dengan galat MySQL yang tidak menyebut baris mana.
    const terlihat = new Map<string, number>();
    for (let i = siap.length - 1; i >= 0; i -= 1) {
      const s = siap[i]!;
      const nilaiKode = s.nilai[k.kolom];
      if (typeof nilaiKode !== 'string') continue;
      const kunci = `${k.perPabrik ? s.nilai.plantId : '-'}|${nilaiKode.toUpperCase()}`;
      const sebelumnya = terlihat.get(kunci);
      if (sebelumnya !== undefined) {
        ditolak.push({
          baris: s.baris,
          kolom: kolomKunci.label,
          sebab: `"${nilaiKode}" muncul dua kali di berkas ini (lihat baris ${sebelumnya})`,
        });
        siap.splice(i, 1);
      } else {
        terlihat.set(kunci, s.baris);
      }
    }
  }
}

/** Isi sel sebagai teks/angka polos — rumus dan hyperlink diambil hasilnya. */
function bacaSel(sel: ExcelJS.Cell): unknown {
  const v = sel.value;
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: string; richText?: Array<{ text: string }> };
    if (o.richText) return o.richText.map((t) => t.text).join('').trim();
    if (o.text !== undefined) return String(o.text).trim();
    if (o.result !== undefined) return typeof o.result === 'string' ? o.result.trim() : o.result;
    return undefined;
  }
  return typeof v === 'string' ? v.trim() : v;
}

function teks(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}
