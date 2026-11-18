/** Keputusan murni satu scan anggota di dalam putaran mold. */
export type MoldCycleDecision = 'NOT_MEMBER' | 'DUPLICATE' | 'ACCEPTED' | 'COMPLETED';

/**
 * Menjaga urutan putaran mold tanpa bergantung database/UI.
 *
 * Anggota boleh datang dalam urutan apa pun. Yang dilarang adalah anggota yang
 * sama muncul lagi sebelum seluruh set lengkap; scan terakhir menutup putaran.
 */
export function evaluasiScanAnggotaMold(
  memberPartIds: readonly number[],
  scannedPartIds: readonly number[],
  nextPartId: number,
): MoldCycleDecision {
  const members = new Set(memberPartIds);
  if (!members.has(nextPartId)) return 'NOT_MEMBER';

  const scanned = new Set(scannedPartIds);
  if (scanned.has(nextPartId)) return 'DUPLICATE';
  scanned.add(nextPartId);
  return [...members].every((id) => scanned.has(id)) ? 'COMPLETED' : 'ACCEPTED';
}
