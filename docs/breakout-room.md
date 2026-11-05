# Breakout Room HD Work

Setelah login, pilih **Segmen → Assurance atau Provisioning → Grup Telegram**.
Setiap ruang menampilkan antrean satu grup atau topik Telegram. **Keluar ruang**
mengembalikan pengguna ke pilihan segmen tanpa logout dan tanpa melepas order.

## Persiapan sebelum menayangkan frontend baru

1. Cadangkan database dan uji migrasi
   `database/migrations/20261104_add_breakout_rooms.sql` di salinan database.
   Migrasi menambah alur kerja, menyediakan segmen `REPLACE_ONT`, dan
   mengizinkan lebih dari satu grup untuk kombinasi kota, segmen, dan jenis
   grup yang sama. Identitas chat/topik tetap unik.
2. Terapkan migrasi ke database tujuan sebelum memulai backend baru.
3. Untuk setiap grup order lama, buka **Konfigurasi Grup → Edit** lalu
   tetapkan **Assurance** atau **Provisioning** sesuai pekerjaan sebenarnya.
   Migrasi sengaja tidak menebak alur grup lama. Grup nonaktif, grup alarm,
   dan grup yang belum memiliki alur kerja tidak tampil di Breakout Room.
   Jika konfigurasi harus disiapkan sebelum mengganti frontend aktif, isi
   kolom `telegram_groups.workflow` berdasarkan ID grup yang telah diverifikasi.
4. Berikan akses **REPLACE_ONT** kepada HD yang berwenang dari **User Management**.
5. Build dan tayangkan frontend baru. Uji login sebagai HD dengan dan tanpa
   akses Replace ONT, masuk ke grup yang sesuai, buka detail, lalu keluar ruang.

## Mendaftarkan grup atau topik baru

Jalankan `/setgrup` di grup atau topik Telegram tujuan. Pilih **kota → segmen →
alur kerja → jenis grup**. Setelah disimpan, grup langsung memiliki alur kerja
untuk Breakout Room; koreksi tetap dapat dilakukan melalui **Konfigurasi Grup**.
Pendaftaran grup baru tidak menggantikan grup lain yang punya jenis
yang sama. Untuk Replace ONT, siapkan grup **Group Replace Assurance** dan
**Group Prov Replacement** sesuai topologi yang disepakati.

HD dibatasi oleh kota dan segmen yang diberikan; Admin dibatasi oleh kota;
Super Admin dapat memilih ruang lintas kota. Pilihan ruang tidak mengubah
hak akses order, aturan claim, attendance, atau tujuan balasan Telegram.

## Nonaktif dan arsip grup

Sebelum menayangkan fitur arsip, terapkan
`database/migrations/20261105_archive_telegram_groups.sql` satu kali. Restart
backend setelah migrasi dan sebelum menayangkan build frontend baru.

- **Nonaktif**: grup tetap tercantum di Konfigurasi Grup, tetapi tidak muncul
  di Breakout Room dan tidak menerima order baru.
- **Arsipkan** (Super Admin): grup dipindah dari daftar utama ke **Lihat arsip**.
  Tidak ada grup, order, foto, atau riwayat yang dihapus. Grup yang diarsipkan
  tidak dapat diaktifkan ulang melalui `/setgrup`.
- **Pulihkan** (Super Admin): grup kembali ke daftar utama sebagai **Nonaktif**.
  Aktifkan lewat Edit setelah siap menerima order lagi.
