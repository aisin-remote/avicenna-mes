/** Nama antrean dipusatkan supaya producer dan worker tidak pernah beda tulisan. */
export const QUEUES = {
  STOCK: 'stock',
  REPORT: 'report',
  SYNC: 'sync',
  NOTIFICATION: 'notification',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = {
  RECALC_STOCK_BALANCE: 'recalc-stock-balance',
  EXPORT_EXCEL: 'export-excel',
  SYNC_J922: 'sync-j922',
  SEND_NOTIFICATION: 'send-notification',
} as const;
