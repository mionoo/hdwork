# Collector Cacti

Jalankan collector sebagai proses yang tetap aktif. Ia melakukan satu siklus saat dimulai, lalu mengulang setiap lima menit secara default.

1. Salin `.env.example` menjadi `.env`, lalu isi alamat Cacti, kredensial, API key, dan `CACTI_HEALTH_PING_HOST`.
2. Instal dependensi dari `requirements.txt`.
3. Jalankan `python3 cactydown.py` melalui service manager pada PC collector agar proses otomatis hidup kembali setelah PC restart.

Konfigurasi interval:

- `COLLECTOR_INTERVAL_SECONDS=300`: kirim data ke backend setiap 5 menit.
- `CACTI_HEALTH_PING_HOST`: IP Cacti yang diuji melalui jalur VPN/intranet pada setiap siklus.

Backend mengevaluasi health setiap 10 menit. Jika tidak menerima data lebih dari 15 menit, ping Cacti gagal, atau scan Cacti gagal, backend mengirim alarm ke grup Telegram NODEB atau DATIN terkait. Ketika pulih, backend mengirim satu pesan pemulihan.
