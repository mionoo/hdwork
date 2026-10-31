# Cacti Agent: satu launcher, dua aplikasi

Jalankan di Windows, macOS, atau Linux yang selalu menyala dan terhubung VPN SBS/SBU. Tidak
memerlukan PM2. Backend/migrasi/Apps Script tetap harus diaktifkan sesuai
[panduan otomatisasi](../docs/datin-cacti-automation.md).

```text
cacti_agent/
  .env                 # privat, satu konfigurasi bersama
  .env.example         # template aman untuk Git
  launcher.py          # supervisor lokal
  agent_support.py     # konfigurasi, lock, migrasi lokal
  requirements.txt
  sync/                # rekonsiliasi DATIN + alat pilot/bulk historis
  collector/           # pembacaan alarm DATIN/NODEB + health
```

## Beralih dari folder lama (sekali per komputer)

Untuk PC Windows lihat [panduan PowerShell](WINDOWS.md). Python tetap diperlukan;
ini source Python, **bukan** installer/EXE. Tidak ada build installer pada perubahan ini.

1. Hentikan **semua** terminal/service collector dan sync lama dengan Ctrl+C.
   Jangan jalankan pilot/bulk/editor Cacti bersamaan.
2. Instal dependensi pada interpreter yang akan dipakai:

   ```bash
   cd /Users/fajarkhojek/hd_work
   /usr/local/bin/python3 -m pip install -r cacti_agent/requirements.txt
   /usr/local/bin/python3 cacti_agent/launcher.py --migrate-local
   ```

   Migrasi tidak mengakses backend/Cacti dan tidak memulai worker. Ia menggabungkan
   `.env` lama di `integrations/cacti-agent` dan `collector_cacti` tanpa mencetak
   nilai rahasia, lalu **memindahkan** seluruh laporan/jurnal ke `cacti_agent/sync`.
   Token/progres jurnal tetap sama. `.env` lama dibiarkan sebagai cadangan; aplikasi
   baru hanya memakai `cacti_agent/.env`. `.env.example` lama tidak dibaca karena
   mungkin telah diisi kredensial lokal.

   Bila variabel bernama sama berbeda nilainya, migrasi berhenti: satukan manual
   ke `cacti_agent/.env` lalu ulangi. File `.env` baru yang sudah ada tidak ditimpa.
   Nama laporan ganda juga ditahan, bukan ditimpa. Jangan hapus jurnal aktif untuk
   melewati pengaman. Migrasi hanya dilakukan di mesin pemilik jurnal; pindah mesin
   memerlukan penghentian proses lama dan transfer privat jurnal beserta `.env`.
3. Periksa `.env` gabungan. `HDWORK_URL` adalah endpoint penuh collector;
   `HDWORK_BASE_URL` adalah origin API sync. Dua API key tetap terpisah. `CACTI_*`
   dipakai sync dan menjadi fallback collector DATIN; `DATIN_*` dapat mempertahankan
   akun monitoring tersendiri. `NODEB_*` sama seperti collector sebelumnya.
4. Validasi tanpa jaringan atau write:

   ```bash
   /usr/local/bin/python3 cacti_agent/launcher.py --check
   ```

Jika instalasi baru tanpa konfigurasi lama, salin `.env.example` ke `.env` dan isi
kredensial; tidak perlu migrasi jika memang tidak memiliki jurnal lama. File `.env`
sebaiknya memiliki permission 0600. Semua kredensial/jurnal/laporan dikecualikan Git.

Pada Windows gunakan folder NTFS yang hanya dapat diakses akun operator. Mode 0600
tidak menerapkan ACL Windows; batasi akses folder melalui Properties → Security.
Jurnal memakai file flush + atomic replace; fsync direktori hanya tersedia di POSIX.

## Satu perintah untuk menjalankan keduanya

```bash
/usr/local/bin/python3 /Users/fajarkhojek/hd_work/cacti_agent/launcher.py
```

Perintah ini **langsung menjalankan sync apply**, termasuk delete NOT yang lolos
pengaman. Jangan dipakai hanya untuk preview. Terminal tetap terbuka, PC tidak
sleep dan VPN aktif. Path `.env` tidak bergantung pada folder terminal saat ini.

- `[SYNC]`: siklus create/edit/delete DATIN; jeda 600 detik **setelah selesai**.
- `[COLLECTOR]`: alarm/health; interval 300 detik **antar awal siklus** seperti dulu.
- `[LAUNCHER]`: status worker; worker yang keluar dicoba lagi setelah 10 detik.

Worker punya proses dan sesi login sendiri. Sync lambat/gagal tidak menghalangi
collector. Lock lokal mencegah dua launcher atau worker sejenis pada mesin yang
sama; reservasi backend tetap mencegah dua writer sync lintas mesin. Collector
lintas mesin tidak memiliki lock global—hentikan collector lama secara operasional.

Ctrl+C/SIGTERM pada launcher memberi kedua worker kesempatan berhenti dengan aman.
Jurnal sync dipertahankan untuk resume; tidak ada POST yang diulang secara buta.
Launcher bukan service auto-start setelah reboot; jalankan kembali perintah di atas.
Tidak ada perubahan backend atau skema database akibat penggabungan folder ini.

## Diagnostik terpisah

```bash
python3 cacti_agent/sync/reconcile.py --plan
python3 cacti_agent/sync/reconcile.py --plan --full-audit
```

Hentikan launcher sebelum menjalankan alat sync terpisah. Jika ada run aktif,
resume lewat launcher, bukan menghapus jurnal. Alat pilot/bulk disimpan hanya untuk
riwayat/diagnostik dan tetap diblokir backend saat flag otomatisasi aktif.
