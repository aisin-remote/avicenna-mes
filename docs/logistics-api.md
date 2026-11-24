# API Logistik AVICENNA

Rujukan lengkap endpoint domain logistik: loading list, dokumen pengiriman,
absensi driver, preparation, penerimaan barang, transfer antar lokasi, dan
jembatan SAP.

Disusun dari kode, bukan dari rencana. Setiap baris menunjuk berkas sumbernya
supaya bisa diperiksa ulang saat kode berubah.

Pendamping yang lebih dalam untuk satu endpoint: [delivery-rfid-api.md](delivery-rfid-api.md)
(RFID batch) dan [koleksi Postman](postman/avicenna-delivery-rfid.postman_collection.json).

---

## 1. Dasar

| Hal | Nilai |
|---|---|
| Prefix global | **tidak ada** — path langsung di akar, mis. `POST /loading/scan` |
| Port bawaan | `API_PORT`, default `3001`, bind `0.0.0.0` ([main.ts:88](../apps/api/src/main.ts:88)) |
| CORS | asal dari `WEB_ORIGIN` (dipisah koma), `credentials: true` |
| Batas body | ±27 MB, diturunkan dari `MAX_DELIVERY_DOCUMENT_BYTES` (20 MB base64 + margin) |
| Format tanggal | `YYYY-MM-DD` untuk query, ISO-8601 untuk nilai waktu di respons |
| Zona waktu | hari operasional dihitung di `Asia/Jakarta`, dimulai pukul **06:00** (`DELIVERY_DAY_START_HOUR`) |

Di produksi, reverse proxy hanya meneruskan `/realtime/` ke API; sisanya diakses
dari dalam jaringan. Lihat [docker/nginx/avicenna.conf.example](../docker/nginx/avicenna.conf.example).

### Bentuk galat

Semua galat lewat satu filter ([all-exceptions.filter.ts](../apps/api/src/common/all-exceptions.filter.ts)).

```json
{ "statusCode": 404, "error": "Not Found", "message": "Loading list tidak ditemukan" }
```

Galat validasi Zod punya bentuk tersendiri dengan `details` per kolom
([validation-error.ts:16](../apps/api/src/common/validation-error.ts:16)):

```json
{
  "statusCode": 400,
  "error": "ValidationError",
  "message": "Data yang dikirim tidak valid",
  "details": [{ "field": "tags.0.tagId", "message": "String must contain at least 1 character(s)" }]
}
```

Body kebesaran → `413 PayloadTooLarge`. Galat tak terduga → `500` dengan pesan
generik; detailnya hanya di log server.

---

## 2. Autentikasi

`JwtAuthGuard` dan `AdminGuard` terpasang global ([app.module.ts:72](../apps/api/src/app.module.ts:72)).
**Semua endpoint di dokumen ini butuh `Authorization: Bearer <token>`** kecuali
dua endpoint login.

### POST /auth/login — akun manusia

```json
{ "npk": "ADMIN", "password": "admin123" }
```

Respons `201`:

```json
{
  "accessToken": "eyJ...",
  "user": {
    "id": 1, "npk": "ADMIN", "name": "...", "role": "...",
    "roleKind": "ADMIN", "roleProcessGroup": null,
    "landing": "/dashboard", "plantId": 1
  }
}
```

`roleKind` salah satu `SCANNING` | `VIEW` | `ADMIN`. `landing` ditentukan server,
jangan dihitung ulang di klien.

### POST /auth/device — scanner / reader RFID

```json
{ "deviceCode": "RFID-TRIAL-01", "token": "<rahasia perangkat>" }
```

`token` adalah rahasia perangkat di master, **bukan EPC dan bukan password SAP**.
Masa berlaku dari `DEVICE_JWT_EXPIRES_IN` (bawaan `365d`); tidak ada endpoint
refresh — login ulang saat kedaluwarsa.

### GET /auth/me

Mengembalikan `req.principal` apa adanya: identitas yang sedang dipakai, baik
`kind: "user"` maupun `kind: "device"`.

### Otorisasi scan delivery

Dipusatkan di `authorizeScan()` ([loading.service.ts:88](../apps/api/src/loading/loading.service.ts:88)):

| Principal | Syarat |
|---|---|
| device | aktif, `kind` ∈ `RFID`/`SCANNER` (RFID saja untuk `/loading/rfid/batch`), dan `plantId` **sama** dengan pabrik loading list |
| user | `roleKind` ∈ `ADMIN`/`SCANNING`; selain ADMIN, `plantId` harus sama |

Gagal → `403`. Loading list tidak ada → `404`.

Endpoint bertanda **ADMIN** di bawah memakai `@AdminOnly()` dan hanya bisa
dipanggil user `roleKind: ADMIN`.

---

## 3. Loading list — `/loading`

Sumber: [loading.controller.ts](../apps/api/src/loading/loading.controller.ts).

Loading list **berasal dari SAP/staging**. MES tidak membuat dokumennya, hanya
menyimpan salinan operasional untuk pulling dan loading.

### Status dokumen

```
DRAFT → PICKING → PICKED → LOADING → SHIPPED → RECEIVED
                                   ↘ CANCELLED
```

`truckStatus` berdiri sendiri, tidak terikat status dokumen:
`PENDING` | `ARRIVED` | `LOADING` | `DEPARTED`.

Dua tahap scan (`phase`): **PULLING** memindahkan barang dari SLOC finish good
(PP02) ke staging (PP04) dan menambah `pickedKanban`; **LOADING** menaikkan ke
truk dan menambah `actualKanban`.

### GET /loading — daftar

| Query | Bawaan | Catatan |
|---|---|---|
| `page` | `1` | |
| `perPage` | `25` | maksimal `100` |
| `date` | hari operasional berjalan | wajib `YYYY-MM-DD`, kalau tidak `400` |
| `all` | — | `1` atau `true` mengabaikan filter tanggal |
| `q` | — | cocok ke nomor dokumen, manifest, PDS, atau **nama customer**; dipotong 128 karakter |
| `attention` | — | `only` hanya baris bermasalah, `all` semuanya |

Respons:

```json
{
  "data": [ /* LoadingSummary */ ],
  "meta": { "page": 1, "perPage": 25, "total": 11, "totalPages": 1 }
}
```

`LoadingSummary` ([loading.ts:100](../packages/contracts/src/loading.ts:100)):

```ts
{
  id, documentNumber, manifestNumber, pdsNumber, purchaseOrderNumber,
  deliveryType, sapGiStatus, customerName, deliveryDate, cycle,
  status, truckStatus,
  plannedKanban, pickedKanban, actualKanban,
  unmappedItems, invalidQtyPerBox, missingSloc,
  sapStatus, sapIsSimulation, sapDocNumber, sapError,
  attentionReason
}
```

`attentionReason` diturunkan server, urutan menangnya tetap
([loading-mode.ts:82](../packages/domain/src/loading-mode.ts:82)):

1. SAP `REJECTED`/`FAILED`/`HELD`
2. `invalidQtyPerBox` > 0 → "Qty per box belum lengkap"
3. `unmappedItems` > 0 → "Part customer belum termapping"
4. `missingSloc`
5. picked > planned
6. actual > picked
7. status ∈ PICKED/LOADING/SHIPPED/RECEIVED dengan picked < planned
8. status ∈ SHIPPED/RECEIVED dengan actual < picked

`null` berarti tidak ada yang perlu diperiksa.

### GET /loading/resolve?code= — cari dari barcode

Dipakai saat operator men-scan **nomor dokumen, manifest, atau PDS** — bukan id.
Pencocokan `OR` atas ketiganya ([loading.service.ts:196](../apps/api/src/loading/loading.service.ts:196)).

- Dipangkas spasi depan-belakang, maksimal 128 karakter.
- **Case-sensitive**: `dok-dum-2` tidak cocok dengan `DOK-DUM-2`.
- Satu manifest bisa menaungi beberapa loading list — semua kandidat dikembalikan.
- Kode kosong → `400`. Tidak ketemu → `404` `Manifest atau loading list "X" tidak ditemukan`.

```json
{
  "code": "LL-DUMMY-20261107-06",
  "matches": [
    { "id": 54, "documentNumber": "LL-DUMMY-20261107-06", "manifestNumber": "MNF-DUMMY-20261107-06",
      "customerName": "CUSTOMER DUMMY LOADING LIST", "deliveryDate": "2026-11-06",
      "cycle": 1, "status": "DRAFT" }
  ]
}
```

**Endpoint ini sengaja tidak memuat part.** Tugasnya hanya menjawab "barcode ini
dokumen yang mana", dan jawabannya bisa lebih dari satu. Item baru diambil di
panggilan berikutnya, `GET /loading/:id` untuk tiap `matches[].id` — kalau
dibuat satu panggilan, satu manifest berisi lima loading list akan mengirim
lima dokumen lengkap beserta seluruh barisnya hanya untuk memilih satu.

### GET /loading/sync-status?date=

`date` wajib `YYYY-MM-DD`, kalau tidak `400`. Mengembalikan `{ "data": ... }`
berisi baris `TT_DELIVERY_SYNC` untuk tanggal itu, atau `{ "data": null }` bila
tanggal tersebut belum pernah disinkronkan.

### GET /loading/:id — rincian

Header dokumen lengkap (termasuk kolom SAP: `salesOrganization`,
`distributionChannel`, `division`, `invoiceNumber`, `qcStatus`,
`sapHeaderMovementStatus`, `sapLineMovementStatus`, `sapReceiveStatus`,
`sapReceiveDate`, `sapReceiveTime`), ditambah:

- `loadingMode` — hasil `modeLoading()` dari `directKanban` customer dan
  `scanDirectKanbanSaatMuat` pabrik. Menentukan apakah kanban internal wajib discan.
- `lines[]` — `id, partId, partNumber, partName, uom, customerPartNumber,
  sapItemNumber, customerPartId, sapDeliveryQty, itemType, plannedKanban,
  pickedKanban, actualKanban, qtyPerKanban, plannedQty, pickedQty, actualQty`.

Tidak ada → `404`.

### GET /loading/:id/history

```json
{ "scans": [ ... ], "movements": [ ... ] }
```

`scans` maksimal 500 terbaru dari `TT_SCAN_EVENT` kind `DELIVERY`
(`id, at, rawCode, serialNumber, qty, meta, user`). `meta` memuat `phase`,
`method`, `deliveryId`, dan untuk RFID juga `rfidTagId`.

`movements` maksimal 500 mutasi stok terkait dokumen ini dan surat jalannya
(`id, at, type, partNumber, qty, note, user, location`).

### GET /loading/:id/internal-kanbans?q=

Kartu internal terdaftar untuk dicetak ulang. **Tidak membuat kartu baru dan
tidak membuat isi box.** Kartu di pabrik lain → `403` kecuali ADMIN.

### GET /loading/:id/delivery-order

Surat jalan (DO). Tiga kemungkinan respons:

```json
{ "data": null, "reason": "Surat jalan terbit setelah Finish Pulling seluruh loading list untuk PDS customer ini." }
{ "data": null, "reason": "Surat jalan menunggu konfirmasi GI AIIA dan GR AII dari SAP.", "flow": { ... } }
{ "data": { "number": "...", "issuedAt": "...", "snapshot": { ... }, "isSimulation": false }, "flow": { ... } }
```

DO terbit per **PDS customer**, bukan per loading list — satu PDS bisa memuat
beberapa loading list, dan DO baru keluar setelah semuanya selesai pulling.
Kalau ada loading list yang dibatalkan setelah DO terbit, `data` dikembalikan
`null` dengan alasan tersendiri supaya tidak dicetak ulang diam-diam.

### GET /loading/:id/intercompany

`{ "data": <flow> | null }` — status alur intercompany (GI AIIA → GR AII) untuk
surat jalan dokumen ini. `null` bila DO belum terbit.

### GET /loading/driver-status/:id

**Perhatian: `:id` di sini adalah id SURAT JALAN (delivery order), bukan id
loading list.** Bandingkan dengan `/loading/:id/intercompany` yang menerima id
loading list lalu menerjemahkannya sendiri. Tidak ketemu → `404 Surat jalan tidak ditemukan`.

### POST /loading/rfid/batch — tag dari aplikasi RFID

`HttpCode(200)`, bukan 201. Hanya perangkat `kind: RFID`.
Dokumen harus berstatus `DRAFT` atau `PICKING`, kalau tidak
`400 Pulling sudah ditutup atau loading list dibatalkan`.

```json
{
  "deliveryId": 43,
  "tags": [
    { "tagId": "10000000000D403501122154", "customerPart": "C-DM-LL-A" }
  ]
}
```

| Field | Wajib | Aturan |
|---|---|---|
| `deliveryId` | ya | integer positif |
| `tags` | ya | 1–200 objek |
| `tags[].tagId` | ya | 1–128 karakter, opaque, **case-sensitive** |
| `tags[].customerPart` | ya | 1–255 karakter — nomor part customer yang termapping ke baris loading list |
| `tags[].serialNumber` | tidak | 1–64 karakter |

Objek request dan tiap tag bersifat **strict**: field tambahan (`qty`,
`internalKanban`, `clientRef`, `phase`, `bypass`) ditolak `400`. Tahap selalu
`PULLING`.

Respons:

```json
{
  "deliveryId": 43,
  "phase": "PULLING",
  "summary": { "total": 5, "accepted": 5, "duplicate": 0, "rejected": 0 },
  "results": [
    { "index": 0, "tagId": "...", "status": "ACCEPTED", "message": "...", "lineId": 61, "partNumber": "DM-LL-A" }
  ],
  "totals": { "plannedKanban": 5, "pickedKanban": 5, "actualKanban": 0 }
}
```

**Partial success**: HTTP 200 tidak berarti semua tag diterima — baca `results`
per tag. Tag valid tetap tercatat walau tag lain ditolak.

Catatan perilaku yang mudah terlewat:

- Tag **tidak disimpan sebagai master**. Identitasnya dicatat di scan event
  sebagai `RFID:<sha256 tag, 59 karakter>`, dengan tag asli di `meta.rfidTagId`
  ([loading.service.ts:655](../apps/api/src/loading/loading.service.ts:655)).
  Pemetaan EPC → part adalah tanggung jawab aplikasi reader.
- Satu dokumen tidak boleh mencampur metode: kalau sudah ada scan barcode aktif,
  RFID ditolak, dan sebaliknya.
- Tag yang sama pada dokumen aktif lain → `400 Tag RFID masih tercatat pada loading list aktif lain`.
- Tidak boleh melewati rencana: `400 Jumlah RFID melebihi rencana kanban atau qty loading list`.
- Qty per box 0 → `400 Qty per box belum lengkap. Lengkapi master sebelum scan.`
- Tidak ada status `OVER` di jalur RFID.
- Batch **tidak** otomatis menjalankan Finish Pulling atau GI/GR.

### POST /loading/scan — barcode (tiga arah)

```ts
{
  deliveryId: number,            // wajib
  phase: 'PULLING' | 'LOADING',  // bawaan PULLING
  customerPart: string,          // wajib, 1–255 — barcode kanban customer
  internalPart?: string,         // ≤64
  internalKanban?: string,       // ≤255 — wajib pada mode tiga arah
  serialNumber?: string,         // ≤64
  clientRef?: string,            // ≤64 — kunci idempoten dari device
  groupDeliveryIds?: number[]    // 1–50 — pulling satu manifest sekaligus
}
```

`clientRef` penting untuk reader yang jaringannya putus-nyambung: tanpa itu,
kiriman ulang dihitung sebagai scan baru.

`groupDeliveryIds` dipakai saat men-scan satu manifest yang menaungi beberapa
loading list — server memilih loading list yang part-nya cocok dan masih
bersisa.

Respons `LoadingScanResult`:

```ts
{ status: 'ACCEPTED' | 'OVER' | 'REJECTED', phase, message, lineId, partNumber,
  convertedPartNumber, actualKanban, plannedKanban,
  totals: { plannedKanban, pickedKanban, actualKanban } }
```

Pemeriksaan kanban internal menolak box berisi part A dengan kartu part B,
dan menolak kartu yang isinya belum pernah discan di lini finish good.

#### Alur layar `/delivery-scan`: tiga scan, dua request

Layar pulling barcode meminta tiga kali scan, tetapi **hanya dua yang menjadi
panggilan API**. Scan kanban customer ditahan di browser sampai kanban internal
masuk, lalu keduanya dikirim dalam satu `POST /loading/scan`
([loading-scan.tsx:205](../apps/web/src/components/delivery/loading-scan.tsx:205)).

```
1. scan manifest / loading list  →  GET /loading/resolve?code=   (sekali per dokumen)
2. scan kanban customer          →  tidak ada request, ditahan di browser
3. scan kanban internal          →  POST /loading/scan
                                    { customerPart: <scan 2>, internalKanban: <scan 3> }
```

Mengirim dua request terpisah untuk scan 2 dan 3 bukan cuma boros — pencocokan
tiga arah memang butuh keduanya dalam satu permintaan, karena yang dibuktikan
adalah bahwa kartu internal itu milik part yang sama dengan label customer-nya.

Berapa kali scan per box ditentukan `loadingMode` di `GET /loading/:id`
([loading-mode.ts:43](../packages/domain/src/loading-mode.ts:43)):

| `loadingMode` | Kapan | Yang discan per box |
|---|---|---|
| `TIGA_ARAH` | customer **bukan** direct kanban | kanban customer **+** kanban internal |
| `KANBAN_CUSTOMER` | direct kanban, dan pabrik `scanDirectKanbanSaatMuat` | kanban customer saja |
| `TANPA_SCAN` | direct kanban, pabrik tidak scan saat muat | tidak ada |

Di luar `TIGA_ARAH`, satu scan = satu `POST`. `internalKanban` tidak dikirim,
dan server pun tidak memintanya.

Catatan implementasi yang berguna bagi klien lain:

- Antrean scan disimpan di `localStorage` dengan kunci
  `delivery-scan:<deliveryIds>:<phase>` dan dikirim **berurutan satu per satu**,
  bukan paralel — urutan itu yang menjaga hitungan tetap benar saat jaringan
  tersendat.
- Tiap item antrean membawa `clientRef` berupa UUID. Itu kunci idempotennya:
  kiriman ulang setelah jaringan putus tidak menghitung box yang sama dua kali.
- Saat yang discan manifest yang menaungi beberapa loading list, klien mengirim
  `groupDeliveryIds` berisi semua id-nya dan **server yang memilih** loading list
  tujuan — klien tidak menebak sendiri.

Jalur RFID (`POST /loading/rfid/batch`) berdiri sendiri: tidak ada kanban
internal di sana, dan satu permintaan membawa banyak box sekaligus.

#### Resep untuk scanner pihak ketiga

Tidak ada jalur khusus untuk aplikasi web — layar `/delivery-scan` memakai
endpoint yang sama persis. Urutan lengkapnya:

**1. Login perangkat.** Sekali, simpan tokennya.

```bash
curl -s -X POST "$BASE/auth/device" -H 'content-type: application/json' \
  -d '{"deviceCode":"SCAN-01","token":"<rahasia perangkat>"}'
```

**2. Scan manifest / loading list → cari dokumennya.**

```bash
curl -s -H "authorization: Bearer $TOKEN" \
  "$BASE/loading/resolve?code=MNF-DUMMY-20261107-01"
```

Dari `matches[]`, ambil yang `status` masih `DRAFT` atau `PICKING`. Untuk
pulling satu manifest, saring juga yang `manifestNumber`-nya sama dengan
dokumen pertama — loading list yang sudah ditutup jangan ikut dipull lagi.

**3. Ambil item tiap dokumen — di sinilah part number muncul.**

```bash
curl -s -H "authorization: Bearer $TOKEN" "$BASE/loading/49"
```

Satu panggilan per `matches[].id`, lalu gabungkan `lines` dari semuanya menjadi
satu daftar di layar scanner ([loading-scan.tsx:99](../apps/web/src/components/delivery/loading-scan.tsx:99)).
Yang dipakai dari tiap baris:

| Field | Untuk apa |
|---|---|
| `customerPartNumber` | judul baris; ini yang dicocokkan dengan barcode kanban customer |
| `partNumber`, `partName` | nomor dan nama part internal |
| `qtyPerKanban` | isi satu box |
| `plannedKanban` / `pickedKanban` | sasaran dan progres saat **PULLING** |
| `pickedKanban` / `actualKanban` | sasaran dan progres saat **LOADING** |
| `plannedQty`, `uom` | total rencana |
| `id` | `lineId` untuk undo |

Baca juga `loadingMode` di tingkat dokumen: `TIGA_ARAH` berarti scanner harus
menunggu dua barcode sebelum mengirim.

**4. Kirim scan.**

```bash
curl -s -X POST "$BASE/loading/scan" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{
    "deliveryId": 49, "phase": "PULLING",
    "customerPart": "<barcode kanban customer>",
    "internalKanban": "<barcode kanban internal>",
    "clientRef": "<uuid v4>",
    "groupDeliveryIds": [49, 50]
  }'
```

**5. Jangan ambil ulang dokumennya setiap kali.** Respons scan sudah membawa
`lineId`, `actualKanban`, `plannedKanban`, dan `totals` untuk seluruh dokumen —
cukup itu untuk memperbarui layar. `GET /loading/:id` hanya perlu dipanggil
lagi saat dokumen dibuka, bukan per box.

**6. Tutup pulling** dengan `POST /loading/49/pick` setelah semua baris penuh.

Tiga hal yang membuat scanner lapangan tidak salah hitung:

- Kirim scan **berurutan**, satu per satu, bukan paralel.
- Beri tiap scan `clientRef` UUID dan **pakai ulang UUID yang sama saat
  mengirim ulang** setelah jaringan putus. Itu satu-satunya cara server tahu
  itu kiriman ulang, bukan box kedua.
- Antrekan scan yang belum terkirim di penyimpanan lokal perangkat. Operator
  tidak akan berhenti men-scan hanya karena Wi-Fi gudang sedang jelek.

#### Siapa yang melakukan pencocokan tiga arah

**Bukan scanner, bukan layar — server.** Klien hanya mengirim dua barcode apa
adanya. Yang dibandingkan server bukan teks di layar, melainkan master:

1. `customerPart` dicocokkan ke baris loading list, berurutan sampai ketemu
   ([loading.service.ts:540](../apps/api/src/loading/loading.service.ts:540)):
   `customerPartNumber` hasil konversi → `partNumber` hasil konversi →
   `customerPartNumber` apa adanya → `partNumber` apa adanya. Di antara baris
   yang cocok, yang **masih bersisa** dipilih lebih dulu.
2. `internalKanban` diurai jadi nomor seri, serinya dicari di
   `kanban."TM_KANBAN"`, lalu `partId` kartu itu harus sama dengan `partId`
   baris yang sudah cocok di langkah 1.
3. Kartu itu juga harus ada isinya — minimal satu unit pernah ditempel di lini
   finish good.

Jadi informasi part di layar dipakai **operator** untuk tahu sisa berapa dan
part mana yang kurang, bukan dipakai mesin untuk mencocokkan.

Setelah `GET /loading/resolve`, layar memanggil `GET /loading/:id` untuk tiap id
(satu manifest = beberapa panggilan) dan menampilkan semua barisnya digabung
([picking/[id]/page.tsx](../apps/web/src/app/(station)/picking/[id]/page.tsx)).
Tiap baris memperlihatkan nomor part customer besar di atas, lalu
`partNumber · partName · plannedQty uom` di bawahnya, dan progres
`terscan / rencana` di kanan. Loading list yang sudah ditutup tidak ikut
ditampilkan walau satu manifest.

#### Kalau datanya memang tidak ada

Inilah sebabnya `unmappedItems` dan `invalidQtyPerBox` muncul di `GET /loading`
sebagai `attentionReason` — supaya ketahuan **sebelum** orang berdiri di gudang:

| Keadaan | Yang terjadi saat scan |
|---|---|
| `customerPartNumber` null (part belum termapping) | baris tetap tampil memakai `partNumber` sebagai pengganti, tetapi barcode customer tidak akan cocok → `Part "X" tidak ada dalam loading list ini.` |
| `qtyPerKanban` ≤ 0 | `400 Qty per box belum lengkap. Lengkapi master sebelum scan.` |
| seri kanban internal tidak terdaftar | `Kartu kanban internal seri X tidak terdaftar. Laporkan ke leader.` |
| kartu internal milik part lain | `Kanban internal ini milik part lain, bukan X. Periksa boxnya.` |
| kartu internal belum ada isinya | `Kartu kanban seri X kosong — isinya belum pernah discan di lini finish good.` |
| barcode internal tidak terbaca | `Barcode kanban internal tidak terbaca. Scan ulang kartunya.` |
| mode `TIGA_ARAH` tapi `internalKanban` tidak dikirim | `400 Scan kanban internal setelah kanban customer.` |
| SLOC asal/staging kosong | layar menolak di depan, sebelum scan pertama |

Empat pesan di tengah dicatat sebagai scan **REJECTED** — tercatat di riwayat,
tidak menambah hitungan. Yang berstatus `400` ditolak sebelum tercatat.

### POST /loading/:id/lines/:lineId/undo?phase=

Membatalkan satu kanban terakhir pada satu baris.

```json
{ "reason": "salah scan" }
```

`reason` wajib, 3–255 karakter. `phase` di query: `PULLING`, selain itu
dianggap `LOADING`. Event lama tetap utuh untuk audit — undo dicatat sebagai
kejadian baru, bukan penghapusan.

### POST /loading/:id/pick — Finish Pulling

Menutup tahap pulling: barang berpindah dari finish good ke staging, dan bila
seluruh loading list untuk PDS tersebut sudah selesai, surat jalan disiapkan.
Nomor PDS wajib ada, kalau tidak `400 Nomor PDS wajib tersedia`.
Dokumen `CANCELLED` → `400`. Dokumen yang sudah `SHIPPED`/`RECEIVED` → `400 Dokumen sudah berangkat; jangan memulai posting SAP baru`.

### POST /loading/:id/ship — **dinonaktifkan**

Selalu `400`:

> Keberangkatan wajib melalui Absensi Driver dan konfirmasi GI AII.

Endpointnya masih ada supaya klien lama mendapat pesan yang menjelaskan, bukan
404 yang membingungkan ([loading.service.ts:1430](../apps/api/src/loading/loading.service.ts:1430)).
Gunakan `/driver-attendance` sebagai gantinya.

### PATCH /loading/:id/truck

```json
{ "truckStatus": "ARRIVED" }
```

Nilai: `PENDING` | `ARRIVED` | `LOADING` | `DEPARTED`.
`DEPARTED` hanya boleh bila status dokumen sudah `SHIPPED` atau `RECEIVED` —
kalau tidak, `400 Truk berangkat setelah scan driver dan GI AII dikonfirmasi`.

Respons: `{ "id": 43, "truckStatus": "ARRIVED" }`.

### POST /loading/receive — surat jalan kembali

```json
{ "code": "<barcode surat jalan>" }
```

1–128 karakter, kosong → `400 Barcode surat jalan kosong`. Mencatat bukti barang
diterima customer.

---

## 4. Dokumen pengiriman — `/delivery-documents`

Sumber: [delivery-documents.controller.ts](../apps/api/src/loading/delivery-documents.controller.ts).

Arsip berkas yang menempel pada pengiriman. Jenis: `CUSTOMER_KANBAN`,
`MANIFEST`, `SKID_LABEL`. Batas berkas **20 MB**.

| Endpoint | Keterangan |
|---|---|
| `GET /delivery-documents?deliveryId=` | `deliveryId` wajib integer. Mengembalikan `{ reference: { type: 'PDS'\|'MANIFEST'\|'LOADING_LIST', number }, data: [...] }` |
| `POST /delivery-documents` | unggah; body `{ deliveryId, kind, filename, fileBase64 }` |
| `GET /delivery-documents/:id` | metadata saja: `{ id, kind, filename, byteSize, createdAt }` |
| `GET /delivery-documents/:id/file` | isi berkas; bukan JSON |

Arsip dikelompokkan per **PDS** bila ada, jatuh ke manifest lalu nomor loading
list — jadi berkas yang diunggah pada satu loading list terlihat juga dari
loading list lain dalam PDS yang sama.

---

## 5. Absensi driver — `/driver-attendance`

Sumber: [driver-attendance.controller.ts](../apps/api/src/loading/driver-attendance.controller.ts).

Inilah gerbang keberangkatan yang menggantikan `/loading/:id/ship`.

### GET /driver-attendance — papan

Query: `plantId` (opsional, integer positif).

```ts
{
  plantId, plants: [{ id, name }],
  destinations: [{ id, customerId, name, dock, logistic }],
  active: [ DriverAttendanceRow ]
}
```

### GET /driver-attendance/resolve?code=&plantId=

`code` wajib 1–128 karakter. Mencari DO dari barcode yang discan driver.

### GET /driver-attendance/history?from=&to=&page=&plantId=

`from` dan `to` wajib `YYYY-MM-DD` dan harus tanggal yang benar-benar ada
(31 Februari ditolak). `page` bawaan 1.

```json
{ "data": [ ... ], "total": 0, "page": 1, "perPage": 0 }
```

### GET /driver-attendance/export?from=&to=&page=&plantId=

Query sama dengan history. Mengembalikan **berkas .xlsx**, bukan JSON:
`absensi-driver-<from>-<to>.xlsx`, 13 kolom (NO, CUSTOMER, ROUTE/DOCK, CYCLE,
LP, TRUCK, START WIB, END WIB, DURASI, DN/DO, HELM, ROMPI, SEPATU). Baris
header dibekukan dan diberi autofilter. Durasi terisi "Sedang pickup" bila
sesinya belum ditutup.

### POST /driver-attendance/start

```ts
{
  plantId: number,            // wajib
  slot: 1 | 2,                // 1 = depan, 2 = belakang
  destinationId: number,      // wajib
  cycle: number,              // 1–10
  helmet: true, vest: true, shoes: true,   // ketiganya HARUS true
  photo: "data:image/jpeg;base64,...",     // jpeg | png | webp
  orderIds: number[]          // 1–100 DO, tidak boleh duplikat
}
```

Tiga field APD **wajib bernilai `true`**, bukan boolean biasa — `false` ditolak
dengan pesan "Helm safety wajib dipakai." dan seterusnya. Foto wajib dan harus
data-URL yang cocok polanya, kalau tidak "Ambil foto driver terlebih dulu.".
DO ganda dalam satu kiriman → "DO tidak boleh didaftarkan dua kali.".

### POST /driver-attendance/:id/finish

Menutup sesi pickup.

### GET /driver-attendance/:id/photo

Mengembalikan foto driver sebagai gambar (`Cache-Control: private, no-store`,
`X-Content-Type-Options: nosniff`).

---

## 6. Preparation — `/preparation`

Sumber: [preparation.controller.ts](../apps/api/src/preparation/preparation.controller.ts).

Jadwal siapkan barang per customer/cycle, dan pemantauan apakah dokumen hari ini
selesai tepat waktu.

### GET /preparation — snapshot

| Query | Wajib | Aturan |
|---|---|---|
| `from`, `to` | ya | `YYYY-MM-DD`, rentang **maksimal 31 hari**, `to` ≥ `from` |
| `customerId` | tidak | integer positif |
| `cycle` | tidak | 1–9999 |
| `q` | tidak | ≤128 karakter |
| `status` | tidak | `ALL` (bawaan) \| `INCOMPLETE` \| `COMPLETE` \| `LATE` |

Status per dokumen: `NO_PLAN`, `UNCONFIGURED`, `NOT_STARTED`, `IN_PROGRESS`,
`COMPLETE`, `OVERDUE`, `COMPLETE_LATE`, `COMPLETE_UNTIMED`.

Snapshot juga membawa kalimat keadaan koneksi staging. Kalau `STAGING_HOST`,
`STAGING_DATABASE`, `STAGING_USER`, atau `STAGING_PASSWORD` kosong, muncul
"Koneksi STAGING_* belum lengkap; data cache MES tetap dapat dilihat."
([preparation.service.ts:254](../apps/api/src/preparation/preparation.service.ts:254)).
Pesan itu hanya memeriksa keempat variabel — tidak menguji koneksinya.

### GET /preparation/:id

Rincian satu dokumen preparation.

### POST /preparation/cycles — **ADMIN**

```ts
{
  customerId: number,          // wajib
  destination: string,         // ≤32, bawaan ''
  gate: string,                // ≤32, bawaan ''
  cycle: number,               // 1–9999
  preparationStart: "HH:mm",   // wajib
  preparationEnd: "HH:mm",     // wajib
  dayOffset: number,           // -14..14, bawaan 0
  truckTime: "HH:mm" | null,
  isActive: boolean            // bawaan true
}
```

`dayOffset` untuk cycle yang jatuh di hari sebelum/sesudah tanggal kirim.

### PUT /preparation/cycles/:id — **ADMIN**

Body sama dengan POST.

### DELETE /preparation/cycles/:id — **ADMIN**

### POST /preparation/sync — **ADMIN**

```json
{ "date": "2026-11-07" }
```

Menarik jadwal dari staging `dbo.TM_DELIV_TIME`. Baris dilewati bila customer
belum ada di master MES, cycle tidak valid, atau kunci (customer+destination+
gate+cycle) ambigu — pesannya "Baris N: customer belum terpetakan, cycle tidak
valid, atau kunci normalisasi ambigu." ([staging-pull.service.ts:137](../apps/api/src/staging/staging-pull.service.ts:137)).
Jam SAP disimpan sebagai referensi dan **tidak menimpa** jadwal PPIC.

---

## 7. Penerimaan — `/receiving`

Sumber: [receiving.controller.ts](../apps/api/src/receiving/receiving.controller.ts).

Dua jalur berdampingan: **sesi scan** (dari order ARES) dan **pencatatan manual**.

### Sesi scan

| Endpoint | Body | Keterangan |
|---|---|---|
| `POST /receiving/open` | `{ code, locationId }` | `code` 1–64 karakter |
| `GET /receiving/:id/session` | — | status sesi + semua barisnya |
| `POST /receiving/:id/scan` | `{ code, clientRef }` | `clientRef` wajib **UUID** — kunci idempoten |
| `POST /receiving/:id/close` | `{ reason? }` | `reason` ≤255 |
| `POST /receiving/:id/cancel` | `{ reason }` | **ADMIN**, `reason` 3–255 |

Hasil scan:

```json
{ "result": "OK" | "DUPLICATE" | "REJECTED", "message": "...",
  "autoShipped": false, "kanbanSerial": 12, "line": { "id": 5, "boxScanned": 3 },
  "clientRef": "..." }
```

Sesi berisi `lines[]` dengan `boxOrdered`, `boxScanned`, `pcsReceived`, plus
`totals: { boxOrdered, boxScanned, pcsReceived, missing }` dan `history[]`.

### Pencarian part

- `GET /receiving/resolve?code=` — satu barcode.
- `POST /receiving/resolve-bulk` dengan `{ "partNumbers": ["...", "..."] }` —
  mengembalikan objek peta `partNumber → hasil`. Dipakai saat impor tempelan.

### Pencatatan manual

`GET /receiving` — `page` (1), `perPage` (25, maks 100), `status`.
**Non-ADMIN otomatis terbatas pada pabriknya sendiri**; filter itu dipaksakan
server, bukan dari query.

`GET /receiving/:id` — satu dokumen.

`POST /receiving`:

```ts
{
  plantId, supplierId,                  // wajib
  supplierDocNumber?: string,           // ≤64, nomor surat jalan supplier
  locationId?: number,
  receivedAt?: date,
  note?: string,                        // ≤255
  lines: [{ partId, qty, uom?, supplierLotNumber?, rawCode? }]   // minimal 1
}
```

`supplierLotNumber` kosong berarti sistem membuat nomor sendiri — tapi nomor
supplier jauh lebih berguna saat ada klaim kualitas.

`PATCH /receiving/:id`:

```ts
{ supplierDocNumber?, note?, reason?, lines: [{ id?, partId, qty, uom?, supplierLotNumber? }] }
```

Baris dikenali lewat `id`. **Baris tanpa `id` = tambahan baru; baris lama yang
tidak disebutkan = dihapus.** Selisihnya dicatat sebagai koreksi, bukan
ditimpa diam-diam.

---

## 8. Transfer antar lokasi — `/transfer`

Sumber: [transfer.controller.ts](../apps/api/src/transfer/transfer.controller.ts).

Satu dokumen = satu kali pemindahan. Tiap baris menghasilkan **dua** mutasi:
keluar dari asal, masuk ke tujuan. Saldo pabrik tidak berubah.

| Endpoint | Keterangan |
|---|---|
| `GET /transfer/availability?partId=` | stok yang bisa dipindah |
| `GET /transfer?page=&perPage=` | daftar |
| `GET /transfer/:id` | rincian |
| `POST /transfer` | buat |

```ts
{
  plantId: number,                       // wajib
  fromLineId? / fromLocationId?,         // salah satu WAJIB
  toLineId?   / toLocationId?,           // salah satu WAJIB
  movedAt?: date,
  note?: string,                         // ≤255
  lines: [{ partId, lotId?, serialNumber?, qty }]   // minimal 1
}
```

Asal dan tujuan tidak boleh sama. `lotId` wajib untuk part yang dilacak per lot
— tanpa itu telusurnya putus.

---

## 9. Jembatan SAP — `/staging` dan `/sap`

### `/staging` — [staging.controller.ts](../apps/api/src/staging/staging.controller.ts)

| Endpoint | Keterangan |
|---|---|
| `GET /staging/status?uji=` | keadaan tersimpan saja; **`?uji=true`** yang benar-benar menyambung. Respons `{ sambungan, preflight, target, flag }` |
| `GET /staging/schema?tabel=` | kolom tabel staging |
| `POST /staging/push` | dorong transaksi ke staging |
| `POST /staging/ack` | baca balasan SAP |
| `POST /staging/pull?uji=` | tarik master |
| `POST /staging/pull-delivery?date=&uji=` | tarik loading list |

`uji` bawaan **benar** — `uji=false` yang menulis. `date` pada `pull-delivery`
wajib `YYYY-MM-DD` dan dibaca sebagai pukul 12:00 lokal, supaya perhitungan hari
operasional tidak tergelincir ke tanggal sebelahnya.

Dua jebakan nyata:

1. Controller `pull-delivery` hanya meneruskan `(date, uji !== 'false')`, **tidak
   pernah mengirim flag `manual`** ([staging.controller.ts:108](../apps/api/src/staging/staging.controller.ts:108)).
   Jadi `uji=false` tetap menjawab "STAGING_PULL_ENABLED masih false" selama
   saklarnya mati.
2. Saklar yang **berlaku** diambil dari tabel pengaturan, bukan `.env`
   ([setting.service.ts:110](../apps/api/src/setting/setting.service.ts:110)).
   Urutan menang: baris tabel → environment variable → bawaan. Nyalakan dari
   layar Pengaturan.

Pull menolak dokumen yang customer-nya belum ada di `master."TM_CUST"`, part-nya
belum ada di `master."TM_PARTS"`, cycle-nya tidak valid, nomor itemnya ganda,
atau qty-nya bukan bilangan bulat non-negatif. Penolakan dilaporkan per dokumen
di `catatan[]`, dan penyaringannya per **satu tanggal** `CHR_DEL_DATE`.

### `/sap` — [sap.controller.ts](../apps/api/src/sap/sap.controller.ts)

| Endpoint | Keterangan |
|---|---|
| `GET /sap/summary` | ringkasan outbox |
| `GET /sap/outbox` | daftar antrean kirim |
| `GET /sap/ng-perlu-koreksi?limit=` | NG yang menunggu koreksi |
| `POST /sap/collect` | kumpulkan transaksi baru |
| `POST /sap/retry` | ulangi yang gagal |
| `POST /sap/resend` | kirim ulang |
| `POST /sap/simulate` | **ADMIN** — jalur simulasi |

---

## 10. Hal yang sering keliru

- **Scan pakai nomor dokumen, bukan id.** `GET /loading/resolve?code=` adalah
  jalur barcode; `GET /loading/:id` butuh id numerik internal.
- **`resolve` case-sensitive.** Reader yang meng-uppercase barcode akan gagal.
- **`/loading/driver-status/:id` menerima id surat jalan**, bukan id loading list.
- **`/loading/:id/ship` selalu menolak.** Keberangkatan lewat absensi driver.
- **Surat jalan terbit per PDS**, bukan per loading list.
- **RFID dan barcode tidak boleh dicampur** dalam satu dokumen aktif.
- **Tag RFID bukan master.** MES tidak memetakan EPC ke part; aplikasi reader
  yang mengirim `customerPart`.
- **Hari operasional mulai 06:00 WIB.** Scan pukul 02:00 masuk ke hari
  sebelumnya, dan `GET /loading` tanpa `date` mengikuti aturan yang sama.
