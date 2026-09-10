import 'server-only';
import { apiFetch } from './api';

export interface BackwardTrace {
  serial: string;
  found: boolean;
  produced: Array<{
    partNumber: string | null;
    partName: string | null;
    lineCode: string | null;
    lineName: string | null;
    processType: string | null;
    scannedAt: string;
    qty: number;
  }>;
  components: TraceComponent[];
  replaced: TraceComponent[];
}

export interface TraceComponent {
  id: number;
  componentPartNumber: string | null;
  componentPartName: string | null;
  componentSerial: string | null;
  lotNumber: string | null;
  supplierLotNumber: string | null;
  supplierName: string | null;
  qty: string;
  evidence: string;
  occurredAt: string;
  supersededAt: string | null;
}

export interface ForwardTrace {
  found: boolean;
  lot: {
    lotNumber: string;
    supplierLotNumber: string | null;
    supplierName: string | null;
    partNumber: string | null;
    partName: string | null;
    receivedAt: string | null;
    initialQty: string;
    status: string;
  } | null;
  totalUnits: number;
  units: Array<{
    parentSerial: string;
    parentPartNumber: string | null;
    parentPartName: string | null;
    qty: string;
    evidence: string;
    occurredAt: string;
    supersededAt: string | null;
  }>;
}

export function traceBackward(serial: string): Promise<BackwardTrace> {
  return apiFetch<BackwardTrace>(`/trace/backward?serial=${encodeURIComponent(serial)}`);
}

export function traceForward(lot: string): Promise<ForwardTrace> {
  return apiFetch<ForwardTrace>(`/trace/forward?lot=${encodeURIComponent(lot)}`);
}
