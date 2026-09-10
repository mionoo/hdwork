# Pemulihan sesi SSH setelah refresh

## Konfigurasi

Backend: `src/config/network-tools.config.js`.

- `SSH_RESUME_GRACE_SECONDS=60`: masa tunggu browser menyambung kembali setelah socket terlepas.
- `SSH_OUTPUT_BUFFER_BYTES`: batas riwayat terminal dalam memori backend, default 256 KiB per sesi.
- Terminal frontend mempertahankan maksimal 5.000 baris scrollback.
- Maksimal 5 sesi manual dan 1 Quick Action per HD, termasuk sesi pending/detached. Batas manual: `SSH_MAX_MANUAL_SESSIONS` pada konfigurasi backend dan `MAX_MANUAL_TERMINALS` di `frontend/src/pages/NetworkToolsPage.tsx`; ubah keduanya bersama.

Variabel masa tunggu dapat diatur di `.env` backend. Restart backend setelah mengubah konfigurasi; restart tersebut menutup sesi yang sedang aktif.

## Perilaku

- Network Tools memiliki dua area: **Quick Action** (satu sesi tersendiri) dan **Terminal Manual** (tombol **+ Tab baru**, hingga lima tab).
- Tiap tab memakai socket frontend, sesi SSH, output xterm, status, dan capability pemulihan sendiri. Memilih tab hanya menyembunyikan tampilan; tidak memutus koneksi.
- Nama tab dapat diedit. Daftar/nama tab dan pilihan terakhir tersimpan di sessionStorage, bukan password.
- Tab baru tidak menyalin posisi shell atau login SSH bertingkat tab lain. Login gateway/OLT dilakukan di masing-masing sesi, termasuk sesi Quick Action.
- Tombol × meminta konfirmasi dan menutup hanya sesi tab tersebut. Disconnect mempertahankan tab agar bisa dihubungkan kembali. Saat pembukaan/pemulihan sedang berjalan, × sementara tidak aktif.
- Quick Action tetap bisa selesai di latar belakang saat HD memakai terminal manual.
- Pemantauan Local Agent/VPN dibagi bersama seluruh tab melalui `frontend/src/lib/use-network-health.ts`, interval 15 detik; membuka tab manual tidak memicu ping tambahan.

- Pindah halaman: workspace tetap hidup, socket dan SSH tidak dibuat ulang.
- Refresh di Network Tools atau halaman lain: frontend membaca capability pemulihan dari `sessionStorage` tab yang sama, kemudian meminta sesi lama. Tidak mengirim ulang password atau Quick Action.
- Backend memeriksa ID HD, identitas JWT login, masa berlaku login, capability acak sesi, dan apakah sesi sudah dimiliki socket lain.
- Web Locks mencegah tab duplikat mengambil capability pemulihan milik tab yang masih hidup. Backend tetap menolak takeover socket aktif pada browser tanpa Web Locks.
- Output sebelum/saat refresh diputar ulang dari buffer memori. Jika batas terlampaui, riwayat tertua dipangkas dengan pemberitahuan. Ini bukan rekaman permanen atau snapshot layar terminal tanpa batas.
- Hasil Quick Action terakhir dan status pemeriksaan yang masih berjalan dapat dipulihkan.
- Logout menggunakan socket dan endpoint autentikasi `/api/network/terminal/logout`; backend juga menutup sesi tepat saat JWT kedaluwarsa. Jika seluruh jaringan browser tidak tersedia saat logout, penutupan mengikuti timeout backend.
- Disconnect menutup sesi segera. Setelah masa tunggu terlewati, Local Agent kehilangan koneksi ke gateway, perangkat memutus SSH, atau backend/agent restart, pengguna harus login SSH lagi.
- Refresh sebelum pembukaan SSH selesai belum dapat dipulihkan karena capability belum diterima browser.

Capability hanya disimpan di sessionStorage; password SSH dan output tidak ditulis ke penyimpanan browser atau database. Gunakan HTTPS/WSS saat deployment.

## Pengujian

`node --test tests/terminal-session-manager.test.js tests/terminal-session-socket.test.js tests/terminal-recovery-storage.test.js`

Uji manual setelah backend dan Local Agent menggunakan kode terbaru:

1. Login SSH, jalankan satu perintah pemeriksaan read-only.
2. Refresh dan pastikan output/prompt kembali tanpa memasukkan password.
3. Pindah ke Orders, refresh di sana, lalu kembali ke Network Tools.
4. Duplikasi tab: tab kedua tidak boleh mengambil sesi tab pertama.
5. Logout/Disconnect: sesi tidak dapat dipulihkan.
6. Putuskan jaringan browser lebih dari masa tunggu: sesi lama harus ditolak.
7. Buka dua tab manual dan satu Quick Action; output tiap sesi tidak boleh bercampur. Refresh lalu cek ketiganya pulih.
8. Jalankan Quick Action, pindah ke tab manual, lalu kembali: hasil pemeriksaan tetap tersedia.
9. Tutup satu tab manual: terminal manual lain dan Quick Action tetap terhubung.
10. Buka lima manual: tambah tab dinonaktifkan; backend juga menolak koneksi manual keenam dari socket/login lain milik HD yang sama.

Sesi lama yang dibuat sebelum fitur ini dipasang belum memiliki capability; hubungkan SSH sekali lagi sebelum menguji refresh.
