import { redirect } from 'next/navigation';

/** Pengaturan per proses sudah pindah ke rute per work center. Alamat lama tetap dibuka. */
export default function RuteProsesLamaPage() {
  redirect('/master/part-processes');
}
