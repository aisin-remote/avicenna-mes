'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ScanLine,
  CheckCircle2,
  XCircle,
  CopyX,
  Volume2,
  VolumeX,
  AlertTriangle,
  LogOut,
  Tag,
  RefreshCw,
  PackageCheck,
  X,
} from 'lucide-react';
import type {
  BerhentiLini,
  KanbanOwner,
  SampleCheck,
  StationResult,
  StationSummary,
  ProcessType,
} from '@avicenna/contracts';
import {
  grupProses,
  sepertiKanban,
  sepertiKartuLogin,
  sepertiNomorPartPolos,
} from '@avicenna/domain';
import { periksaSampleAction, periksaScanAction, submitScanAction } from '@/app/(app)/scan/actions';
import { PanelBerhenti } from './panel-berhenti';
import { PanelFotoPart } from './panel-foto-part';
import { urlFotoPart } from '@/lib/foto-part';
import { keluarStasiunAction } from '@/app/(station)/scan/proses/[grup]/actions';
import { NgInline } from './ng-inline';
import { useScanSound } from './use-scan-sound';
import { usePreferences } from '../shell/preferences-provider';
import { springSoft, durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

type Row = StationSummary['recent'][number];

const MAX_RECENT = 12;

/** Satu unit yang sudah diperiksa server dan menunggu kartunya — lini FG per barang. */
interface UnitDitahan {
  rawCode: string;
  serialNumber: string | null;
  partNumber: string | null;
  partName: string | null;
}

/** Box yang barusan ditutup — ditampilkan besar sampai scan berikutnya. */
interface BoxSelesai {
  serial: string | null;
  owner: KanbanOwner | null;
  pcs: number;
  partNumber: string | null;
  partName: string | null;
  /** Pesan server selain "OK" — mis. box tersimpan tetapi belum masuk loading list. */
  catatan: string | null;
}

const LABEL_PEMILIK: Record<KanbanOwner, string> = {
  INTERNAL: 'kanban internal',
  CUSTOMER: 'kanban customer',
};

/**
 * Layar stasiun scan untuk operator.
 *
 * Tata letaknya mengikuti layar avicenna yang sudah dipakai bertahun-tahun:
 * input di kiri, status besar di tengah, penghitung di kanan, riwayat di bawah.
 * Menjaga susunan itu disengaja — operator sudah hafal di mana harus melihat,
 * dan mengubahnya berarti melatih ulang orang tanpa alasan yang cukup.
 *
 * Tiga hal yang menentukan layar ini berguna atau tidak:
 *  1. Fokus HARUS selalu kembali ke input. Scanner barcode mengetik lalu
 *     menekan Enter; kalau fokus lepas, scan berikutnya hilang tanpa jejak.
 *  2. Status harus terbaca dari jarak beberapa meter.
 *  3. Hasilnya harus terdengar, karena operator sering tidak menatap layar.
 *
 * Tiga alur di satu layar, dipilih HANYA dari metode scan lini itu
 * (`summary.line.scanMode`, isi master Rute Proses):
 *  - PART_SAJA / PART_TANPA_KANBAN: tiap scan adalah satu barang berseri.
 *  - PART_KANBAN: mengikuti layar Casting Dowa di avicenna lama —
 *    part ditahan satu per satu sampai box penuh (isi box dari master part,
 *    bukan angka 3 yang ditanam di kode), lalu KARTU menutup box. Tiap part
 *    diperiksa server saat ditahan; saat kartu discan, unit dikirim satu per
 *    satu dan yang gagal disebut, sisanya tetap tertahan — sistem lama
 *    mengosongkan ketiganya saat galat.
 *  - KANBAN_BOX (BODY): operator men-scan MASTER SAMPLE yang tertempel di lini
 *    satu kali, lalu satu scan kanban = satu box. Nomor part sample dikirim
 *    bersama tiap kanban, dan server mencocokkan keduanya — sample yang salah
 *    ditolak di kartu pertama, bukan ketahuan di akhir shift.
 */
export function ScanStation({ summary }: { summary: StationSummary }) {
  /*
   * OK dan NG dalam SATU layar, bukan dua halaman.
   *
   * Lininya sudah dipilih dan tersimpan di layar ini. Halaman NG terpisah harus
   * mengetahui lini itu lagi — sistem lama menitipkannya di localStorage
   * (`avi_line_number`), dan nilai basi di situ membuat NG tercatat di lini yang
   * sudah ditinggalkan operator, tanpa satu pun tanda di layar.
   */
  const [mode, setMode] = useState<'OK' | 'NG'>('OK');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<StationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counter, setCounter] = useState(summary.counterToday);
  const [pcs, setPcs] = useState(summary.pcsToday);
  const [recent, setRecent] = useState<Row[]>(summary.recent.slice(0, MAX_RECENT));

  const perKanban = summary.line.scanMode === 'KANBAN_BOX';
  /*
   * Master sample yang sedang berlaku — hanya di lini per-kanban.
   *
   * Disimpan di memori layar, bukan localStorage: sample yang tertinggal dari
   * shift kemarin akan membuat kanban hari ini tercatat atas nama part yang
   * salah, dan tidak ada yang melihat karena setiap scannya "OK". Memuat ulang
   * halaman = scan sample lagi, dan itu memang murah.
   */
  const [sample, setSample] = useState<SampleCheck | null>(null);
  /** Sample yang barusan lolos — ditampilkan besar sekali, lalu diganti hasil scan berikutnya. */
  const [sampleBaru, setSampleBaru] = useState<SampleCheck | null>(null);

  const processType = summary.line.processType as ProcessType;
  /*
   * Lini yang menutup box dengan kartu: part ditahan sampai box penuh.
   *
   * Dibaca dari METODE SCAN, bukan dari jenis prosesnya. Dulu dari
   * `menghasilkanFinishGood(processType)` — sehingga lini FG yang ternyata
   * tidak memakai kartu mustahil dinyatakan tanpa menyunting kode.
   */
  const fg = summary.line.scanMode === 'PART_KANBAN';
  /*
   * Unit yang menunggu kartunya. Di memori layar, bukan localStorage — sistem
   * lama menyimpannya di sana dan part yang tertinggal dari shift kemarin ikut
   * masuk box hari ini. Muat ulang = scan ulang, dan part yang tertahan belum
   * ditulis ke mana pun, jadi tidak ada yang hilang selain beberapa detik.
   */
  const [ditahan, setDitahan] = useState<UnitDitahan[]>([]);
  /** Isi box menurut master part yang pertama ditahan; null sebelum ada. */
  const [isiBox, setIsiBox] = useState<number | null>(null);
  /** Unit yang barusan ditahan — untuk panel status. */
  const [ditahanBaru, setDitahanBaru] = useState<UnitDitahan | null>(null);
  const [boxSelesai, setBoxSelesai] = useState<BoxSelesai | null>(null);
  /**
   * Loading list yang ditunjuk label DN terakhir — panel "detail loading list".
   * Bertahan sampai label DN berikutnya, bukan dihapus tiap scan: operator
   * melihat kemajuan dokumen yang sama sepanjang beberapa box.
   */
  const [daftarMuat, setDaftarMuat] = useState<StationResult['loadingList']>(null);
  const [busy, setBusy] = useState(false);
  /*
   * Keadaan berhenti lini ini. Dimuat dari server, lalu dijaga di layar:
   * scan yang diterima menutupnya di server, jadi layar harus ikut tahu —
   * kalau tidak, tombol "Mulai" tetap terlihat padahal lini sudah berjalan.
   */
  const [berhenti, setBerhenti] = useState<BerhentiLini | null>(summary.berhenti ?? null);
  // Diawali dari preferensi tersimpan, lalu masih bisa dimatikan sesaat dari
  // layar ini tanpa mengubah pengaturan perangkat.
  const { prefs } = usePreferences();
  const [soundOn, setSoundOn] = useState(prefs.scanSound);

  /*
   * Preferensi tersimpan baru terbaca setelah komponen terpasang — membaca
   * localStorage saat render akan membuat hasil render server dan klien
   * berbeda. Nilai awal useState karena itu selalu bawaan, dan efek inilah
   * yang menyusulkan pilihan yang sebenarnya.
   */
  useEffect(() => {
    setSoundOn(prefs.scanSound);
  }, [prefs.scanSound]);

  /** Grup proses lini ini — dipakai layar NG dan serah terima operator. */
  const grup = grupProses(summary.line.processType as ProcessType);

  /*
   * Foto part yang sedang dikerjakan.
   *
   * Di lini BODY barangnya tidak berseri dan kartu baru discan setelah box
   * penuh, jadi pencocokan visual dengan gambar inilah satu-satunya pemeriksaan
   * sebelum barang masuk box — persis layar prdreport yang sudah dipakai di
   * sana. Karena itu gambarnya besar dan tetap terlihat sepanjang sample aktif,
   * bukan muncul sekejap lalu hilang.
   */
  const fotoSample = urlFotoPart(sample?.photoPath);

  const inputRef = useRef<HTMLInputElement>(null);
  const sound = useScanSound(soundOn);
  const seq = useRef(0);
  /** Sedang keluar karena kartu login discan — layar berpindah ke halaman login. */
  const [sedangKeluar, setKeluar] = useState(false);

  /** Mengembalikan fokus ke input — dipanggil setelah setiap kejadian apa pun. */
  const focusInput = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (mode === 'OK') focusInput();
  }, [focusInput, mode]);

  /*
   * Kembalikan fokus setiap kali proses pengiriman selesai.
   *
   * Memanggil focusInput() langsung setelah setBusy(false) tidak cukup:
   * setState bersifat asinkron, jadi saat fokus dipanggil komponen belum
   * dirender ulang. Efek ini berjalan SETELAH render, ketika input sudah siap.
   *
   * Input juga sengaja tidak pernah di-disable. Elemen yang dinonaktifkan
   * kehilangan fokus, dan scan berikutnya akan hilang tanpa jejak — kegagalan
   * paling mahal di layar ini karena operator tidak menyadarinya.
   */
  useEffect(() => {
    if (!busy && mode === 'OK') focusInput();
  }, [busy, focusInput, mode]);

  // Klik di mana pun pada layar mengembalikan fokus. Operator sering tidak
  // sengaja menyentuh area lain, dan tanpa ini scan berikutnya hilang diam-diam.
  useEffect(() => {
    /*
     * Hanya berlaku di mode OK. Tanpa penjagaan ini, kotak scan di sini akan
     * merebut fokus dari kotak scan layar NG setiap kali operator menyentuh
     * layar — dan scan NG berikutnya hilang tanpa jejak.
     */
    if (mode !== 'OK') return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('input')) return;
      // Ditunda satu tick agar tidak berebut dengan fokus bawaan browser.
      setTimeout(focusInput, 0);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [focusInput, mode]);

  async function submit(raw: string) {
    const value = raw.trim();
    if (!value || busy) return;

    /*
     * Kartu login discan ke kotak yang sama, bukan ke tombol tersendiri.
     *
     * Di tengah pergantian shift, langkah tambahan adalah langkah yang
     * dilewati — dan hasil produksi operator berikutnya tercatat atas nama orang
     * yang sudah pulang. Men-scan kartu mengakhiri sesi ini; yang berikutnya
     * masuk di halaman login.
     *
     * Penyaringnya ketat (lihat sepertiKartuLogin): kartu kanban dan barcode
     * part berpemisah tidak ikut tersaring ke sini, karena tersaring berarti
     * operator dikeluarkan di tengah shift oleh barcode barang biasa.
     */
    if (sepertiKartuLogin(value)) {
      void keluar();
      return;
    }

    /*
     * Lini per-kanban: nomor part polos = master sample, bukan kartu.
     *
     * Berlaku juga di tengah shift. Operator yang berganti part cukup men-scan
     * sample yang baru — tanpa tombol, tanpa langkah tambahan yang dilewati.
     * Barcode kanban tidak pernah lolos penyaring ini: bentuknya panjang dan
     * berspasi, sedangkan nomor part tidak.
     */
    if (perKanban && (!sample || sepertiNomorPartPolos(value))) {
      await periksaSample(value);
      return;
    }

    /*
     * Lini FG: satu kotak scan menerima part maupun kartu. Yang berbentuk
     * kartu (aturan kanban yang sama dengan server) menutup box; selebihnya
     * part yang ditahan. Urutannya mengikuti sistem lama: part dulu, kartu
     * terakhir — kartu tanpa part ditolak, bukan disimpan diam-diam.
     */
    if (fg) {
      if (sepertiKanban(value, { processType, scanMode: summary.line.scanMode })) {
        await tutupBox(value);
      } else {
        await tahanPart(value);
      }
      return;
    }

    setBusy(true);
    setError(null);
    setSampleBaru(null);
    seq.current += 1;

    const res = await submitScanAction(
      perKanban && sample
        ? {
            rawCode: sample.partNumber,
            kanbanCode: value,
            lineCode: summary.line.code,
            clientRef: `${summary.line.code}-${Date.now()}-${seq.current}`,
          }
        : {
            rawCode: value,
            lineCode: summary.line.code,
            // Kunci idempoten: scanner kadang mengirim ulang saat jaringan tersendat.
            clientRef: `${summary.line.code}-${Date.now()}-${seq.current}`,
          },
    );

    setCode('');
    setBusy(false);
    focusInput();

    if ('error' in res) {
      setError(res.error);
      setResult(null);
      sound.reject();
      return;
    }

    setResult(res);
    setCounter(res.counterToday);
    setPcs(res.pcsToday);

    if (res.status === 'ACCEPTED') {
      // Server menutup berhenti yang terbuka saat scan diterima; layar ikut.
      setBerhenti(null);
      sound.ok();
      setRecent((prev) =>
        [
          {
            id: Date.now(),
            kind: 'PRODUCTION',
            rawCode: res.rawCode,
            serialNumber: res.serialNumber,
            qty: res.qty,
            scannedAt: res.scannedAt,
            partNumber: res.partNumber,
            partName: res.partName,
          },
          ...prev,
        ].slice(0, MAX_RECENT),
      );
    } else {
      sound.reject();
    }
  }

  /** Membersihkan panel status sebelum kejadian baru ditampilkan. */
  function bersihkanStatus() {
    setError(null);
    setResult(null);
    setSampleBaru(null);
    setDitahanBaru(null);
    setBoxSelesai(null);
  }

  /** Galat lokal layar (bukan dari server) — ditampilkan besar dan dibunyikan. */
  function tolakDiLayar(pesan: string) {
    bersihkanStatus();
    setError(pesan);
    setCode('');
    focusInput();
    sound.reject();
  }

  /**
   * Menahan satu part di lini FG setelah diperiksa server.
   *
   * Pemeriksaannya persis scan sungguhan (barcode, program, rute, duplikat)
   * tanpa menulis apa pun — jadi part yang lolos di sini hanya bisa gagal
   * nanti karena kartunya. Semua part dalam satu box harus part yang sama:
   * kartu hanya cocok dengan satu part, dan box campuran akan ditolak
   * sebagian di tengah jalan.
   */
  async function tahanPart(value: string) {
    if (ditahan.some((u) => u.rawCode === value)) {
      tolakDiLayar('Part ini sudah ditahan di box ini.');
      return;
    }
    if (isiBox !== null && ditahan.length >= isiBox) {
      tolakDiLayar(`Box sudah penuh (${ditahan.length}/${isiBox}). Scan kanban untuk menutupnya.`);
      return;
    }

    setBusy(true);
    bersihkanStatus();
    seq.current += 1;

    const res = await periksaScanAction({ rawCode: value, lineCode: summary.line.code });

    setCode('');
    setBusy(false);
    focusInput();

    if ('error' in res) {
      setError(res.error);
      sound.reject();
      return;
    }
    if (res.status !== 'ACCEPTED') {
      setResult(res);
      sound.reject();
      return;
    }

    const pertama = ditahan[0];
    if (pertama && pertama.partNumber !== res.partNumber) {
      setError(
        `Part berbeda: box ini berisi ${pertama.partNumber ?? '?'}, yang discan ${res.partNumber ?? '?'}. ` +
          'Selesaikan box ini dulu.',
      );
      sound.reject();
      return;
    }

    const unit: UnitDitahan = {
      rawCode: value,
      serialNumber: res.serialNumber,
      partNumber: res.partNumber,
      partName: res.partName,
    };
    // Isi box dari master part: 0 atau kosong berarti satu unit per kartu.
    if (!pertama) setIsiBox(res.qtyPerKanban && res.qtyPerKanban > 0 ? res.qtyPerKanban : 1);
    setDitahan((prev) => [...prev, unit]);
    setDitahanBaru(unit);
    sound.ok();
  }

  /**
   * Menutup box: menempelkan kartu ke semua unit yang ditahan.
   *
   * Unit dikirim SATU PER SATU, tiap unit langsung tersimpan. Bila satu gagal,
   * yang sudah masuk tetap masuk, yang belum tetap tertahan, dan sebabnya
   * disebut — operator men-scan kartu lagi (atau kartu lain) untuk sisanya.
   * Sistem lama mengosongkan seluruh box saat galat, dan operator harus
   * men-scan ulang tiga part yang sebagian sudah tersimpan — lalu ditolak
   * sebagai duplikat.
   */
  async function tutupBox(kanban: string) {
    if (ditahan.length === 0) {
      tolakDiLayar('Scan part dulu. Kartu discan setelah box penuh.');
      return;
    }
    if (isiBox !== null && ditahan.length < isiBox) {
      tolakDiLayar(`Box belum penuh (${ditahan.length}/${isiBox}). Scan part lagi.`);
      return;
    }

    setBusy(true);
    bersihkanStatus();

    let sisa = [...ditahan];
    let terakhir: StationResult | null = null;
    let gagal: { unit: UnitDitahan; pesan: string; res?: StationResult } | null = null;

    for (const unit of ditahan) {
      seq.current += 1;
      const res = await submitScanAction({
        rawCode: unit.rawCode,
        kanbanCode: kanban,
        lineCode: summary.line.code,
        clientRef: `${summary.line.code}-${Date.now()}-${seq.current}`,
      });

      if ('error' in res) {
        gagal = { unit, pesan: res.error };
        break;
      }
      setCounter(res.counterToday);
      setPcs(res.pcsToday);
      if (res.status !== 'ACCEPTED') {
        gagal = { unit, pesan: res.message, res };
        break;
      }

      terakhir = res;
      setBerhenti(null);
      if (res.loadingList) setDaftarMuat(res.loadingList);
      sisa = sisa.filter((u) => u.rawCode !== unit.rawCode);
      setDitahan(sisa);
      setRecent((prev) =>
        [
          {
            id: Date.now(),
            kind: 'PRODUCTION',
            rawCode: res.rawCode,
            serialNumber: res.serialNumber,
            qty: res.qty,
            scannedAt: res.scannedAt,
            partNumber: res.partNumber,
            partName: res.partName,
          },
          ...prev,
        ].slice(0, MAX_RECENT),
      );
    }

    setCode('');
    setBusy(false);
    focusInput();

    if (gagal) {
      const seri = gagal.unit.serialNumber ?? gagal.unit.rawCode;
      const masuk = ditahan.length - sisa.length;
      setError(
        `${gagal.pesan} (unit ${seri})` +
          (masuk > 0 ? ` — ${masuk} unit sudah masuk, ${sisa.length} masih ditahan.` : ''),
      );
      sound.reject();
      return;
    }

    setIsiBox(null);
    setBoxSelesai({
      serial: terakhir?.serialNumber ?? null,
      owner: terakhir?.kanbanOwner ?? null,
      pcs: ditahan.length,
      partNumber: terakhir?.partNumber ?? ditahan[0]?.partNumber ?? null,
      partName: terakhir?.partName ?? ditahan[0]?.partName ?? null,
      catatan: terakhir && terakhir.message !== 'OK' ? terakhir.message : null,
    });
    sound.ok();
  }

  /** Melepas satu unit yang ditahan — salah ambil, atau ternyata NG. */
  function lepasUnit(rawCode: string) {
    setDitahan((prev) => {
      const berikut = prev.filter((u) => u.rawCode !== rawCode);
      if (berikut.length === 0) setIsiBox(null);
      return berikut;
    });
    setDitahanBaru(null);
    focusInput();
  }

  /**
   * Memeriksa master sample ke server dan, bila lolos, menjadikannya sample
   * yang berlaku. Sample yang ditolak TIDAK mengganti sample lama — operator
   * yang salah ambil sample tetap bisa lanjut dengan part yang sedang berjalan.
   */
  async function periksaSample(value: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    seq.current += 1;

    const res = await periksaSampleAction({ code: value, lineCode: summary.line.code });

    setCode('');
    setBusy(false);
    focusInput();

    if ('error' in res) {
      setError(res.error);
      setSampleBaru(null);
      sound.reject();
      return;
    }

    setSample(res);
    setSampleBaru(res);
    sound.ok();
  }

  /**
   * Mengakhiri sesi karena ada yang men-scan kartu login.
   *
   * Kartunya sendiri TIDAK dikirim ke mana pun — yang dilakukan hanya keluar.
   * Orang berikutnya men-scan kartunya lagi di halaman login, tempat kredensial
   * memang diperiksa.
   */
  async function keluar() {
    setBusy(true);
    setError(null);
    setResult(null);
    setKeluar(true);
    sound.ok();

    /*
     * Aksi ini berakhir dengan redirect ke halaman login, jadi tidak ada yang
     * perlu dikerjakan sesudahnya. `busy` sengaja dibiarkan menyala: layar
     * sedang berpindah, dan mengembalikan fokus ke kotak scan hanya membuka
     * peluang scan berikutnya terkirim ke sesi yang sudah berakhir.
     */
    await keluarStasiunAction();
  }

  const tone =
    sampleBaru || ditahanBaru || boxSelesai
      ? 'ok'
      : !result
        ? 'idle'
        : result.status === 'ACCEPTED'
          ? 'ok'
          : result.status === 'DUPLICATE'
            ? 'dup'
            : 'bad';

  const tab = (
    <div className="flex gap-1.5" role="tablist" aria-label="Mode scan">
      <TabMode
        aktif={mode === 'OK'}
        onClick={() => setMode('OK')}
        label="Scan hasil OK"
        nada="ok"
      />
      <TabMode
        aktif={mode === 'NG'}
        onClick={() => setMode('NG')}
        label="Input NG"
        nada="ng"
        icon={AlertTriangle}
      />
    </div>
  );

  if (mode === 'NG') {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="shrink-0">{tab}</div>
        {/* Isinya sendiri yang menggulir bila perlu — halamannya tidak. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NgInline lineCode={summary.line.code} lineName={summary.line.name} grup={grup} />
        </div>
      </div>
    );
  }

  /*
   * ── Seluruh layar, tanpa gulir ──────────────────────────────────────────
   *
   * Operator berdiri dengan barang di tangan; ia tidak akan menggulir layar,
   * dan apa pun yang berada di bawah lipatan sama saja dengan tidak ada.
   * Karena itu tingginya dibagi: bagian yang harus selalu terbaca diberi
   * tempat tetap, sisanya diserahkan ke satu area yang memuai — dan HANYA
   * area itu yang boleh menggulir di dalam dirinya sendiri.
   */
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0">{tab}</div>

      {/* Tombol berhenti ditaruh DI ATAS kotak scan: saat lini bermasalah,
          itulah yang dicari operator, dan menaruhnya di bawah daftar riwayat
          membuat orang menggulir sambil lini diam. */}
      <div className="shrink-0">
        <PanelBerhenti
          lineCode={summary.line.code}
          alasan={summary.alasanBerhenti ?? []}
          berhenti={berhenti}
          onBerubah={setBerhenti}
        />
      </div>

      <div className="grid shrink-0 gap-3 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)_minmax(0,260px)]">
        {/* ── Input ─────────────────────────────────────────────────────── */}
        {/*
          Di lini berfoto, panel ini sengaja diringkas: yang dipandangi operator
          sepanjang shift adalah GAMBARNYA, bukan keterangan cara scan yang
          sudah ia hafal setelah setengah jam. Ruang yang dihemat di sini
          langsung menjadi tinggi foto.
        */}
        <section className="scroll-slim max-h-[34vh] overflow-y-auto rounded-card border border-line bg-card p-4">
          {/*
            Judul berbagi baris dengan tombol suara: tombol itu disentuh sekali
            seumur shift, dan satu baris sendiri untuknya berarti satu baris
            tinggi yang hilang dari bagian layar yang dipakai bekerja.
          */}
          <header className="flex items-center justify-between gap-3">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
              {perKanban
                ? sample
                  ? 'Scan Kanban'
                  : 'Scan Master Sample'
                : fg
                  ? isiBox !== null && ditahan.length >= isiBox
                    ? 'Scan Kanban'
                    : 'Scan Part'
                  : 'Scan Part'}
            </h2>
            <button
              type="button"
              onClick={() => {
                setSoundOn((v) => !v);
                focusInput();
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink-soft transition-colors hover:bg-surface"
            >
              {soundOn ? (
                <Volume2 className="size-3.5" strokeWidth={1.8} aria-hidden />
              ) : (
                <VolumeX className="size-3.5" strokeWidth={1.8} aria-hidden />
              )}
              Suara {soundOn ? 'aktif' : 'mati'}
            </button>
          </header>
          <p className="mt-1 text-[12px] leading-snug text-ink-muted">
            {perKanban
              ? sample
                ? 'Satu scan kanban = satu box. Ganti part? Scan master sample yang baru.'
                : 'Scan master sample yang tertempel di lini dulu. Kanban baru bisa discan sesudahnya.'
              : fg
                ? isiBox !== null && ditahan.length >= isiBox
                  ? 'Box penuh. Scan kanban internal atau kanban customer untuk menutupnya.'
                  : 'Scan part satu per satu sampai box penuh, lalu scan kanban.'
                : 'Arahkan barcode ke scanner. Hasilnya muncul besar di sebelah kanan.'}
          </p>
          {perKanban && sample ? (
            <div className="mt-3 flex items-start gap-3 rounded-2xl border border-ok/30 bg-ok/8 px-4 py-3">
              <Tag className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={1.8} aria-hidden />
              {fotoSample ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={fotoSample} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  Master sample
                </div>
                <div className="tabular truncate text-[16px] font-bold">{sample.partNumber}</div>
                <div className="truncate text-[13px] text-ink-soft">
                  {sample.backNumber ? `${sample.backNumber} — ` : ''}
                  {sample.partName}
                </div>
                {sample.qtyPerKanban ? (
                  <div className="tabular mt-0.5 text-[12px] text-ink-muted">
                    {sample.qtyPerKanban} pcs per kanban (master part)
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSample(null);
                  setSampleBaru(null);
                  setResult(null);
                  setError(null);
                  focusInput();
                }}
                aria-label="Ganti master sample"
                title="Ganti master sample"
                className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-card hover:text-ink"
              >
                <RefreshCw className="size-4" strokeWidth={1.8} aria-hidden />
              </button>
            </div>
          ) : null}
          {/* Disebutkan di layar, bukan disimpan sebagai pengetahuan orang
              dalam: operator berikutnya harus tahu kartunya discan ke kotak
              yang sama, bukan lewat tombol keluar. */}
          <p className="mt-1 text-[12px] leading-snug text-ink-muted">
            Ganti shift? Scan kartu login di kotak ini untuk keluar.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(code);
            }}
            className="mt-3"
          >
            <input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label={
                perKanban
                  ? sample
                    ? 'Barcode kanban'
                    : 'Master sample'
                  : fg
                    ? 'Barcode part atau kanban'
                    : 'Barcode part'
              }
              placeholder={
                perKanban
                  ? sample
                    ? 'Scan kanban'
                    : 'Scan master sample dulu'
                  : fg
                    ? isiBox !== null && ditahan.length >= isiBox
                      ? 'Scan kanban'
                      : 'Scan part'
                    : 'Fokus di sini lalu scan'
              }
              className="tabular h-12 w-full rounded-2xl border-2 border-line bg-surface px-4 text-[16px] font-semibold outline-none transition-colors duration-200 placeholder:text-[14px] placeholder:font-normal placeholder:text-ink-muted focus:border-ink focus:bg-card"
            />
          </form>
        </section>

        {/* ── Status besar ──────────────────────────────────────────────── */}
        <section
          id="scan-status"
          aria-live="assertive"
          className={cn(
            'flex flex-col items-center justify-center rounded-card border-2 text-center transition-colors duration-300',
            'min-h-[120px] p-4',
            tone === 'idle' && 'border-line bg-card',
            tone === 'ok' && 'border-ok/30 bg-ok/8',
            tone === 'dup' && 'border-warn/30 bg-warn/8',
            tone === 'bad' && 'border-ng/30 bg-ng/8',
          )}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={`${sedangKeluar ? 'keluar' : sampleBaru ? 'sample' : boxSelesai ? 'box' : ditahanBaru ? 'tahan' : (result?.rawCode ?? 'idle')}-${result?.status ?? ''}-${seq.current}`}
              initial={{ opacity: 0, scale: 0.94, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={springSoft}
              className="flex flex-col items-center gap-3"
            >
              {sedangKeluar ? (
                <>
                  <LogOut className="size-12 text-ink-muted" strokeWidth={1.6} aria-hidden />
                  <div className="text-[26px] font-extrabold leading-tight">KELUAR</div>
                  <p className="max-w-md text-[15px] text-ink-soft">
                    Membuka halaman masuk. Scan kartu Anda di sana.
                  </p>
                </>
              ) : error ? (
                <>
                  <XCircle className="size-12 text-ng" strokeWidth={1.6} aria-hidden />
                  <div className="text-[26px] font-extrabold leading-tight text-ng">
                    GAGAL KIRIM
                  </div>
                  <p className="max-w-md text-[15px] text-ink-soft">{error}</p>
                </>
              ) : boxSelesai ? (
                <>
                  <PackageCheck className="size-12 text-ok" strokeWidth={1.6} aria-hidden />
                  <div className="text-[32px] font-extrabold leading-none tracking-tight text-ok">
                    BOX SELESAI
                  </div>
                  <div className="tabular text-[24px] font-extrabold leading-none">
                    {boxSelesai.pcs} pcs · Kanban {boxSelesai.serial ?? '—'}
                  </div>
                  <div className="text-[15px] text-ink-soft">
                    {boxSelesai.owner ? `${LABEL_PEMILIK[boxSelesai.owner]} · ` : ''}
                    {boxSelesai.partNumber} — {boxSelesai.partName}
                  </div>
                  {boxSelesai.catatan ? (
                    <p className="max-w-md text-[14px] font-semibold text-warn">
                      {boxSelesai.catatan}
                    </p>
                  ) : null}
                </>
              ) : ditahanBaru ? (
                <>
                  <CheckCircle2 className="size-12 text-ok" strokeWidth={1.6} aria-hidden />
                  <div className="text-[32px] font-extrabold leading-none tracking-tight text-ok">
                    DITAHAN {ditahan.length}/{isiBox ?? '?'}
                  </div>
                  <div className="tabular text-[20px] font-bold">{ditahanBaru.rawCode}</div>
                  <div className="text-[15px] text-ink-soft">
                    {ditahanBaru.partNumber} — {ditahanBaru.partName}
                  </div>
                  <p className="max-w-md text-[14px] text-ink-muted">
                    {isiBox !== null && ditahan.length >= isiBox
                      ? 'Box penuh. Scan kanban.'
                      : 'Scan part berikutnya.'}
                  </p>
                </>
              ) : sampleBaru ? (
                <>
                  <Tag className="size-12 text-ok" strokeWidth={1.6} aria-hidden />
                  <div className="text-[32px] font-extrabold leading-none tracking-tight text-ok">
                    SAMPLE OK
                  </div>
                  <div className="tabular text-[20px] font-bold">{sampleBaru.partNumber}</div>
                  <div className="text-[15px] text-ink-soft">
                    {sampleBaru.backNumber ? `${sampleBaru.backNumber} — ` : ''}
                    {sampleBaru.partName}
                  </div>
                  <p className="max-w-md text-[14px] text-ink-muted">
                    {sampleBaru.ruteDiperiksa
                      ? 'Sekarang scan kanban.'
                      : 'Part ini belum punya rute, jadi lininya tidak bisa diperiksa. Sekarang scan kanban.'}
                  </p>
                </>
              ) : !result ? (
                <>
                  <ScanLine
                    className={cn('text-ink-muted', perKanban ? 'size-8' : 'size-12')}
                    strokeWidth={1.4}
                    aria-hidden
                  />
                  <div
                    className={cn(
                      'font-extrabold leading-tight text-ink-muted',
                      perKanban ? 'text-[18px]' : 'text-[26px]',
                    )}
                  >
                    {perKanban && !sample
                      ? 'SCAN MASTER SAMPLE'
                      : fg
                        ? 'SCAN PART'
                        : 'MENUNGGU SCAN'}
                  </div>
                </>
              ) : result.status === 'ACCEPTED' ? (
                <>
                  <CheckCircle2 className="size-12 text-ok" strokeWidth={1.6} aria-hidden />
                  <div className="text-[38px] font-extrabold leading-none tracking-tight text-ok">
                    OK
                  </div>
                  {perKanban ? (
                    <>
                      <div className="tabular text-[28px] font-extrabold leading-none">
                        +{result.qty} pcs
                      </div>
                      <div className="tabular text-[16px] font-semibold text-ink-soft">
                        Kanban {result.serialNumber ?? '—'}
                      </div>
                    </>
                  ) : (
                    <div className="tabular text-[20px] font-bold">{result.rawCode}</div>
                  )}
                  {result.partName ? (
                    <div className="text-[15px] text-ink-soft">
                      {result.partNumber} — {result.partName}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  {result.status === 'DUPLICATE' ? (
                    <CopyX className="size-12 text-warn" strokeWidth={1.6} aria-hidden />
                  ) : (
                    <XCircle className="size-12 text-ng" strokeWidth={1.6} aria-hidden />
                  )}
                  <div
                    className={cn(
                      'text-[32px] font-extrabold leading-none tracking-tight',
                      result.status === 'DUPLICATE' ? 'text-warn' : 'text-ng',
                    )}
                  >
                    {result.status === 'DUPLICATE' ? 'SUDAH DISCAN' : 'DITOLAK'}
                  </div>
                  {!perKanban ? (
                    <div className="tabular text-[18px] font-bold">{result.rawCode}</div>
                  ) : null}
                  <p className="max-w-md text-[15px] text-ink-soft">{result.message}</p>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </section>

        {/* ── Penghitung ────────────────────────────────────────────────── */}
        <section className="flex flex-col justify-center rounded-card border border-line bg-card p-5 text-center">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
            {perKanban ? 'Total pcs hari ini' : 'Total OK hari ini'}
          </div>
          <motion.div
            key={perKanban ? pcs : counter}
            initial={{ scale: 1.18 }}
            animate={{ scale: 1 }}
            transition={{ duration: durations.slow, ease: easeSoft }}
            className={cn(
              'tabular mt-2 font-extrabold leading-none tracking-tight',
              perKanban ? 'text-[44px]' : 'text-[56px]',
            )}
          >
            {perKanban ? pcs : counter}
          </motion.div>
          <div className="tabular mt-2 text-[13px] text-ink-muted">
            {perKanban ? `${counter} kanban · ` : ''}Line {summary.line.code}
          </div>
        </section>
      </div>

      {/*
        ── Sisa tinggi layar ────────────────────────────────────────────────
        Satu baris yang memuai mengisi apa pun yang tersisa. Isinya berbeda per
        metode scan, tetapi aturannya sama: yang paling dibutuhkan operator
        mendapat ruang terbesar, dan riwayat — yang paling tidak mendesak —
        menempati kolom sempit di sebelahnya serta menggulir di dalam dirinya
        sendiri.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* ── Lini per-kanban (BODY): foto part yang sedang dikerjakan ─────
          Slotnya selalu ada, juga saat sample atau fotonya belum ada, supaya
          kekosongannya terlihat sebagai sesuatu yang harus dibereskan. */}
        {perKanban ? <PanelFotoPart sample={sample} className="min-h-0 flex-1" /> : null}

        {/* ── Lini FG: isi box (kiri) dan detail loading list (kanan) ──────
          Susunannya mengikuti layar D98E lama: PART SCANNED di kiri, LOADING
          LIST INFORMATION di kanan. Jumlah kotak part mengikuti isi box
          menurut master part yang pertama discan. */}
        {fg ? (
          <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-2">
            <section className="scroll-slim flex min-h-0 flex-col overflow-y-auto rounded-card border border-line bg-card p-5">
              <header className="flex shrink-0 items-baseline justify-between">
                <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
                  Part discan
                </h2>
                <span className="tabular text-[13px] font-bold">
                  {ditahan.length}/{isiBox ?? '?'}
                </span>
              </header>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {Array.from({ length: Math.max(isiBox ?? 1, ditahan.length) }).map((_, i) => {
                  const u = ditahan[i];
                  return (
                    <li
                      key={u ? u.rawCode : `kosong-${i}`}
                      className={cn(
                        'flex min-h-[64px] items-center gap-3 rounded-2xl border px-4 text-[15px]',
                        u
                          ? 'border-ok/30 bg-ok/8 font-bold'
                          : 'border-dashed border-line text-ink-muted',
                      )}
                    >
                      <span className="tabular w-5 shrink-0 text-[12px] font-semibold text-ink-muted">
                        {i + 1}
                      </span>
                      <span className="tabular min-w-0 flex-1 truncate">
                        {u ? (u.serialNumber ?? u.rawCode) : 'Belum discan'}
                      </span>
                      {u ? (
                        <button
                          type="button"
                          onClick={() => lepasUnit(u.rawCode)}
                          aria-label={`Lepas ${u.serialNumber ?? u.rawCode}`}
                          title="Lepas dari box"
                          className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-card hover:text-ng"
                        >
                          <X className="size-4" strokeWidth={2} aria-hidden />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-[13px] text-ink-muted">
                {ditahan[0]?.partNumber
                  ? `${ditahan[0].partNumber} — ${ditahan[0].partName}`
                  : 'Jumlah kotak mengikuti isi box part yang discan pertama.'}
              </p>
            </section>

            <section className="rounded-card border border-line bg-card p-5">
              <header className="flex items-baseline justify-between gap-3">
                <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
                  Detail loading list
                </h2>
                {daftarMuat ? (
                  <span className="tabular truncate text-[13px] font-bold">
                    {daftarMuat.documentNumber}
                    {daftarMuat.pdsNumber ? ` · ${daftarMuat.pdsNumber}` : ''}
                  </span>
                ) : null}
              </header>
              {!daftarMuat ? (
                <p className="mt-3 text-[13px] text-ink-muted">
                  Terisi setelah box ditutup dengan label DN (direct pulling). Kartu kanban internal
                  tidak mengisi panel ini.
                </p>
              ) : (
                <>
                  {daftarMuat.customerName ? (
                    <p className="mt-1 text-[13px] text-ink-soft">{daftarMuat.customerName}</p>
                  ) : null}
                  <table className="mt-3 w-full text-[14px]">
                    <thead>
                      <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        <th className="pb-2 font-semibold">Part</th>
                        <th className="pb-2 text-right font-semibold">Progres</th>
                        <th className="pb-2 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {daftarMuat.items.map((it) => {
                        const selesai = it.plannedKanban > 0 && it.pickedKanban >= it.plannedKanban;
                        return (
                          <tr key={`${it.partNumber}-${it.customerPartNumber}`}>
                            <td className="py-2">
                              <div className="tabular font-semibold">
                                {it.customerPartNumber ?? it.partNumber}
                              </div>
                              {it.customerPartNumber && it.partNumber ? (
                                <div className="text-[12px] text-ink-muted">{it.partNumber}</div>
                              ) : null}
                            </td>
                            <td
                              className={cn(
                                'tabular py-2 text-right font-bold',
                                selesai
                                  ? 'text-ok'
                                  : it.pickedKanban > it.plannedKanban
                                    ? 'text-warn'
                                    : '',
                              )}
                            >
                              {it.pickedKanban}
                            </td>
                            <td className="tabular py-2 text-right text-ink-soft">
                              {it.plannedKanban}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[12px] text-ink-muted">
                    Box terambil dari rencana, per part.
                  </p>
                </>
              )}
            </section>
          </div>
        ) : null}

        {/* ── Riwayat ──────────────────────────────────────────────────────
          Paling tidak mendesak, jadi ia yang mengalah: kolom sempit di lini
          yang punya panel utama, dan menggulir di dalam dirinya sendiri supaya
          tidak pernah mendorong apa pun keluar layar. */}
        <section
          className={cn(
            'flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-card',
            perKanban || fg ? 'lg:w-[360px] lg:shrink-0' : 'flex-1',
          )}
        >
          <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-[15px] font-bold">
              {perKanban ? 'Kanban terakhir' : 'Scan terakhir'}
            </h2>
            <span className="text-[13px] text-ink-muted">{recent.length} terbaru</span>
          </header>

          {recent.length === 0 ? (
            <p className="px-5 py-12 text-center text-[14px] text-ink-muted">
              Belum ada scan pada line ini hari ini.
            </p>
          ) : (
            <ul className="scroll-slim min-h-0 flex-1 divide-y divide-line overflow-y-auto">
              <AnimatePresence initial={false}>
                {recent.map((r) => (
                  <motion.li
                    key={`${r.id}-${r.rawCode}`}
                    layout
                    initial={{ opacity: 0, height: 0, backgroundColor: 'rgba(22,163,74,0.10)' }}
                    animate={{ opacity: 1, height: 'auto', backgroundColor: 'rgba(22,163,74,0)' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{
                      layout: springSoft,
                      height: { duration: durations.base, ease: easeSoft },
                      opacity: { duration: durations.base, ease: easeSoft },
                      backgroundColor: { duration: 1.4, ease: easeSoft },
                    }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-4 px-5 py-3 text-[14px]">
                      <span className="tabular w-20 shrink-0 text-[13px] font-medium text-ink-muted">
                        {new Date(r.scannedAt).toLocaleTimeString('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      <span className="tabular min-w-0 flex-1 truncate font-semibold">
                        {perKanban ? `Kanban ${r.serialNumber ?? '—'} · ${r.rawCode}` : r.rawCode}
                      </span>
                      <span className="hidden min-w-0 flex-1 truncate text-ink-soft sm:block">
                        {r.partName ?? '—'}
                      </span>
                      <span className="tabular w-16 shrink-0 text-right font-semibold">
                        {r.qty} pcs
                      </span>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Pemilih mode OK / NG.
 *
 * NG diberi warnanya sendiri dan tidak pernah jadi mode awal: layar ini paling
 * sering dipakai untuk mencatat hasil baik, dan mode NG yang tertinggal aktif
 * akan membuat hasil produksi satu shift tercatat sebagai kerusakan.
 */
function TabMode({
  aktif,
  onClick,
  label,
  nada,
  icon: Icon,
}: {
  aktif: boolean;
  onClick: () => void;
  label: string;
  nada: 'ok' | 'ng';
  icon?: typeof AlertTriangle;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={aktif}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-[14px] font-bold transition-colors',
        !aktif && 'border-line text-ink-muted hover:border-ink hover:text-ink',
        aktif && nada === 'ok' && 'border-ink bg-surface text-ink',
        aktif && nada === 'ng' && 'border-ng bg-ng/10 text-ng',
      )}
    >
      {Icon ? <Icon className="size-4" strokeWidth={2} aria-hidden /> : null}
      {label}
    </button>
  );
}
