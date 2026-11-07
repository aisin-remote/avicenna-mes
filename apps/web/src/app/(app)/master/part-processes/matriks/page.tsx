import { redirect } from 'next/navigation';

/** Matriks rute sudah diganti tabel rute per work center. Alamat lama tetap dibuka. */
export default function MatriksRuteLamaPage() {
  redirect('/master/part-processes');
}
