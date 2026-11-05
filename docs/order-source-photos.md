# Order dari caption foto Telegram

## Penerapan

1. Cadangkan database, lalu terapkan
   `database/migrations/20261105_order_source_photos.sql` satu kali sebelum
   memulai backend versi baru. Migrasi menambahkan referensi album pada order
   dan tabel lampiran pesan awal.
2. Pastikan akun yang menjalankan backend dapat menulis ke
   `storage/order-source/` di root project backend. Folder dibuat otomatis.
   Sertakan folder ini dalam backup bersama database. Jangan pindahkan ke
   folder publik `uploads`.
3. Restart backend, build ulang frontend, lalu tayangkan hasil build.
4. Uji pesan baru di grup/topik yang sudah terdaftar dan aktif:
   foto dengan caption `#req nomor_service, keterangan` atau
   `#assign nomor_tiket, keterangan` untuk Pengawalan; caption `/config`
   dengan format lengkap untuk Logic.

Foto muncul pada panel Pesan Asli Telegram dan Detail Order. Klik thumbnail
untuk memperbesar. Endpoint foto memeriksa token dan akses order; browser tidak
menerima token bot, file ID Telegram, atau tautan unduhan Telegram.

## Album dan kegagalan unduhan

- Satu album Telegram dalam satu chat menghasilkan paling banyak satu order.
  Caption pertama yang valid menjadi pesan awal order. Foto-foto tanpa caption
  yang datang sebelum atau sesudahnya ditautkan ke order yang sama.
- Album tanpa caption order hanya menyimpan referensi Telegram; tidak membuat
  order atau mengunduh foto. Foto tunggal tanpa caption order diabaikan.
- Bot menyimpan versi foto dengan resolusi terbesar yang diberikan Telegram.
  Ukuran unduhan dibatasi 20 MB per foto dan waktu unduhan 30 detik.
- Jika unduhan gagal, order dan referensi foto tetap tersimpan. Pembukaan foto
  di web mencoba lagi; tombol Coba lagi tersedia jika foto belum dapat diambil.
- Pengiriman ulang update Telegram tidak menggandakan foto. Pengaitan lampiran
  dapat dipulihkan ketika order dibuka jika worker sempat berhenti setelah
  menyimpan order.

Fitur ini menerima pesan baru setelah backend diperbarui, bukan mengambil ulang
riwayat chat. Dukungan saat ini untuk Telegram **photo**, bukan dokumen, video,
atau foto yang dikirim sebagai file dokumen. Bot harus dapat menerima pesan di
grup tersebut; perubahan kode ini tidak mengubah pengaturan Privacy Mode bot.
