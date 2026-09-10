/**
 * Transisi antar halaman.
 *
 * Harus template.tsx, bukan layout.tsx: Next membuat instance baru setiap kali
 * rute berganti. Elemen baru berarti animasi CSS-nya otomatis berjalan lagi —
 * itulah yang membuat tiap navigasi terasa berpindah.
 *
 * Bukan Server/Client Component khusus: tanpa JavaScript pun animasinya tetap
 * jalan, dan isinya tetap terlihat kalau animasi tidak didukung.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="a-rise p-6 lg:p-8">{children}</div>;
}
