import { cn } from '../ui/cn';

/**
 * Pembungkus animasi kemunculan.
 *
 * Ini SERVER COMPONENT dan hanya memasang kelas CSS. Tidak ada JavaScript yang
 * terlibat, jadi isinya tetap terlihat walau bundle gagal dimuat — animasi
 * murni penambah, bukan syarat agar konten muncul.
 *
 * Lihat globals.css untuk keyframes-nya.
 */

interface WrapProps {
  children: React.ReactNode;
  className?: string;
  /** Penundaan tambahan untuk mengurutkan blok di luar stagger. */
  delayMs?: number;
}

export function Reveal({ children, className, delayMs }: WrapProps) {
  return (
    <div
      className={cn('a-rise', className)}
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
}

export function Fade({ children, className, delayMs }: WrapProps) {
  return (
    <div
      className={cn('a-fade', className)}
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/** Memunculkan anak-anaknya berurutan. Jeda diatur CSS lewat nth-child. */
export function Stagger({ children, className }: WrapProps) {
  return <div className={cn('a-stagger', className)}>{children}</div>;
}

/**
 * Satu anak dalam Stagger.
 * Sengaja tanpa kelas: animasinya datang dari induk `.a-stagger > *`, sehingga
 * urutan otomatis mengikuti posisi di DOM tanpa perlu menghitung indeks.
 */
export function StaggerItem({ children, className }: WrapProps) {
  return <div className={className}>{children}</div>;
}
