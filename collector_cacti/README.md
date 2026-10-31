# Collector Cacti

Source collector sekarang ada di `cacti_agent/collector`, dengan satu `.env` dan
launcher bersama sync. Ikuti [panduan migrasi](../cacti_agent/README.md). Konfigurasi
lokal lama di folder ini tetap sebagai cadangan; jangan jalankan dua collector.

Hentikan collector/sync lama, lalu dari root repository:

```bash
python3 cacti_agent/launcher.py --migrate-local
python3 cacti_agent/launcher.py --check
python3 cacti_agent/launcher.py
```

Interval dan pengiriman alarm/health collector tetap sama seperti sebelumnya.
