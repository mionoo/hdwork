# Lokasi lama agent

Source aplikasi sudah dipindahkan ke `cacti_agent/sync`. Gunakan
[launcher bersama](../../cacti_agent/README.md).

File `.env`, lock dan laporan lokal di sini sengaja tidak dipindahkan saat proses
lama masih berjalan. Hentikan proses lama, lalu jalankan:

```bash
python3 cacti_agent/launcher.py --migrate-local
python3 cacti_agent/launcher.py --check
python3 cacti_agent/launcher.py
```

Jangan hapus jurnal aktif; migrasi memindahkannya dengan identitas/token yang sama.
