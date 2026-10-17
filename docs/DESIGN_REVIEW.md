# Design Review & Decisions — Routing & Pricing Engine

Status: PRE-IMPLEMENTATION REVIEW (v1.1.0 PRD) — 2026-10-17
Reviewer: Dina (coding specialist). Lengkap dengan PRD di `docs/PRD.md`.

## A. Formula & finansial

- Rumus PRD §3.2 konsisten dan layak. Untuk `D < BaseDistance`, hasil tepat `BaseFare`
  (`max()` di rumus redundant tapi tidak merugikan).
- **D-1 (DECISION):** Rounding ke 2 desimal (`Decimal.round(2)`), semua kalkulasi di
  satu tempat (pricing service), snapshot disimpan sebagai `Decimal`. Tanpa rounding
  ke Rp100 dulu untuk MVP.
- **Backlog:** waiting time, surge pricing, dynamic minimum fare — di luar MVP.

## B. Quote lifecycle

- **D-2 (DECISION):** `POST /bookings` dengan `quote_token` expired → reject `409`
  dengan error code `QUOTE_EXPIRED`, client wajib re-quote. Tidak ada auto re-quote
  di endpoint booking (mencegah selisih harga diam-diam).
- **D-3 (DECISION):** Untuk `SCHEDULED`, harga di-lock dari waktu booking (snapshot
  tetap dipakai). Worker trigger T-15 menit TIDAK re-quote. Rationale: pelanggan
  sudah melihat dan menyetujui harga; perubahan harga mendadak saat dispatch buruk
  untuk UX dan bisa melebihi anggaran. Backlog: opsi re-quote jika config berubah.

## C. Schema adjustments (di atas schema PRD §4)

1. `pricing_configs` → tambah unique partial index
   `CREATE UNIQUE INDEX uq_pricing_active ON pricing_configs(service_id) WHERE is_active;`
   agar "config efektif" selalu unambiguous.
2. `driver_profiles.last_known_lat/lng` = snapshot stale. Sumber kebenaran lokasi =
   Redis GEO. Tidak dipakai untuk matching. Dokumentasi di komentar schema.
3. `bookings` → tambah kolom `route_source VARCHAR(20)` (`OSRM` | `HAVERSINE_FALLBACK`)
   agar fallback §8 terlacak di data.
4. Tambah enum value `NO_DRIVER_FOUND` pada `booking_status` (terminal state untuk
   broadcast yang tidak diambil; ditentukan worker timeout, default 15 menit untuk
   INSTANT setelah masuk FINDING_DRIVER).
5. Backlog (field sudah ada, tabelnya belum): `ratings`, `wallet_transactions`.

## D. Redis GEO & driver online-ness

- Heartbeat key `EX 60` membuat data basi tapi TIDAK menghapus member GEO.
- **D-4 (DECISION):** `GEORADIUS` result difilter: hanya driver yang heartbeat key-nya
  masih ada (pipe `EXISTS driver:heartbeat:<id>`) yang dianggap valid. Toggle
  `PATCH /driver/status` ke OFFLINE wajib `ZREM drivers:locations:active <id>`.
- Interval ping mobile: 5–10 detik atau perpindahan >10 m (sesuai PRD §5).

## E. API notes

- Auth: pakai auth module bawaan template (JWT). Guard role: `CUSTOMER` untuk
  quote/bookings, `DRIVER` untuk `/driver/*`, `ADMIN` untuk config pricing.
- Tambah `GET /api/v1/bookings` (list milik user, paginated) — tidak ada di PRD tapi
  wajib untuk riwayat.
- Cancel semantics (D-5, DECISION): customer/driver boleh cancel hanya sebelum
  status `IN_TRANSIT`; tanpa penalti di MVP; cancel setelah ACCEPTED tetap boleh
  (driver freed, booking kembali FINDING_DRIVER hanya jika cancel oleh driver).
- Assignment driver Fase 1 = polling `GET /driver/orders/available` (interval 5 s di
  sisi mobile). Push notification = backlog Fase 2.

## F. Infra & reliability

- OSRM: butuh OSM extract per region + preprocess (`osrm-routed`). Region awal:
  **Jabodetabek** (Geofabrik indonesia-latest atau extract lebih kecil) — perlu
  konfirmasi volume sebelum deploy. Fallback Haversine ×1.35 wajib menandai
  `route_source` (lihat C.3) dan timeout OSRM 2.000 ms (sesuai PRD §8).
- Worker scheduled cron (per menit) + worker `NO_DRIVER_FOUND` timeout: wajib
  distributed lock Redis (sama mekanisme Redlock dengan accept order) agar aman
  terhadap >1 instance.
- Accept order: Redlock per `booking_id` + validasi status masih `FINDING_DRIVER`
  di dalam lock (PRD §8 benar arahnya).

## G. Work packages (urutan implementasi)

- **WP1:** Prisma schema + enum + index + migration; pricing module (`/pricing/quote`,
  Redis quote store, OSRM client + Haversine fallback).
- **WP2:** Bookings module (create w/ quote_token, get, list, cancel) + role guards.
- **WP3:** Driver ops (location → Redis GEO, status toggle, available orders, accept
  dengan Redlock, status step perjalanan).
- **WP4:** Background workers (scheduled trigger T-15, NO_DRIVER_FOUND timeout) +
  docker-compose OSRM + README deploy notes.