# Konfigurasi port HD Work

| Komponen | Variabel | Nilai lokal | Peran |
| --- | --- | --- | --- |
| Backend | `PORT` | `3090` | API dan Socket.IO |
| Frontend Vite | `VITE_DEV_PORT` | `5173` | Server pengembangan frontend |
| Local Agent | `PORT` | `5050` | Endpoint lokal Local Agent, hanya di `127.0.0.1` |
| SSH perangkat | — | `22` | Koneksi Local Agent ke perangkat jaringan |

Socket.IO tidak membutuhkan port sendiri. Browser dan Local Agent sama-sama tersambung ke port backend (`3090`): browser ke namespace utama dan Local Agent ke namespace `/agent`.

## Variabel antar-komponen

```env
# .env pada root proyek
PORT=3090
FRONTEND_ORIGIN=http://localhost:5173

# frontend/.env
VITE_API_BASE_URL=http://localhost:3090
VITE_DEV_PORT=5173

# local_agent/.env
HD_WORK_SERVER_URL=http://127.0.0.1:3090
PORT=5050
```

Jika salah satu port diganti, perbarui semua nilai yang merujuk kepadanya. Contohnya, perubahan `VITE_DEV_PORT` juga harus diikuti perubahan `FRONTEND_ORIGIN` menjadi origin yang sama.
