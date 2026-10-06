import mysql from 'mysql2/promise';
import type { AresOrderSource } from '@avicenna/contracts';

/** SELECT saja; gunakan akun ARES dengan hak baca saja di deployment. */
export async function readAresOrderSheet(
  orderNumber: string,
  revision: number,
): Promise<AresOrderSource | null> {
  const uri = process.env.ARES_DATABASE_URL;
  if (!uri) throw new Error('Koneksi ARES belum diisi (ARES_DATABASE_URL).');
  const db = await mysql.createConnection({ uri, connectTimeout: 5000, dateStrings: true });
  try {
    const [headers] = await db.execute<mysql.RowDataPacket[]>(
      `
      SELECT h.ID AS id, h.PICKLIST_NO AS orderNumber, h.REVISION AS revision,
        p.CODE AS plantCode, v.SAP_VENDOR_NO AS supplierCode, v.NAME AS supplierName,
        h.STATUS AS status, h.DELIVERY_DATE AS deliveryDate, h.ARRIVAL_TIME AS arrivalTime, h.CYCLE AS cycle
      FROM TT_PICKLIST_H h JOIN TM_PLANT p ON p.ID=h.PLANT_ID JOIN TM_VENDOR v ON v.ID=h.VENDOR_ID
      WHERE h.PICKLIST_NO=? AND h.REVISION=? LIMIT 1`,
      [orderNumber, revision],
    );
    if (!headers[0]) return null;
    const [lines] = await db.execute<mysql.RowDataPacket[]>(
      `
      SELECT l.ID AS id, l.VENDOR_PART_ID AS vendorPartId, p.PART_NO AS partNumber,
        p.SAP_MATERIAL_NO AS materialNumber, p.NAME AS partName, vp.BACK_NO AS backNumber,
        p.UOM AS uom, l.QTY_PER_BOX AS qtyPerBox, l.BOX_ORDERED AS boxOrdered,
        l.BOX_SHIPPED AS boxShipped, l.SAP_PO_NO AS poNumber, l.SAP_PO_ITEM AS poItem
      FROM TT_PICKLIST_L l JOIN TM_VENDOR_PARTS vp ON vp.ID=l.VENDOR_PART_ID
        JOIN TM_PARTS p ON p.ID=vp.PART_ID
      WHERE l.PICKLIST_ID=? ORDER BY l.ID`,
      [headers[0].id],
    );
    const [kanbans] = await db.execute<mysql.RowDataPacket[]>(
      `
      SELECT k.ID AS id, k.PICKLIST_LINE_ID AS lineId, k.SERIAL AS serial, k.STATUS AS status,
        h.REVISION AS revision
      FROM TM_KANBAN k JOIN TT_PICKLIST_L l ON l.ID=k.PICKLIST_LINE_ID
        JOIN TT_PICKLIST_H h ON h.ID=l.PICKLIST_ID WHERE h.ID=? ORDER BY k.SERIAL`,
      [headers[0].id],
    );
    return { ...headers[0], lines, kanbans } as AresOrderSource;
  } finally {
    await db.end();
  }
}
