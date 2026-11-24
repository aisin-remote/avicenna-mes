import type { DeliveryOrderSnapshot } from '@avicenna/contracts';
import type { sapOutbox } from '@avicenna/db';
import type { StagingDbService } from './staging-db.service';
import { GOODS_MOVEMENT, keTanggalStaging, keJamStaging } from './staging-tables';

const PLANT: Record<string, string> = { BODY: '700', UNIT: '800', ELC: '900' };

function text(value: string | null | undefined, width: number, name: string) {
  const result = value?.trim();
  if (!result || result.length > width)
    throw new Error(`${name} wajib diisi, maksimal ${width} karakter.`);
  return result;
}

export function finishPullingMovement(snapshot: DeliveryOrderSnapshot) {
  const pds = text(snapshot?.pdsNumber, 15, 'PDS');
  if (!Array.isArray(snapshot?.lines) || !snapshot.lines.length)
    throw new Error('Snapshot Finish Pulling belum memiliki item.');
  const lines = snapshot.lines.map((line) => {
    const plant = PLANT[line.fgPlantCode?.trim() ?? ''];
    if (!plant || line.fgLocationKind !== 'FINISH_GOOD')
      throw new Error('Plant/lokasi FG pulling belum lengkap: BODY=700, UNIT=800, ELC=900.');
    if (!Number.isSafeInteger(line.pickedQty) || line.pickedQty <= 0 || line.pickedQty > 2147483647)
      throw new Error('Qty Finish Pulling harus bilangan bulat positif dalam rentang SQL int.');
    return {
      plant,
      partNumber: text(line.partNumber, 18, 'Material'),
      qty: line.pickedQty,
      slocFrom: text(line.fgLocationCode, 4, 'SLOC FG asal'),
      deliveryNumber: text(line.sapDeliveryNumber, 10, 'Nomor delivery SAP'),
      deliveryItem: text(line.sapItemNumber, 6, 'Nomor item delivery SAP'),
      uom: text(line.uom, 3, 'UOM'),
    };
  });
  if (new Set(lines.map((line) => line.plant)).size !== 1)
    throw new Error(
      'Satu request Goods Movement harus memiliki satu plant FG; PDS lintas plant perlu dipisah.',
    );
  const keys = lines.map((line) => `${line.deliveryNumber}:${line.deliveryItem}`);
  if (new Set(keys).size !== keys.length)
    throw new Error('Nomor delivery/item SAP pada snapshot duplikat.');
  return { plant: lines[0]!.plant, pds, lines };
}

function tableName(name: string) {
  const parts = name.replace(/[\[\]]/g, '').split('.');
  if (parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_$#]*$/.test(part)))
    throw new Error('Nama tabel staging tidak valid.');
  return parts.map((part) => `[${part}]`).join('.');
}

export async function storeFinishPullingMovement(
  staging: Pick<StagingDbService, 'transaksi'>,
  row: typeof sapOutbox.$inferSelect,
) {
  if (
    row.sourceTable !== 'TT_DELIVERY_ORDER' ||
    row.docType !== 'DELIVERY_GI_AIIA' ||
    row.isSimulation
  )
    throw new Error('Writer Goods Movement hanya untuk Finish Pulling nyata.');
  const payload = row.payload as { snapshot: DeliveryOrderSnapshot };
  const plan = finishPullingMovement(payload?.snapshot);
  const reference = text(`AVI-FP-${row.id}`, 25, 'Referensi Goods Movement');
  const h = tableName(GOODS_MOVEMENT.kepala);
  const l = tableName(GOODS_MOVEMENT.baris);
  return staging.transaksi(async (tx) => {
    const query = async <T>(command: string, params: Record<string, unknown>) => {
      const request = tx.request();
      for (const [name, value] of Object.entries(params)) request.input(name, value);
      return (await request.query<T>(command)).recordset;
    };
    // SQL-side lock also covers a retry after SQL committed but the local outbox update failed.
    const [lock] = await query<{ result: number }>(
      `DECLARE @result int;
       EXEC @result = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive',
         @LockOwner='Transaction', @LockTimeout=10000;
       SELECT @result AS result;`,
      { resource: `avicenna:finish-pulling:${row.id}` },
    );
    if (!lock || lock.result < 0)
      throw new Error('Request Goods Movement sedang diproses worker lain.');
    const existing = await query<{
      number: number;
      plant: string;
      typeTrans: string;
      movementType: string;
    }>(
      `SELECT INT_NUMBER AS number, CHR_PLANT AS plant, CHR_TYPE_TRANS AS typeTrans,
         CHR_MVMT_TYPE AS movementType FROM ${h} WHERE CHR_REMARKS = @reference`,
      { reference },
    );
    if (existing.length > 1)
      throw new Error('Referensi Goods Movement duplikat; perlu rekonsiliasi.');
    if (existing[0]) {
      const source = existing[0];
      const number = Number(source.number);
      if (
        !Number.isSafeInteger(number) ||
        number <= 0 ||
        (row.stagingNumber != null && row.stagingNumber !== number) ||
        source.plant.trim() !== plan.plant ||
        source.typeTrans.trim() !== 'NODL' ||
        source.movementType.trim() !== '601'
      )
        throw new Error(
          'Header Goods Movement sebelumnya tidak cocok; request tidak dikirim ulang.',
        );
      const previous = await query<{
        id: number;
        part: string;
        qty: number;
        sloc: string;
        delivery: string;
        item: string;
        pds: string;
        uom: string;
      }>(
        `SELECT INT_NUMBER_ITEM AS id, CHR_PART_NO AS part, INT_TOTAL_QTY AS qty,
           CHR_SLOC_FROM AS sloc, CHR_DEL_NO AS delivery, CHR_DEL_ITEM AS item,
           CHR_PDS_NO AS pds, CHR_UOM AS uom FROM ${l} WHERE INT_NUMBER = @number`,
        { number },
      );
      const key = (values: unknown[]) =>
        JSON.stringify(values.map((v) => (typeof v === 'string' ? v.trim() : v)));
      const wanted = plan.lines
        .map((line) =>
          key([
            line.partNumber,
            line.qty,
            line.slocFrom,
            line.deliveryNumber,
            line.deliveryItem,
            plan.pds,
            line.uom,
          ]),
        )
        .sort();
      const actual = previous
        .map((line) =>
          key([line.part, line.qty, line.sloc, line.delivery, line.item, line.pds, line.uom]),
        )
        .sort();
      if (wanted.length !== actual.length || wanted.some((value, i) => value !== actual[i]))
        throw new Error('Item Goods Movement sebelumnya tidak cocok; request tidak dikirim ulang.');
      return { number, itemNumbers: previous.map((line) => Number(line.id)) };
    }
    if (row.stagingNumber != null)
      throw new Error(
        'Goods Movement yang pernah dikirim tidak ditemukan; tidak dibuat ulang otomatis.',
      );
    const now = new Date();
    const [header] = await query<{ number: number }>(
      `INSERT INTO ${h} (CHR_PLANT, CHR_DATE, CHR_DOCUMENT_DATE, CHR_MVMT_TYPE,
         CHR_TYPE_TRANS, CHR_VALIDATE, CHR_REMARKS, CHR_USER, CHR_DATE_ENTRY, CHR_TIME_ENTRY)
       OUTPUT INSERTED.INT_NUMBER AS number
       VALUES (@plant, @date, @date, '601', 'NODL', 'X', @reference, 'AVICENNA', @entryDate, @entryTime)`,
      {
        plant: plan.plant,
        date: keTanggalStaging(row.occurredAt),
        reference,
        entryDate: keTanggalStaging(now),
        entryTime: keJamStaging(now),
      },
    );
    const number = Number(header?.number);
    if (!Number.isSafeInteger(number) || number <= 0)
      throw new Error('INT_NUMBER Goods Movement tidak valid.');
    const itemNumbers: number[] = [];
    for (const line of plan.lines) {
      const [item] = await query<{ id: number }>(
        `INSERT INTO ${l} (INT_NUMBER, CHR_PART_NO, INT_TOTAL_QTY, CHR_UOM,
           CHR_SLOC_FROM, CHR_SLOC_TO, CHR_DEL_NO, CHR_DEL_ITEM, CHR_PDS_NO,
           CHR_MVMT_TYPE_L, CHR_UPLOAD, CHR_STATUS, CHR_PICK_STATUS, CHR_DATE_ENTRY, CHR_TIME_ENTRY)
         OUTPUT INSERTED.INT_NUMBER_ITEM AS id
         VALUES (@number, @part, @qty, @uom, @sloc, NULL, @delivery, @item, @pds,
           '601', '0', 'N', 'N', @entryDate, @entryTime)`,
        {
          number,
          part: line.partNumber,
          qty: line.qty,
          uom: line.uom,
          sloc: line.slocFrom,
          delivery: line.deliveryNumber,
          item: line.deliveryItem,
          pds: plan.pds,
          entryDate: keTanggalStaging(now),
          entryTime: keJamStaging(now),
        },
      );
      const id = Number(item?.id);
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new Error('INT_NUMBER_ITEM Goods Movement tidak valid.');
      itemNumbers.push(id);
    }
    return { number, itemNumbers };
  });
}
