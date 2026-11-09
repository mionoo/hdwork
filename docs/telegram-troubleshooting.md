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

## Transport IPv4 dan pemeriksaan Node.js

Bot menggunakan IPv4 dan HTTPS keep-alive dengan pool terpisah untuk polling dan API pengiriman. Maksimal satu koneksi polling dan delapan koneksi API; masing-masing punya pool sendiri sehingga upload tidak menghabiskan slot polling. Koneksi yang tidak menyelesaikan DNS/TCP/TLS dalam 5 detik dihentikan. Socket yang menganggur ditutup setelah 4 detik, sementara request aktif tetap memiliki deadline tersendiri.

Startup `getMe` dan `deleteWebhook` memiliki deadline 10 detik. Pengiriman tetap dibatasi 20 detik dan long polling default 10 detik memiliki deadline request 25 detik. Deadline startup ditangani satu lapisan, sehingga pesan abort dari shutdown tidak tertukar dengan timeout startup.

Setelah deploy dan restart backend, jalankan dari server:

```bash
cd /root/HD/hdwork
node scripts/check-telegram-connection.js
```

Skrip membaca `.env` backend dan melakukan tiga pemeriksaan pada tiap pool melalui `getMe` (atau root Telegram jika token tidak tersedia). Skrip tidak melakukan `getUpdates`, tidak mengirim pesan, dan tidak menampilkan token, URL bertoken, atau isi respons. Ini aman dijalankan bersamaan dengan polling PM2.

Output JSON mencatat status HTTP, IP, `dns_ms`, `tcp_ms`, `tls_ms`, `total_ms`, dan `reused_socket`. Waktu DNS/TCP/TLS dihitung sejak awal request dan hanya tercatat untuk koneksi baru. Koneksi reuse yang sehat biasanya hanya memiliki total waktu dan IP. Skrip keluar dengan kode 1 jika ada koneksi gagal atau HTTP >= 400. Maksimal waktu keseluruhan sekitar satu menit bila semua percobaan gagal.

Jika skrip juga timeout, periksa jalur server/router/ISP menuju Telegram; perubahan aplikasi tidak dapat memperbaiki gangguan jaringan di luar container. Jika skrip lancar sementara PM2 gagal, pastikan PM2 memakai commit, folder kerja, token, dan Node yang sama, lalu bandingkan log pada waktu yang sama. Kegagalan IPv6 dari tes curl sebelumnya tidak membuktikan bahwa semua timeout berasal dari IPv6; IPv4 di sini dipilih untuk menghilangkan satu variabel yang sudah diketahui gagal.

Tidak ada retry otomatis untuk pengiriman pesan atau lampiran setelah timeout. Pesan dapat sudah sampai walaupun respons terputus; periksa grup sebelum mengirim ulang. Cacti tetap nonaktif dan tidak ada migrasi database atau build frontend untuk perubahan transport ini.

Rujukan API: [Node.js 20 HTTPS Agent](https://nodejs.org/docs/latest-v20.x/api/https.html#class-httpsagent) dan [siklus socket HTTP Agent](https://nodejs.org/docs/latest-v20.x/api/http.html#agentkeepsocketalivesocket).
