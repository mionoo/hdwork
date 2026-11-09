# Cacti sementara dinonaktifkan

HD Work menonaktifkan Cacti secara default untuk memprioritaskan order. Data Cacti, konfigurasi grup alarm, dan langganan tidak dihapus.

## Cakupan

Saat `CACTI_ENABLED` tidak diisi atau bernilai `false`:

- Backend tidak memuat atau memulai scheduler Cacti.
- Tidak ada pengiriman alarm grup, alarm personal, maupun health collector dari jalur Cacti.
- Perintah `/alarmnodeb`, `/alarmdatin`, `/stopalarmnodeb`, `/stopalarmdatin`, `/alarmstatus`, dan callback pilihan instansi DATIN tidak didaftarkan. Bagian alarm tidak ditampilkan pada `/help`.
- Semua request ke `/api/cactys`, `/api/datin-cacti`, dan `/api/datin-sheet` mendapat HTTP 503 dengan kode `CACTI_DISABLED` sebelum payload diparsing atau service integrasi dimuat. Sinkronisasi spreadsheet pendukung DATIN ikut dijeda.
- API order, `/setgrup`, `/config`, pemrosesan caption/foto, percakapan, serta notifikasi claim dan hasil order tetap aktif.

## Menerapkan pada server

Setelah pull kode terbaru, isi `.env` backend:

```env
CACTI_ENABLED=false
```

Jika PM2 menyimpan nilai environment lama, terapkan nilai yang sama saat restart:

```bash
cd /root/HD/hdwork
CACTI_ENABLED=false pm2 restart hdwork-backend --update-env
pm2 logs hdwork-backend --lines 0 --timestamp
```

Log startup menyatakan `Cacti nonaktif`. Tidak perlu migrasi database atau build frontend.

Collector dan agent di PC kantor adalah proses terpisah. Hentikan launcher, scheduled task, atau service Cacti pada PC tempat proses itu dijalankan. Perubahan backend tidak dapat mematikan proses tersebut dari jarak jauh; jika masih berjalan, request-nya akan ditolak dengan HTTP 503. Jangan menghentikan Local Agent untuk order/network tools.

## Mengaktifkan kembali

Lakukan hanya ketika Cacti siap digunakan lagi: ubah `CACTI_ENABLED=true` pada `.env` dan environment PM2, kemudian restart backend. Data dan langganan lama akan digunakan kembali, termasuk pemeriksaan health collector. Siapkan collector sebelum mengaktifkannya.

Menjeda Cacti membantu mengisolasi beban, tetapi tidak menjamin timeout koneksi Telegram atau commit MySQL yang lambat langsung hilang.
