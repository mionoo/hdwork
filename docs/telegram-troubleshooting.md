# Memeriksa keterlambatan order Telegram

Backend memproses satu batch sampai selesai sebelum meminta batch berikutnya. Penyimpanan order tetap ditunggu sampai commit; polling tidak dilepas ke pekerjaan latar yang belum tersimpan. Retry database sementara dan deduplikasi pesan/album tetap berlaku.

## Log terbaru

PM2 menyimpan log dari proses sebelumnya. Setelah restart, gunakan perintah berikut untuk melihat hanya pesan yang baru datang, tanpa menghapus riwayat:

```bash
pm2 logs hdwork-backend --lines 0 --timestamp
```

Kirim order uji di grup yang sudah terdaftar. Cari satu baris `Order Telegram diproses`:

| Field | Arti |
| --- | --- |
| `order_id` | ID order yang baru dibuat; null jika tidak ada insert baru, misalnya pesan duplikat |
| `telegram_delay_ms` | Selisih waktu pesan Telegram dengan awal handler; dapat mencakup koneksi, polling, dan batch sebelumnya. Waktu pesan Telegram memiliki resolusi satu detik. |
| `queue_ms` | Menunggu antrean pesan pada grup/topic yang sama |
| `processing_ms` | Total waktu handler termasuk query, retry, dan pengaitan foto |
| `group_lookup_ms` | Pencarian konfigurasi grup |
| `pool_wait_ms` | Menunggu koneksi MySQL tersedia |
| `begin_ms` | Memulai transaksi |
| `group_lock_ms` | Membaca dan mengunci grup yang aktif |
| `insert_ms` | Membuat order beserta tipe dan point aktif dalam satu query |
| `commit_ms` | Menunggu commit MySQL |

Rincian transaksi hanya tersedia saat order baru berhasil dibuat. Foto dan retry dapat membuat total processing lebih besar daripada jumlah rincian tersebut.

Jika `pool_wait_ms` tinggi, periksa beban/query MySQL yang memakai koneksi. Jika `group_lock_ms` tinggi, periksa transaksi lama pada grup tersebut. Jika beberapa query dan commit sama-sama lambat, periksa koneksi backend ke MySQL serta beban server. Jika `telegram_delay_ms` tinggi tetapi processing rendah, periksa koneksi server ke Telegram dan waktu antar-batch; field itu sendiri tidak membuktikan penyebab jaringan.

## Log polling rinci

Secara default, batch polling dan jeda singkat tidak memenuhi log. Aktifkan sementara pada `.env` backend:

```env
TELEGRAM_DEBUG_LOGS=true
```

Restart backend sesudah mengubah konfigurasi. Log `Batch Telegram diterima` memperlihatkan durasi request dan `Jeda sebelum polling Telegram` memperlihatkan waktu di antara request. Durasi long polling yang mendekati 10 detik saat tidak ada pesan merupakan perilaku normal.

Kembalikan ke `false` setelah pemeriksaan. Error dan timeout tetap dicatat meskipun debug tidak aktif. Token bot pada pesan error dari service Telegram disamarkan.

Perubahan ini tidak memerlukan migrasi database. Optimasi query mengurangi round trip, tetapi tidak menjamin koneksi Telegram atau MySQL selalu cepat.
