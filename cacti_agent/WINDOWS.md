# Menjalankan Cacti Agent di Windows (source Python, tanpa installer)

## Sebelum beralih

- Hentikan seluruh sync/collector lama, termasuk di Mac atau PC lain. Jangan ada
  dua writer/collector memakai sumber yang sama. Tutup dengan Ctrl+C, bukan dengan
  menghapus jurnal atau mereset reservasi database.
- Gunakan Python 3.10+ dengan pip pada Windows 10/11 dan Windows PowerShell yang
  memiliki `Get-CimInstance`. Pemeriksaan proses gagal akan menghentikan startup,
  bukan diam-diam melewati pengaman.
- Pastikan VPN menjangkau kedua Cacti dan HTTPS backend produksi. Backend, SQL,
  Apps Script dan flag otomatisasi yang sudah aktif tidak perlu diubah untuk port ini.

## Salin folder dan data dengan aman

Salin seluruh `cacti_agent` yang telah diperbarui, bukan hanya `launcher.py`.
Struktur minimal normalnya mencakup `agent_support.py`, `launcher.py`,
`requirements.txt`, `sync/`, `collector/`, serta satu `.env` di samping launcher.
Agent normal tidak membutuhkan folder `src/` backend. Alat batch pilot historis
`batch_apply.py` masih membutuhkan repository lengkap dan bukan launcher rutin.

Jika pindah dari Mac, setelah proses lama berhenti pindahkan `.env` dan **seluruh
jurnal/laporan sync** secara privat ke lokasi yang sama relatif terhadap launcher.
Jurnal aktif memuat token run backend: pertahankan byte/identitasnya, jangan membuat
run baru untuk mengatasi kehilangan token. Jangan kirim `.env`/jurnal ke GitHub.

Jika menggunakan ZIP source bersih, ZIP tidak membawa `.env` atau jurnal. Tambahkan
konfigurasi sendiri dan transfer jurnal dari mesin lama sebelum menjalankan.
Kalau proses baru pernah membuat jurnal sendiri, jangan menimpa salah satunya;
perlu review run terlebih dahulu.

## Perintah PowerShell

Dari folder yang **langsung berisi `launcher.py`**, misalnya pada screenshot:

```powershell
cd D:\BOT\Alarm_cacty_suramadu\cacti_agent\cacti_agent
py -m pip install -r .\requirements.txt
py .\launcher.py --check
```

Jika `py` tidak tersedia tetapi `python` sudah benar di PATH, ganti `py` dengan
`python`. Worker otomatis menggunakan interpreter yang sama dengan launcher.
Tidak perlu mengubah path Python di kode atau menyetel ExecutionPolicy.

Jika konfigurasi benar akan muncul:

```text
[LAUNCHER] Konfigurasi lokal dan lock valid. Tidak ada akses jaringan atau worker dimulai.
```

Lalu jalankan:

```powershell
py .\launcher.py
```

Ini **langsung menjalankan apply sync** termasuk delete NOT yang lolos pengaman,
serta pengiriman alarm collector. Log `[SYNC]` dan `[COLLECTOR]` harus muncul.
`--check` hanya pemeriksaan lokal; keberhasilan koneksi/API key terlihat pada log
worker, bukan dibuktikan oleh `--check`.

Gunakan Ctrl+C untuk menghentikan launcher. Worker Windows menerima Ctrl+Break
terarah dan mempertahankan jurnal. Jika 40 detik belum berhenti, launcher melakukan
penghentian paksa; jurnal/intent tetap digunakan untuk rekonsiliasi saat dibuka lagi.
Jangan menutup paksa jendela PowerShell sebagai prosedur stop normal. Jika terlanjur,
pastikan tidak ada worker Python agent tertinggal sebelum menjalankan ulang.

Untuk `.env` di folder lama pada **PC yang sama**, hentikan semua proses lalu:

```powershell
py .\launcher.py --migrate-local
py .\launcher.py --check
```

Migrasi mengharapkan folder lama `integrations\cacti-agent` dan `collector_cacti`
di root repository, bukan mencari folder bebas di seluruh disk. Untuk ZIP mandiri
lebih sederhana transfer `.env` dan jurnal secara privat seperti di atas.

## Catatan keamanan dan batasan

- Simpan pada folder lokal NTFS yang dapat ditulis, tidak di Program Files, OneDrive,
  folder jaringan, atau share publik. Batasi akses lewat Properties → Security;
  permission POSIX 0600 bukan pengganti ACL Windows.
- Satu folder agent per PC: lock mencegah launcher/worker ganda yang memakai folder
  yang sama. Dua salinan folder terpisah tidak berbagi lock lokal.
- `.env` dibaca sebagai UTF-8 (BOM Notepad juga didukung). Log worker memakai UTF-8
  agar karakter/emoji collector tidak menyebabkan UnicodeEncodeError.
- Interval tidak berubah: sync menunggu 600 detik setelah siklus selesai; collector
  300 detik antar awal siklus. Keep PC awake dan VPN aktif.
- Rilis ini diuji di macOS dengan tes cabang Windows tersimulasi. Uji native Windows
  dengan `--check`, start dua worker, dan Ctrl+C tetap diperlukan pada PC tujuan.

Rujukan API: [lock Windows](https://docs.python.org/3/library/msvcrt.html#msvcrt.locking)
dan [subprocess/sinyal Windows](https://docs.python.org/3/library/subprocess.html#subprocess.Popen.send_signal).
