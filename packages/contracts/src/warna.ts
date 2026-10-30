/**
 * Menurunkan nada-nada sebuah tombol dari SATU warna yang dipilih orang.
 *
 * ── Kenapa satu warna, bukan tiga ───────────────────────────────────────────
 *
 * Tombol di layar scan punya tiga nada: latar yang sangat muda, garis tepi yang
 * lebih tegas, dan tulisan beserta ikon dengan warna penuh. Meminta orang
 * memilih ketiganya berarti meminta ia memahami kontras — dan hasilnya hampir
 * selalu tombol yang tidak terbaca dari dua meter. Jadi yang dipilih satu, dan
 * dua sisanya diturunkan.
 *
 * ── Kenapa latar dan tepi memakai alfa, bukan dicampur putih ────────────────
 *
 * Alfa menumpuk di atas apa pun yang ada di belakangnya, jadi tombolnya benar
 * di tema terang maupun gelap. Mencampurnya dengan putih menghasilkan warna
 * tetap yang akan menyala di latar gelap.
 */

export interface NadaTombol {
  bg: string;
  border: string;
  teks: string;
}

/** Ambang luminansi tulisan. Di atas ini, teks mulai hilang di latar terang. */
export const BATAS_TERANG = 0.3;

function keRgb(hex: string): [number, number, number] | null {
  const cocok = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!cocok) return null;
  const n = Number.parseInt(cocok[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminansi relatif menurut WCAG — dipakai menilai keterbacaan, bukan kecerahan kasar. */
export function luminansi([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * Menggelapkan warna sampai tulisannya terbaca.
 *
 * Orang memilih warna dari kotak kecil di formulir, dan kuning muda terlihat
 * bagus di sana. Dipakai sebagai warna tulisan, ia nyaris tidak terlihat.
 * Yang digelapkan HANYA tulisannya — latar dan tepinya tetap memakai warna
 * yang dipilih, jadi tombolnya tetap terlihat seperti warna pilihannya.
 */
function gelapkanSecukupnya(rgb: [number, number, number]): [number, number, number] {
  let [r, g, b] = rgb;
  let putaran = 0;
  while (luminansi([r, g, b]) > BATAS_TERANG && putaran < 24) {
    r = Math.round(r * 0.9);
    g = Math.round(g * 0.9);
    b = Math.round(b * 0.9);
    putaran += 1;
  }
  return [r, g, b];
}

/**
 * Nada tombol dari sebuah hex `#RRGGBB`.
 *
 * Mengembalikan `null` bila warnanya kosong atau tidak berbentuk hex — supaya
 * pemanggil jatuh ke gaya bawaannya, bukan menampilkan tombol tanpa warna
 * sama sekali.
 */
function nada(hex: string | null | undefined, aBg: number, aTepi: number): NadaTombol | null {
  if (!hex) return null;
  const rgb = keRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const [tr, tg, tb] = gelapkanSecukupnya(rgb);
  return {
    bg: `rgb(${r} ${g} ${b} / ${aBg})`,
    border: `rgb(${r} ${g} ${b} / ${aTepi})`,
    teks: `rgb(${tr} ${tg} ${tb})`,
  };
}

export function nadaTombol(hex: string | null | undefined): NadaTombol | null {
  return nada(hex, 0.09, 0.32);
}

/**
 * Nada untuk PANEL sebidang, lebih pekat daripada tombol.
 *
 * Tombol duduk di antara tombol lain dan harus tetap terbaca sebagai satu
 * benda di antara beberapa; panel berhenti mengisi seluruh kolom dan tugasnya
 * justru berteriak dari seberang lini. Angkanya mengikuti gaya merah yang
 * dipakai sebelum warna bisa diatur, supaya alasan tanpa warna terlihat persis
 * seperti dulu.
 */
export function nadaPanel(hex: string | null | undefined): NadaTombol | null {
  return nada(hex, 0.1, 0.45);
}
