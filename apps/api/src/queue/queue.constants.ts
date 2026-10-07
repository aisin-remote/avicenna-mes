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
  BACKFLUSH_CONSUMPTION: 'backflush-consumption',
  EXPORT_EXCEL: 'export-excel',
  SYNC_J922: 'sync-j922',
  COLLECT_SAP_OUTBOX: 'collect-sap-outbox',
  FLUSH_SAP_OUTBOX: 'flush-sap-outbox',
  /** Membaca flag balasan yang ditulis SAP di database jembatan. */
  ACK_SAP_STAGING: 'ack-sap-staging',
  /** Menarik master data dari database jembatan. */
  PULL_SAP_MASTER: 'pull-sap-master',
  /** Menarik loading list hari aktif (06:00-06:00) dari database jembatan. */
  PULL_SAP_DELIVERIES: 'pull-sap-deliveries',
  SEND_NOTIFICATION: 'send-notification',
} as const;
