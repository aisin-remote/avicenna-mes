export interface DeliveryOrderItem {
  id: number;
  deliveryId: number;
  partNumber: string | null;
  customerPartNumber: string | null;
  partName: string | null;
  uom: string | null;
  qtyPerKanban: number;
  pickedKanban: number;
  pickedQty: number;
  partId?: number;
  plantId?: number;
  stagingLocationId?: number | null;
  plantCode?: string | null;
  stagingLocationCode?: string | null;
}

/** Snapshot penerbitan: cetak ulang tidak membaca master/rencana yang dapat berubah. */
export interface DeliveryOrderSnapshot {
  deliveryIds?: number[];
  pdsNumber: string;
  qr: { value: string; source: 'MANIFEST' | 'PDS' };
  customerCode: string;
  customerName: string;
  documentNumbers: string[];
  deliveryDates: string[];
  deliveryLocations: string[];
  purchaseOrderNumbers: string[];
  planTimes: string[];
  lines: DeliveryOrderItem[];
}

export interface IssuedDeliveryOrder {
  number: string;
  issuedAt: string;
  snapshot: DeliveryOrderSnapshot;
  isSimulation?: boolean;
}

export const DELIVERY_SAP_STAGES = [
  'DELIVERY_GI_AIIA',
  'DELIVERY_GR_AII',
  'DELIVERY_GI_AII',
] as const;
export type DeliverySapStage = (typeof DELIVERY_SAP_STAGES)[number];
export const DELIVERY_SAP_LABELS: Record<DeliverySapStage, string> = {
  DELIVERY_GI_AIIA: 'GI AIIA',
  DELIVERY_GR_AII: 'GR AII',
  DELIVERY_GI_AII: 'GI AII',
};
export interface DeliveryFlow {
  orderId: number;
  number: string | null;
  pdsNumber: string;
  customerName: string;
  driverScannedAt: string | null;
  shippedAt: string | null;
  isSimulation: boolean;
  stage: 'WAITING_GI_AIIA' | 'WAITING_GR_AII' | 'READY' | 'WAITING_GI_AII' | 'SHIPPED' | 'BLOCKED';
  steps: Array<{
    id: number;
    type: DeliverySapStage;
    status: string;
    isSimulation: boolean;
    sapDocNumber: string | null;
    error: string | null;
  }>;
}

export interface DeliveryOrderResult {
  data: IssuedDeliveryOrder | null;
  reason?: string;
  flow?: DeliveryFlow | null;
}
