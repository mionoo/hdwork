# Mode webhook Telegram untuk HD Work

Webhook mengganti `getUpdates`: Telegram mengirim update ke Cloudflare, lalu backend menyimpan update ke inbox MySQL sebelum HTTP 200. Worker membaca inbox memakai handler order, caption foto, dan percakapan yang sudah ada. Notifikasi claim/hasil tetap memakai koneksi keluar ke Telegram; webhook tidak memperbaiki kegagalan koneksi keluar atau storage MySQL secara otomatis.

Mode default tetap `polling`, sehingga pull kode saja tidak mengganti penerimaan bot. Aktivasi dilakukan pada environment backend setelah migrasi dan routing siap. Jangan menjalankan polling pada laptop/server lain menggunakan token yang sama ketika webhook aktif; startup polling dapat menghapus pendaftaran webhook.

## 1. Terapkan migrasi

Pada database HD Work, jalankan isi file:

`database/migrations/20261111_telegram_webhook_inbox.sql`

File dapat dijalankan melalui phpMyAdmin atau mysql CLI pada database yang benar. Migrasi hanya menambahkan tabel `telegram_webhook_updates` dan tidak menghapus order. Jangan menyalin password database ke perintah shell yang akan dibagikan. Tidak ada build frontend atau dependency baru.

## 2. Siapkan endpoint Cloudflare

Contoh URL dengan domain backend yang sudah digunakan:

`https://serverhdwork.telkomakses-area3.id/api/telegram/webhook`

Published application route domain backend tetap menuju service HTTP backend, misalnya `192.168.88.5:3090`, atau reverse proxy yang meneruskan `/api/telegram/` ke backend. Tidak perlu Published application route baru jika domain backend sudah meneruskan semua path ke service tersebut.

Endpoint ini harus menerima POST dari Telegram tanpa halaman login Cloudflare Access, CAPTCHA, atau challenge. Jika ada kebijakan Access/WAF yang menghalangi, sesuaikan secara sempit untuk endpoint ini; jangan membuka seluruh aplikasi. Backend memeriksa header `X-Telegram-Bot-Api-Secret-Token` sebelum parsing JSON atau akses database. Jangan memasukkan token bot ke URL webhook.

## 3. Konfigurasi backend

Buat secret acak tersendiri:

```bash
openssl rand -hex 32
```

Salin hasilnya ke `.env` backend; secret ini berbeda dari token bot:

```env
CACTI_ENABLED=false
TELEGRAM_UPDATE_MODE=webhook
TELEGRAM_WEBHOOK_URL=https://serverhdwork.telkomakses-area3.id/api/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=GANTI_DENGAN_HASIL_OPENSSL
```

`TELEGRAM_BOT_TOKEN` tetap memakai token bot yang benar. Secret wajib 32–256 karakter huruf, angka, `_`, atau `-`. URL harus HTTPS, path `/api/telegram/webhook`, tanpa credential, query, atau fragment. Gunakan domain yang benar-benar aktif pada instalasi Anda.

Setelah pull, migrasi, dan `.env` siap:

```bash
cd /root/HD/hdwork
CACTI_ENABLED=false TELEGRAM_UPDATE_MODE=webhook pm2 restart hdwork-backend --update-env
pm2 logs hdwork-backend --lines 0 --timestamp
```

Variabel URL dan secret biasanya dibaca dari `.env`. Bila pernah disimpan sebagai environment PM2, samakan nilai pada konfigurasi PM2; nilai environment proses mempunyai prioritas atas `.env`.

Log yang diharapkan:

- `Inbox webhook dan worker aktif; menunggu pendaftaran Telegram. Polling tidak dijalankan.`
- `Webhook Telegram terdaftar` dengan URL endpoint.
- `Update webhook diproses` dan `Order Telegram diproses` ketika ada order.

Pendaftaran `setWebhook` dilakukan otomatis setelah tabel inbox terverifikasi. Pendaftaran mempertahankan pending updates (`drop_pending_updates=false`), memilih `message` dan `callback_query`, serta mulai dengan satu koneksi webhook agar urutan pengiriman lebih mudah dijaga. Konfigurasi ini tidak menjalankan `getUpdates` atau `deleteWebhook`.

Jika koneksi keluar sedang gagal, pendaftaran dicoba maksimal lima retry; worker/inbox tetap aktif. Log akan menjelaskan bila pendaftaran belum berhasil. Konfirmasi pendaftaran sebelum menganggap penerimaan sudah berpindah. Bila belum pernah berhasil terdaftar, Telegram belum bisa mengirim ke endpoint baru meskipun worker sudah hidup.

## 4. Verifikasi tanpa mengambil antrean bot

```bash
node scripts/telegram-webhook-info.js
```

Skrip memakai `getWebhookInfo`, bukan `getUpdates`; tidak mencetak token atau secret. Periksa `url`, `pending_update_count`, dan `last_error_message`. Pesan error terakhir dapat merupakan riwayat; bandingkan waktunya dengan order uji baru.

Untuk memastikan routing dan penolakan secret tanpa membuat order sintetis:

```bash
curl -i -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  https://serverhdwork.telkomakses-area3.id/api/telegram/webhook
```

HTTP 403 dengan pesan secret tidak valid adalah hasil yang diharapkan karena tidak ada secret. HTML frontend, challenge, atau redirect login berarti routing/policy belum sesuai. HTTP 503 berarti mode/config belum siap. Jangan melakukan tes endpoint produksi dengan secret benar dan payload update buatan.

Lalu kirim satu order asli dari grup yang sudah terdaftar, periksa inbox/log, tampilan Orders, claim, dan hasil. Kegagalan mengirim hasil masih dapat terjadi bila koneksi keluar ke Telegram terganggu.

## Antrean dan kegagalan

- Unique `(bot_id, update_id)` mencegah inbox ganda dan memisahkan bot berbeda; token tidak disimpan di tabel.
- HTTP 200 hanya diberikan setelah penyimpanan inbox berhasil. Database gagal menghasilkan 503 agar Telegram mencoba ulang. JSON salah dibalas 400; payload dibatasi 1 MB.
- Pesan grup dan perintah bot memakai dua jalur pemrosesan. Order, foto, dan balasan grup tidak perlu `getMe`. Perintah admin dan callback tetap memakai identitas bot dan pemeriksaan hak admin. Retry di jalur perintah tidak menahan jalur order.
- Setiap jalur memproses update tertua lebih dulu. Kegagalan diulang setelah 2–256 detik. Balasan grup tetap diproses setelah pesan induknya. Jika pesan tertua di jalur data terus gagal, periksa `last_error` dan jangan menghapusnya tanpa memeriksa dampak pada order. Log `inbox_wait_ms` mengukur waktu sejak update disimpan sampai diambil worker, termasuk menunggu retry.
- Lease 120 detik diperpanjang tiap 30 detik. Setelah proses mati, worker baru dapat melanjutkan setelah lease kedaluwarsa. Update tidak ditandai selesai ketika handler order gagal menyimpan data.
- Handler webhook tidak memakai timeout Telegraf yang bisa meninggalkan handler async masih berjalan setelah dianggap gagal. Request Telegram tetap memiliki deadline transport. Shutdown server tetap memiliki batas waktu; update belum selesai tetap tersimpan untuk pemulihan.
- Ini pemrosesan at-least-once. Deduplikasi order/foto/percakapan tetap digunakan ketika worker mengulang. Pengiriman balasan/perintah tidak mempunyai jaminan exactly-once bila proses mati setelah Telegram menerima pesan tetapi sebelum status inbox selesai.
- Data payload inbox disimpan, termasuk update selesai, untuk pemeriksaan. Perlu kebijakan retensi/arsip ketika volume sudah diketahui; fitur ini belum menghapus payload secara otomatis.

Pemeriksaan antrean pada database yang benar:

```sql
SELECT status, COUNT(*) AS jumlah FROM telegram_webhook_updates GROUP BY status;
SELECT bot_id, update_id, status, attempts, next_attempt_at, lease_until, last_error
FROM telegram_webhook_updates WHERE status <> 'done' ORDER BY update_id LIMIT 20;
```

## Antrean pengiriman hasil dan claim

Webhook menerima pesan dari Telegram. Pengiriman hasil dan notifikasi claim tetap memakai koneksi keluar ke Bot API. Untuk menyimpan antrean pengiriman di MySQL, jalankan [migrasi outbox](../database/migrations/20261111_telegram_outbox.sql) di database HD Work, lalu tambahkan ke `.env`:

```env
TELEGRAM_OUTBOX_ENABLED=true
```

Restart backend setelah migrasi:

```bash
CACTI_ENABLED=false TELEGRAM_UPDATE_MODE=webhook TELEGRAM_OUTBOX_ENABLED=true pm2 restart hdwork-backend --update-env
```

Saat outbox aktif, claim dan hasil baru disimpan dalam transaksi MySQL yang sama dengan entri pengirimannya. Kegagalan mencatat antrean membatalkan perubahan order. Worker mengirim notifikasi claim setelah transaksi berhasil. Complete Order menunggu hasil percobaan pengiriman pertama seperti sebelumnya. Jika koneksi gagal sebelum TLS tersambung, DNS gagal, koneksi ditolak, atau Telegram merespons 429, percobaan berikutnya disimpan di MySQL dan berjalan setelah jeda, hingga lima percobaan total. Timeout setelah pengiriman mungkin dimulai, pengiriman sebagian, atau restart saat job berstatus `sending` perlu dicek di grup; kasus tersebut tidak dikirim ulang otomatis. Ini berlaku untuk Kirim Hasil, hasil baru saat Complete Order, dan notifikasi claim. Balasan percakapan langsung masih memakai alur yang ada.

Lampiran tetap memerlukan file unggahan yang tersimpan di container. Pertahankan direktori `uploads/results` agar pengiriman ulang setelah restart dapat membaca file. Status `pending` berarti masih menunggu percobaan; `sent` berarti Telegram mengonfirmasi penerimaan; `failed` berarti tujuan berubah, Telegram menolak, atau batas percobaan tercapai; `unknown` perlu diperiksa di grup sebelum mengirim lagi. Koneksi jaringan keluar yang tidak stabil tetap perlu ditangani.

```sql
SELECT id, kind, job_key, status, attempts, next_attempt_at, last_error
FROM telegram_outbox
WHERE status <> 'sent'
ORDER BY id DESC LIMIT 30;
```

## Kembali ke polling

Ubah `.env` menjadi `TELEGRAM_UPDATE_MODE=polling`, lalu:

```bash
CACTI_ENABLED=false TELEGRAM_UPDATE_MODE=polling pm2 restart hdwork-backend --update-env
```

Startup polling menggunakan alur `deleteWebhook` yang sudah ada tanpa membuang pending updates. Endpoint webhook menolak penerimaan saat mode polling. Inbox lama tetap disimpan tetapi workernya tidak berjalan; jika masih ada update pending, selesaikan/rekonsiliasi inbox tersebut sebelum rollback agar tidak tertinggal. Jangan mengaktifkan dua mode atau dua penerima untuk token yang sama.

Rujukan: [Telegram setWebhook](https://core.telegram.org/bots/api#setwebhook) dan [getWebhookInfo](https://core.telegram.org/bots/api#getwebhookinfo).
