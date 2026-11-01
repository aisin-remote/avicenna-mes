import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  bacaKatalogProses,
  getDb,
  closeDb,
  eq,
  and,
  sql,
  count,
  inArray,
  parts,
  plants,
  customers,
  customerParts,
  locations,
  deliveries,
  kanbans,
  kanbanItems,
  deliveryKanbans,
  mutations,
  deliverySyncs,
} from '@avicenna/db';
import { productionDayWindow, DELIVERY_DAY_START_HOUR, bacaKanban } from '@avicenna/domain';
import { LoadingService } from './loading.service';
import { StagingPullService } from '../staging/staging-pull.service';
import type { StagingDbService } from '../staging/staging-db.service';
import { SapOutboxService } from '../sap/sap-outbox.service';
import type { Database } from '@avicenna/db';

/** Check opt-in: membuat fixture QA sendiri, tidak mengubah transaksi/master lama. */
async function main() {
  if (process.env.DELIVERY_TRIAL_CHECK !== 'true')
    throw new Error('Set DELIVERY_TRIAL_CHECK=true untuk membuat fixture QA lokal.');
  if ((process.env.STAGING_PUSH_ENABLED ?? '').toLowerCase() === 'true')
    throw new Error('Matikan push staging sebelum trial.');
  const rootDb = getDb();
  const rollback = Error('ROLLBACK_TRIAL');
  await assert.rejects(
    rootDb.transaction(async (tx) => {
      const db = tx as unknown as Database;
      const suffix = randomUUID().slice(0, 8);
      const now = new Date();
      const date = productionDayWindow(now, DELIVERY_DAY_START_HOUR).key;
      const number = `LL-TRIAL-QA-${suffix}`;
      const customerCode = `QA-${suffix}`;
      const customerPart = `QA-PART-${suffix}`;
      const [plant] = await db.select().from(plants).orderBy(plants.id).limit(1);
      assert(plant, 'Butuh plant lokal');
      const slocs = await db.select().from(locations).where(eq(locations.plantId, plant.id));
      // Lewat jenis: kode SLOC berbeda tiap pabrik (FG70/FG80/FG90).
      const source = slocs.find((row) => row.kind === 'FINISH_GOOD');
      const staging = slocs.find((row) => row.kind === 'STAGING');
      assert(source && staging, 'Butuh SLOC berjenis FINISH_GOOD dan STAGING');
      await db.insert(parts).values({
        plantId: plant.id,
        partNumber: `QA-DEL-${suffix}`,
        name: 'Part QA Delivery',
        backNumber: 'QA-BACK',
        processType: 'ASSEMBLING_UNIT_FG',
        qtyPerKanban: 20,
        trackingMode: 'QUANTITY',
      });
      const [part] = await db
        .select()
        .from(parts)
        .where(eq(parts.partNumber, `QA-DEL-${suffix}`));
      assert(part);
      await db.insert(customers).values({
        code: customerCode,
        name: `Customer QA Delivery ${suffix}`,
        partNumberFormat: 'NONE',
      });
      const [customer] = await db.select().from(customers).where(eq(customers.code, customerCode));
      assert(customer);
      await db
        .insert(customerParts)
        .values({ customerId: customer.id, partId: part.id, customerPartNumber: customerPart });
      const serials = [1, 2, 3].map((index) => `QA-${suffix}-${index}`);
      for (const serial of serials) {
        await db.insert(kanbans).values({
          plantId: plant.id,
          partId: part.id,
          serialNumber: serial,
          qtyPerBox: 20,
          unitPerKanban: 1,
          owner: 'INTERNAL',
          status: 'PRODUCED',
          producedAt: now,
        });
        const [card] = await db
          .select()
          .from(kanbans)
          .where(and(eq(kanbans.partId, part.id), eq(kanbans.serialNumber, serial)));
        assert(card);
        await db
          .insert(kanbanItems)
          .values({ kanbanId: card.id, serialNumber: `UNIT-${serial}`, attachedAt: now });
      }
      await db.insert(mutations).values({
        plantId: plant.id,
        partId: part.id,
        locationId: source.id,
        type: 'ADJUSTMENT',
        qty: '60',
        occurredAt: now,
        note: `Stok fixture ${number}`,
      });
      const base = {
        delNo: `${number}   `,
        customerCode: `${customerCode} `,
        destination: 'QA',
        manifestNumber: `MNF-${suffix}`,
        pdsNumber: `PDS-${suffix}`,
        cycle: 1,
        deliveryDate: date.replaceAll('-', ''),
        actualDeliveryDate: '00000000',
        purchaseOrderNumber: 'PO-QA ',
        salesOrganization: 'J901 ',
        distributionChannel: 'C1',
        division: '01',
        deliveryType: 'ZMAK',
        sapGiStatus: 'A ',
        invoiceNumber: 'NULL',
        qcStatus: '0',
        sapHeaderMovementStatus: '0',
        sapLineMovementStatus: '0',
        sapReceiveStatus: '0',
        sapReceiveDate: '00000000',
        sapReceiveTime: 'NULL',
        headerDeleted: '',
        partNumber: `${part.partNumber} `,
        customerPartNumber: `${customerPart} `,
        plannedQty: 20,
        deliveryQty: 20,
        qtyPerBox: 20,
        itemType: 'ZMAK',
        lineDeleted: '',
      };
      let rows = [
        { ...base, deliveryItem: '000010' },
        { ...base, deliveryItem: '000020' },
        {
          ...base,
          delNo: `LL-TRIAL-MISSING-${suffix}`,
          customerCode: 'QA-NO-MASTER',
          deliveryItem: '000010',
        },
      ];
      const mockStaging = {
        tarikAktif: true,
        terkonfigurasi: true,
        query: async () => rows,
      } as unknown as StagingDbService;
      const importer = new StagingPullService(db, mockStaging);
      const imported = await importer.tarikPengiriman(now, false);
      assert.equal(imported.baru, 1);
      assert.equal(imported.dilewati, 1);
      const [doc] = await db.select().from(deliveries).where(eq(deliveries.documentNumber, number));
      assert(doc);
      assert.equal(doc.purchaseOrderNumber, 'PO-QA');
      assert.equal(doc.invoiceNumber, null);
      assert.equal(doc.sapActualDeliveryDate, null);
      assert.equal(doc.sapGiStatus, 'A');
      const service = new LoadingService(db);
      assert.equal((await service.findOne(doc.id)).lines.length, 2, 'Satu part, dua item SAP');
      await db.insert(kanbans).values([
        {
          plantId: plant.id,
          partId: part.id,
          serialNumber: `${suffix}-CUSTOMER`,
          owner: 'CUSTOMER',
        },
        { plantId: plant.id, partId: part.id, serialNumber: `${suffix}-INACTIVE`, isActive: false },
        {
          plantId: plant.id,
          partId: part.id,
          serialNumber: `${suffix}-CANCELLED`,
          status: 'CANCELLED',
        },
      ]);
      const printable = await service.internalKanbans(doc.id);
      assert.equal(
        printable.data.length,
        3,
        'Dua item SAP tidak menggandakan kartu; kartu customer/nonaktif/batal tidak dicetak internal.',
      );
      for (const label of printable.data) {
        assert(label.barcode);
        assert.equal(bacaKanban(label.barcode).serialNumber, label.serialNumber);
        assert.equal(bacaKanban(label.barcode).backNumber, 'QA-BACK');
        assert.equal(label.qtyPerBox, 20);
      }
      assert.equal((await service.internalKanbans(doc.id, serials[0])).data.length, 1);
      assert.equal(
        (await service.findOne(doc.id)).lines[0]?.pickedKanban,
        0,
        'Cetak tidak mencatat pulling.',
      );
      await assert.rejects(
        service.internalKanbans(doc.id, '', {
          kind: 'device',
          sub: 1,
          code: 'OTHER-PLANT',
          plantId: plant.id + 99999,
        }),
        /pabrik lain/,
      );
      const validRows = rows;
      rows = validRows.map((row) => ({ ...row, deliveryItem: '000010' }));
      assert.equal(
        (await importer.tarikPengiriman(now, false)).dilewati,
        2,
        'Nomor item duplikat ditahan',
      );
      rows = validRows.map((row) => ({ ...row, plannedQty: -1 }));
      assert.equal((await importer.tarikPengiriman(now, false)).dilewati, 2, 'Qty negatif ditahan');
      rows = validRows;
      await importer.tarikPengiriman(now, false);
      assert.equal(
        (await service.findOne(doc.id)).lines.length,
        2,
        'Impor ulang tidak menggandakan item',
      );
      const pull = (sequence: number, clientRef = randomUUID()) =>
        service.scan({
          deliveryId: doc.id,
          phase: 'PULLING',
          customerPart: `${customerCode}~${customerPart}~${number}~${sequence}`,
          internalKanban: printable.data.find(
            (card) => card.serialNumber === serials[sequence - 1],
          )!.barcode!,
          clientRef,
        });
      const ref = randomUUID();
      const first = await pull(1, ref);
      const retry = await pull(1, ref);
      assert.equal(retry.lineId, first.lineId);
      assert.equal(retry.totals.pickedKanban, 1);
      await assert.rejects(pull(1), /sudah discan/);
      const second = await pull(2);
      assert.notEqual(second.lineId, first.lineId, 'Part yang sama mengisi item SAP berikutnya');
      const wrong = await service.scan({
        deliveryId: doc.id,
        phase: 'PULLING',
        customerPart: 'UNKNOWN-PART',
      });
      assert.equal(wrong.status, 'REJECTED');
      await service.undoScan(doc.id, second.lineId!, 'PULLING', undefined, 'Koreksi trial');
      assert.equal(
        (await pull(2)).totals.pickedKanban,
        2,
        'Kanban dapat discan ulang setelah undo',
      );
      rows = rows.map((row) => ({ ...row, qtyPerBox: 10 }));
      const changed = await importer.tarikPengiriman(now, false);
      assert(changed.catatan.some((note) => note.includes('setelah discan')));
      assert.equal((await service.findOne(doc.id)).lines[0]?.qtyPerKanban, 20);
      await service.completePicking(doc.id);
      await service.completePicking(doc.id);
      await assert.rejects(service.ship(doc.id), /Absensi Driver/);
      const flow = (await service.intercompanyFlow(doc.id)).data;
      assert(flow);
      /*
       * Layanan dibuat langsung, tanpa wadah DI. Katalog jenis prosesnya karena itu
       * dibaca di sini dan diberikan sebagai layanan tiruan — isinya sama dengan
       * yang dibaca aplikasi sungguhan, hanya tanpa cache.
       */
      const outbox = new SapOutboxService(db, {
        katalog: () => bacaKatalogProses(db, { termasukNonaktif: true }),
        segarkan: () => undefined,
      } as never);
      const gi = flow.steps.find((s) => s.type === 'DELIVERY_GI_AIIA');
      assert(gi);
      assert.equal(gi.isSimulation, true, 'Dokumen LL-TRIAL ditandai simulasi sejak GI pertama');
      assert.equal((await outbox.simulateDelivery(gi.id, 'REJECTED')).status, 'REJECTED');
      assert.equal(
        (await service.list({ page: 1, perPage: 100, query: number, attention: 'only' })).data
          .length,
        1,
      );
      await outbox.simulateDelivery(gi.id, 'PENDING');
      await outbox.simulateDelivery(gi.id, 'CONFIRMED');
      const gr = (await service.intercompanyFlow(doc.id)).data!.steps.find(
        (s) => s.type === 'DELIVERY_GR_AII',
      );
      assert(gr);
      await outbox.simulateDelivery(gr.id, 'CONFIRMED');
      const issued = (await service.deliveryOrder(doc.id)).data;
      assert(issued?.isSimulation);
      const driver = await service.scanDriver(issued.number!, undefined);
      assert(!driver.selectionRequired);
      const finalGi = driver.flow.steps.find((s) => s.type === 'DELIVERY_GI_AII');
      assert(finalGi);
      await outbox.simulateDelivery(finalGi.id, 'CONFIRMED');
      /*
       * Kartu yang ikut truk harus kembali ke peredaran saat GI AII terkonfirmasi.
       * Kartu yang TIDAK di-pull tidak boleh ikut terlepas — melepas kartu yang
       * masih memegang barang berarti barang itu hilang dari catatan.
       */
      const kartuSesudah = await db
        .select({
          id: kanbans.id,
          serial: kanbans.serialNumber,
          status: kanbans.status,
          cycleCount: kanbans.cycleCount,
          releasedAt: kanbans.releasedAt,
        })
        .from(kanbans)
        .where(and(eq(kanbans.partId, part.id), inArray(kanbans.serialNumber, serials)));
      const ikutTruk = kartuSesudah.filter((k) => k.serial !== serials[2]);
      assert.equal(ikutTruk.length, 2, 'Dua kartu ikut truk');
      for (const k of ikutTruk) {
        assert.equal(k.status, 'AVAILABLE', `Kartu ${k.serial} kembali ke peredaran`);
        assert.equal(k.cycleCount, 1, `Putaran kartu ${k.serial} bertambah satu`);
        assert(k.releasedAt, `Waktu lepas kartu ${k.serial} tercatat`);
        const [isi] = await db
          .select({ n: count() })
          .from(kanbanItems)
          .where(eq(kanbanItems.kanbanId, k.id));
        assert.equal(Number(isi?.n ?? 0), 0, `Kartu ${k.serial} dikosongkan`);
      }
      const tidakDipull = kartuSesudah.find((k) => k.serial === serials[2]);
      assert.equal(tidakDipull?.cycleCount, 0, 'Kartu yang tidak di-pull tidak ikut terlepas');
      assert.equal(tidakDipull?.status, 'PRODUCED', 'Kartu yang tidak di-pull tetap memegang barang');
      const penghubung = await db
        .select({ owner: deliveryKanbans.owner })
        .from(deliveryKanbans)
        .where(eq(deliveryKanbans.deliveryId, doc.id));
      assert.equal(penghubung.length, 2, 'Dua kartu tercatat ikut pengiriman ini');
      assert(penghubung.every((p) => p.owner === 'INTERNAL'), 'Pemilik kartu disalin');
      await assert.rejects(
        service.undoScan(doc.id, first.lineId!, 'PULLING', undefined, 'Sudah berangkat'),
        /ditutup/,
      );
      const returned = await service.receiveReturnedDocument(number);
      assert.equal(returned.status, 'RECEIVED');
      assert.equal((await service.receiveReturnedDocument(number)).alreadyReceived, true);
      const history = await service.history(doc.id);
      assert(
        history.scans.some(
          (event) => (event.meta as { reason?: string })?.reason === 'Koreksi trial',
        ),
      );
      assert.equal(history.movements.filter((event) => event.type === 'DELIVERY_OUT').length, 2);
      /*
       * Nama kolom DIKUTIP, dan hasilnya dibaca lewat .rows.
       *
       * Keduanya sisa MySQL: tanpa kutip, Postgres mencari `flt_qty` huruf kecil
       * dan gagal; dan [0] pada QueryResult node-postgres selalu undefined,
       * sehingga saldonya terbaca NaN alih-alih angka yang diperiksa.
       */
      const [balance] =
        (
          (await db.execute(
            sql`SELECT SUM("FLT_QTY") AS qty FROM inventory."TT_STOCK_MUTATION" WHERE "INT_PART_ID" = ${part.id}`,
          )) as unknown as { rows?: Array<{ qty: string }> }
        ).rows ?? [];
      assert.equal(Number(balance?.qty), 20);
      await db
        .update(deliverySyncs)
        .set({
          result: {
            ...changed,
            catatan: [
              'TRIAL lokal: hasil impor dari fixture, bukan koneksi SAP.',
              ...changed.catatan,
            ],
          },
        })
        .where(eq(deliverySyncs.operationalDate, date));
      console.log(`Delivery integration checks passed: ${number}, id=${doc.id}, date=${date}`);
      console.log(
        'Tested: import/item identity, 3-way pulling, retry/duplicate/undo, source refresh, intercompany GI/GR simulation, kanban release, return/audit. Fixtures rolled back.',
      );
      throw rollback;
    }),
    (e) => {
      if (e !== rollback) throw e;
      return true;
    },
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
