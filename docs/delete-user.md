# Hapus user permanen

Jalankan migrasi `database/migrations/20261106_preserve_orders_after_user_deletion.sql`
sebelum restart backend dan menayangkan build frontend baru. Migrasi
mengizinkan atribusi user pada penugasan, catatan, dan hasil order dikosongkan
tanpa menghapus baris tersebut. Uji migrasi pada salinan database sebelum produksi.

Di **User Management**, Super Admin dapat memilih **Hapus user** pada kolom
**Aksi**, lalu mengetik username akun sebagai konfirmasi. Akun sendiri tidak
dapat dihapus. Jika masih menjadi penanggung jawab atau pemegang penugasan
aktif pada order yang belum selesai, pindahkan atau selesaikan order itu dulu.

Penghapusan permanen mencakup akun, coverage segmen, data attendance dan
istirahat akun, serta kredensial Local Agent. Sesi yang aktif diputus dan token
lama tidak lagi diterima. Order, status, catatan, hasil, dan lampiran tetap
tersimpan; tautan ke akun yang dihapus dikosongkan. Order `DONE` tidak kembali
ke antrean. Laporan per pengguna dan attendance dapat berubah. Pesan Telegram
yang sudah terkirim serta teks yang sudah ditulis di order tidak diubah.
