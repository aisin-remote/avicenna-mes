export const FINISH_PULLING_GI = 'FINISH_PULLING_GI';
export const GI_TABLE_HOLD =
  'Semua item Goods Movement sudah CHR_UPLOAD=X; menunggu tabel dan mapping GI.';
export const GM_WAIT = 'Menunggu request Finish Pulling tersimpan di Goods Movement.';

export interface GoodsMovementUpload {
  number: number;
  itemNumber: number | null;
  typeTrans: string | null;
  validate: string | null;
  upload: string | null;
  partNumber: string | null;
  qty: number | null;
}

export interface ExpectedGoodsMovementItem {
  partNumber: string | null;
  pickedQty: number;
}

export function checkGoodsMovementUpload(
  number: number,
  expected: ExpectedGoodsMovementItem[],
  rows: GoodsMovementUpload[],
) {
  const waiting = (reason: string) => ({ ready: false, reason });
  if (!Number.isSafeInteger(number) || number <= 0)
    return waiting('Referensi INT_NUMBER Goods Movement belum valid.');
  if (
    !expected.length ||
    expected.some((item) => !item.partNumber?.trim() || !(item.pickedQty > 0))
  )
    return waiting('Snapshot item Finish Pulling belum lengkap.');
  if (rows.length !== expected.length)
    return waiting(`Item Goods Movement belum cocok: ${rows.length}/${expected.length} baris.`);
  if (
    rows.some(
      (row) =>
        Number(row.number) !== number ||
        row.typeTrans?.trim() !== 'NODL' ||
        row.validate?.trim() !== 'X',
    )
  )
    return waiting('Header Goods Movement tidak cocok dengan request NODL yang tervalidasi.');
  const ids = rows.map((row) => Number(row.itemNumber));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== rows.length)
    return waiting('Identitas item Goods Movement tidak lengkap atau duplikat.');
  const key = (part: string | null, qty: number | null) => JSON.stringify([part?.trim(), qty]);
  const planned = expected.map((item) => key(item.partNumber, item.pickedQty)).sort();
  const actual = rows.map((row) => key(row.partNumber, row.qty)).sort();
  if (planned.some((item, i) => item !== actual[i]))
    return waiting('Material atau qty Goods Movement tidak cocok dengan snapshot Finish Pulling.');
  const uploaded = rows.filter((row) => row.upload?.trim() === 'X').length;
  if (uploaded !== rows.length)
    return waiting(
      `Menunggu CHR_UPLOAD=X pada seluruh item Goods Movement (${uploaded}/${rows.length}).`,
    );
  return { ready: true, reason: GI_TABLE_HOLD };
}
