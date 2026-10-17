# Product Requirement Document (PRD) & Technical Architecture
## On-Demand & Scheduled Delivery/Ride Routing & Pricing Engine

| Metadata | Spesifikasi |
| :--- | :--- |
| **Document Version** | 1.1.0 |
| **System Module** | Order, Routing & Dynamic Pricing Service |
| **Target Engine** | Node.js / NestJS Backend, Docker OSRM, Redis In-Memory, PostgreSQL |
| **Author / Architect** | Backend Engineering Team |
| **Status** | Approved / Ready for Implementation |

---

## 1. Executive Summary & Problem Statement

Sistem on-demand ride & delivery membutuhkan komponen kalkulasi rute jalan raya dan estimasi biaya yang mandiri tanpa ketergantungan biaya API pihak ketiga (Google Maps/Mapbox). 

Solusi ini mengintegrasikan **self-hosted OSRM** di atas container Docker untuk mendapatkan rute terpendek dan jarak fisik (meter), dihubungkan dengan engine backend untuk menentukan:
1. **Total bayar pelanggan (Customer Fare)**.
2. **Pendapatan bersih driver (Driver Earning)**.
3. **Margin platform/aplikasi (Platform Commission & Service Fee)**.
4. **Pencarian driver terdekat secara scalable** menggunakan **Redis GEO** untuk menangani update lokasi driver secara real-time tanpa membebani disk database relasional.

---

## 2. Product Phasing (Roadmap Rilis)

* **Fase 1 (MVP - Broadcast Pool):**
  * Pelanggan membuat pesanan (Instant / Scheduled).
  * Backend menghitung jarak dan rute melalui OSRM internal.
  * Pesanan masuk ke satu pool umum (semua driver online dapat melihat daftar pesanan yang tersedia dan mengambilnya secara *first-come, first-served*).
* **Fase 2 (Targeted Dispatch / Nearest Driver Matching):**
  * Driver mengirim koordinat GPS berkala ke **Redis GEO**.
  * Saat pesanan dibuat/jadwal tiba, backend melakukan query radius driver terdekat dari titik penjemputan (Pickup A) untuk proses auto-assign / targeted broadcast.

---

## 3. Financial & Pricing Logic

### 3.1 Parameter Tarif (Configurable)
* $BaseFare$: Tarif dasar minimum.
* $BaseDistance$: Jarak awal inklusif base fare (misal: 3 km pertama).
* $RatePerKm$: Tarif per kilometer setelah jarak dasar.
* $ServiceFee_{cust}$: Biaya aplikasi yang dibebankan ke pelanggan (misal: Rp2.000).
* $CommPct_{driver}$: Persentase komisi aplikasi dari tarif perjalanan (misal: 20%).

### 3.2 Rumus Perhitungan
1. **Jarak Operasional ($D$):**
   $$D = \frac{\text{OSRM Distance (meter)}}{1000} \quad (\text{satuan km})$$
2. **Gross Fare Perjalanan ($Fare_{gross}$):**
   $$Fare_{gross} = \max\left(BaseFare, \; BaseFare + \max(0, D - BaseDistance) \times RatePerKm\right)$$
3. **Pembagian Hak & Kewajiban Finansial:**
   * **Total Bayar Pelanggan:** $Total_{cust} = Fare_{gross} + ServiceFee_{cust}$
   * **Pendapatan Driver (80%):** $Earning_{driver} = Fare_{gross} \times (1 - CommPct_{driver})$
   * **Pendapatan Bersih Platform:** $Revenue_{platform} = (Fare_{gross} \times CommPct_{driver}) + ServiceFee_{cust}$

---

## 4. Database Schema (PostgreSQL)

```sql
-- ENUMS
CREATE TYPE user_role AS ENUM ('CUSTOMER', 'DRIVER', 'ADMIN');
CREATE TYPE driver_status AS ENUM ('OFFLINE', 'ONLINE', 'BUSY');
CREATE TYPE booking_type AS ENUM ('INSTANT', 'SCHEDULED');
CREATE TYPE booking_status AS ENUM (
    'PENDING', 'FINDING_DRIVER', 'ACCEPTED', 
    'ON_THE_WAY_PICKUP', 'ARRIVED_AT_PICKUP', 
    'IN_TRANSIT', 'COMPLETED', 'CANCELLED'
);

-- 1. USERS & DRIVERS
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    role user_role NOT NULL DEFAULT 'CUSTOMER',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE driver_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    vehicle_type VARCHAR(20) NOT NULL,
    vehicle_plate_number VARCHAR(15) NOT NULL,
    status driver_status NOT NULL DEFAULT 'OFFLINE',
    last_known_lat DOUBLE PRECISION,
    last_known_lng DOUBLE PRECISION,
    rating NUMERIC(3, 2) DEFAULT 5.00,
    wallet_balance NUMERIC(12, 2) DEFAULT 0.00,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. MASTER SERVICES & PRICING
CREATE TABLE delivery_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE pricing_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES delivery_services(id),
    base_fare NUMERIC(10, 2) NOT NULL,
    base_distance_km NUMERIC(5, 2) NOT NULL,
    per_km_rate NUMERIC(10, 2) NOT NULL,
    app_service_fee NUMERIC(10, 2) NOT NULL,
    driver_commission_pct NUMERIC(5, 2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. BOOKINGS
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_code VARCHAR(30) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES users(id),
    driver_id UUID REFERENCES users(id),
    service_id UUID NOT NULL REFERENCES delivery_services(id),
    booking_type booking_type NOT NULL DEFAULT 'INSTANT',
    scheduled_at TIMESTAMPTZ,
    status booking_status NOT NULL DEFAULT 'PENDING',
    
    -- Koordinat Titik A (Pickup)
    origin_address TEXT NOT NULL,
    origin_lat DOUBLE PRECISION NOT NULL,
    origin_lng DOUBLE PRECISION NOT NULL,
    
    -- Koordinat Titik B (Dropoff)
    destination_address TEXT NOT NULL,
    destination_lat DOUBLE PRECISION NOT NULL,
    destination_lng DOUBLE PRECISION NOT NULL,

    -- Routing Snapshot
    distance_meters NUMERIC(10, 2) NOT NULL,
    duration_seconds INT NOT NULL,
    route_polyline TEXT,

    -- Financial Snapshot
    total_customer_fare NUMERIC(12, 2) NOT NULL,
    driver_earning NUMERIC(12, 2) NOT NULL,
    platform_revenue NUMERIC(12, 2) NOT NULL,
    app_service_fee NUMERIC(12, 2) NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_scheduled ON bookings(scheduled_at) WHERE booking_type = 'SCHEDULED' AND status = 'PENDING';
```

---

## 5. High-Throughput Driver Location Architecture (Redis GEO)

Untuk mencegah bottleneck disk I/O di PostgreSQL saat driver bergerak:

1. **Struktur Data Lokasi Driver:**
   * Ditampung dalam key Redis: `drivers:locations:active`.
   * Memori: $\approx 150 \text{ bytes per driver}$. Untuk 10.000 driver aktif, konsumsi RAM hanya $\approx 3 - 5 \text{ MB}$.
2. **Alur Update Lokasi (Driver Mobile -> Backend):**
   * Mobile app mengirim throttle ping setiap 5–10 detik (atau jika berpindah $> 10\text{ meter}$).
   * Backend mengeksekusi:
     ```bash
     GEOADD drivers:locations:active <lng> <lat> "<driver_id>"
     SET driver:heartbeat:<driver_id> "1" EX 60
     ```
3. **Pencarian Driver Terdekat (Fase 2):**
   * Backend mencari $N$ driver dalam radius $R$ km dari titik jemput:
     ```bash
     GEORADIUS drivers:locations:active <origin_lng> <origin_lat> 5 km WITHDIST ASC COUNT 10
     ```

---

## 6. REST API Endpoints Specification

### 6.1 Quotation & Routing
* **`POST /api/v1/pricing/quote`**
  * Menghubungi OSRM internal (`/route/v1/driving/{lng1},{lat1};{lng2},{lat2}`).
  * Menghasilkan breakdown harga dan `quote_token` berumur 5–10 menit (disimpan di Redis).

### 6.2 Booking Management
* **`POST /api/v1/bookings`**
  * Input: `quote_token`, data kontak pickup/dropoff, notes barang.
  * Jika `INSTANT`: Status langsung `FINDING_DRIVER` (Fase 1: masuk pool order; Fase 2: broadcast terdekat).
  * Jika `SCHEDULED`: Status `PENDING` dengan nilai `scheduled_at`.
* **`GET /api/v1/bookings/:id`**: Detail status dan koordinat perjalanan.
* **`POST /api/v1/bookings/:id/cancel`**: Batalkan order sebelum driver tiba.

### 6.3 Driver Operations
* **`POST /api/v1/driver/location`**: Update koordinat live ke Redis GEO.
* **`PATCH /api/v1/driver/status`**: Toggle online/offline.
* **`GET /api/v1/driver/orders/available`**: 
  * *Fase 1:* Mengambil daftar order status `FINDING_DRIVER` dari pool umum.
  * *Fase 2:* Mengambil order yang dibroadcast dalam radius terdekat driver.
* **`POST /api/v1/driver/bookings/:id/accept`**: Driver mengambil order (menggunakan atomic lock/mutex Redis).
* **`POST /api/v1/driver/bookings/:id/status`**: Step perjalanan (`ARRIVED_AT_PICKUP`, `IN_TRANSIT`, `COMPLETED`).

---

## 7. Background Worker: Scheduled Delivery Trigger

Untuk order terjadwal (`SCHEDULED`), worker background (NestJS Schedule / BullMQ cron job) berjalan setiap menit:

```
[Cron Job Setiap 1 Menit]
       │
       ▼
Query PostgreSQL:
SELECT * FROM bookings 
WHERE booking_type = 'SCHEDULED' 
  AND status = 'PENDING' 
  AND scheduled_at <= NOW() + INTERVAL '15 MINUTES';
       │
       ▼
Update Status Menjadi 'FINDING_DRIVER'
       │
       ▼
Trigger ke Queue Dispatch (Push ke Pool Order / Broadcast Driver)
```

---

## 8. Fallback & Reliability Plan

* **OSRM Fallback:** Jika OSRM container tidak merespon ($> 2.000\text{ ms}$), fallback otomatis menggunakan **Haversine Formula** dikalikan faktor koreksi rute jalan raya ($1.35 \times$).
* **Concurrency Locking:** Penerimaan order oleh driver dilindungi dengan **Redis Distributed Lock (Redlock)** per `booking_id` untuk mencegah *race condition*.