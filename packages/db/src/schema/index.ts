/**
 * Skema terpadu Avicenna MES.
 *
 * Status: DRAFT untuk direview tim (Fase 0). Struktur di sini adalah hasil
 * pemetaan avicenna (die casting) + bella (injection) — lihat
 * docs/domain-glossary.md untuk kamus istilah lama -> baru.
 *
 * Tiga aturan yang dipegang di seluruh skema:
 *  1. Tabel event (scan_events, kanban_events, mutations, machine_events)
 *     bersifat append-only. Koreksi = baris baru, bukan UPDATE.
 *  2. Saldo/agregat (stock_balances) adalah turunan dan bisa dibangun ulang.
 *  3. Setiap tabel operasional membawa plant_id.
 */
export * from './_shared';
export * from './org';
export * from './master';
export * from './kanban';
export * from './production';
export * from './inventory';
export * from './quality';
export * from './delivery';
export * from './machine';
export * from './supply';
export * from './scrap';
export * from './sap';
