import type { MasterEntity } from '@avicenna/contracts';
import {
  plants,
  lines,
  parts,
  customers,
  suppliers,
  machines,
  toolings,
  locations,
  ngMasters,
} from './schema/index';

/**
 * Pemetaan kunci entitas master ke tabel Drizzle-nya.
 *
 * Dipisah dari definisi entitas di @avicenna/contracts supaya paket kontrak
 * tetap bebas dari ketergantungan pada database — kontrak dipakai juga oleh
 * browser, dan tidak boleh menyeret driver MySQL ke sana.
 */
export const MASTER_TABLES = {
  plants,
  lines,
  parts,
  customers,
  suppliers,
  machines,
  toolings,
  locations,
  'ng-masters': ngMasters,
} as const;

export type MasterTable = (typeof MASTER_TABLES)[MasterEntity];

export function getMasterTable(entity: MasterEntity): MasterTable {
  return MASTER_TABLES[entity];
}
