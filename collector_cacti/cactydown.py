import os
import re
import subprocess
import time
import requests

from bs4 import BeautifulSoup
from dotenv import load_dotenv


# =========================================================
# LOAD ENV
# =========================================================

load_dotenv()


# =========================================================
# KONFIGURASI
# =========================================================

NAMA_PC = os.getenv(
    "COLLECTOR_NAME",
    "PC_MONITOR_CACTY"
)

HDWORK_URL = os.getenv(
    "HDWORK_URL",
    "http://localhost:3000/api/cactys/cacti"
)

HDWORK_API_KEY = os.getenv("HDWORK_API_KEY")

COLLECTOR_INTERVAL_SECONDS = int(
    os.getenv("COLLECTOR_INTERVAL_SECONDS", "300")
)

CACTI_HEALTH_PING_HOST = os.getenv(
    "CACTI_HEALTH_PING_HOST"
)



CACTI_CONFIG = {
    "nodeb": {
        "sbs": {
            "base_url": os.getenv("NODEB_SBS_BASE_URL"),
            "username": os.getenv("NODEB_SBS_USERNAME"),
            "password": os.getenv("NODEB_SBS_PASSWORD"),
        },
        "sbu": {
            "base_url": os.getenv("NODEB_SBU_BASE_URL"),
            "username": os.getenv("NODEB_SBU_USERNAME"),
            "password": os.getenv("NODEB_SBU_PASSWORD"),
        },
    },

    "datin": {
        "sbs": {
            "base_url": os.getenv("DATIN_SBS_BASE_URL"),
            "username": os.getenv("DATIN_SBS_USERNAME"),
            "password": os.getenv("DATIN_SBS_PASSWORD"),
        },
        "sbu": {
            "base_url": os.getenv("DATIN_SBU_BASE_URL"),
            "username": os.getenv("DATIN_SBU_USERNAME"),
            "password": os.getenv("DATIN_SBU_PASSWORD"),
        },
    },
}


# =========================================================
# VALIDASI KONFIGURASI GLOBAL
# =========================================================

def validate_config():
    if not HDWORK_URL:
        raise Exception(
            "HDWORK_URL belum dikonfigurasi"
        )

    if not HDWORK_API_KEY:
        raise Exception(
            "HDWORK_API_KEY belum dikonfigurasi"
        )

    if COLLECTOR_INTERVAL_SECONDS <= 0:
        raise Exception(
            "COLLECTOR_INTERVAL_SECONDS harus lebih dari 0"
        )

    if not CACTI_HEALTH_PING_HOST:
        raise Exception(
            "CACTI_HEALTH_PING_HOST belum dikonfigurasi"
        )


# =========================================================
# HEALTH: JALUR COLLECTOR KE CACTI
# =========================================================

def ping_cacti():
    started_at = time.monotonic()

    try:
        result = subprocess.run(
            ["ping", "-c", "1", CACTI_HEALTH_PING_HOST],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        latency_ms = round(
            (time.monotonic() - started_at) * 1000
        )

        if result.returncode == 0:
            print(
                f"✅ Ping Cacti berhasil: "
                f"{CACTI_HEALTH_PING_HOST} ({latency_ms} ms)"
            )
            return {
                "host": CACTI_HEALTH_PING_HOST,
                "reachable": True,
                "latency_ms": latency_ms,
                "error": None,
            }

        error = (result.stderr or result.stdout).strip()
        print(
            f"❌ Ping Cacti gagal: "
            f"{CACTI_HEALTH_PING_HOST}"
        )
        return {
            "host": CACTI_HEALTH_PING_HOST,
            "reachable": False,
            "latency_ms": latency_ms,
            "error": error[:255] or "host tidak merespons ping",
        }

    except (subprocess.TimeoutExpired, OSError) as error:
        print(
            f"❌ Ping Cacti gagal: "
            f"{CACTI_HEALTH_PING_HOST}: {error}"
        )
        return {
            "host": CACTI_HEALTH_PING_HOST,
            "reachable": False,
            "latency_ms": None,
            "error": str(error)[:255],
        }


# =========================================================
# LOGIN CACTI
# =========================================================

def login_to_cacti(base_url, username, password):

    if not base_url:
        raise Exception(
            "BASE URL Cacti belum dikonfigurasi"
        )

    if not username:
        raise Exception(
            f"Username Cacti belum dikonfigurasi: {base_url}"
        )

    if not password:
        raise Exception(
            f"Password Cacti belum dikonfigurasi: {base_url}"
        )

    print(
        f"🔑 Login Cacti: {base_url}"
    )

    session = requests.Session()

    login_url = (
        f"{base_url.rstrip('/')}/index.php"
    )

    res = session.get(
        login_url,
        timeout=10,
        allow_redirects=True
    )

    res.raise_for_status()

    soup = BeautifulSoup(
        res.text,
        "html.parser"
    )

    token_input = soup.find(
        "input",
        {"name": "__csrf_magic"}
    )

    if not token_input:
        raise Exception(
            f"Token CSRF tidak ditemukan: {base_url}"
        )

    csrf_token = token_input.get("value")

    if not csrf_token:
        raise Exception(
            f"Value token CSRF kosong: {base_url}"
        )

    payload = {
        "__csrf_magic": csrf_token,
        "action": "login",
        "login_username": username,
        "login_password": password,
    }

    res = session.post(
        login_url,
        data=payload,
        timeout=10,
        allow_redirects=True
    )

    res.raise_for_status()

    if "Login to Cacti" in res.text:
        raise Exception(
            f"Login gagal ke Cacti: {base_url}"
        )

    print(
        f"✅ Login berhasil: {base_url}"
    )

    return session


# =========================================================
# PARSER DEVICE DOWN
# =========================================================

def parse_down_devices(html):

    soup = BeautifulSoup(
        html,
        "html.parser"
    )

    down_tables = soup.find_all(
        "table",
        bgcolor="#993333"
    )

    devices = []

    for group in down_tables:

        group_name_tag = group.find("b")

        group_name = (
            group_name_tag.get_text(strip=True)
            if group_name_tag
            else "Unknown Group"
        )

        # Abaikan group Other
        if group_name.strip().lower() == "other":
            continue

        inner_tables = group.find_all(
            "table",
            id=re.compile(r"^status_\d+")
        )

        for table in inner_tables:

            rows = table.find_all("tr")

            data = {
                "group": group_name
            }

            # Nama perangkat
            name_tag = table.find("b")

            if name_tag:
                data["name"] = (
                    name_tag.get_text(strip=True)
                )

            for row in rows:

                cells = [
                    cell.get_text(strip=True)
                    for cell in row.find_all("td")
                ]

                if len(cells) < 3:
                    continue

                key = cells[0]
                value = cells[2]

                if key == "OLT IP Address":
                    data["olt_ip"] = value

                elif "Slot/Port" in key:
                    data["slot_port"] = value

                elif "ONU Status" in key:
                    data["status"] = value

                elif "Pengecekan Terakhir" in key:
                    data["last_cek_cacty"] = value

            status = data.get("status")

            if (
                status
                and status.upper()
                not in ["ONLINE", "UP"]
            ):
                devices.append(data)

    print(
        f"🔎 Ditemukan "
        f"{len(devices)} perangkat down."
    )

    return devices


# =========================================================
# COLLECT CACTI
# =========================================================

def collect_cacti(customer_type):

    all_devices = []
    scans = []

    servers = CACTI_CONFIG[
        customer_type
    ]

    for region, config in servers.items():

        print()
        print("=" * 60)

        print(
            f"📡 Collect "
            f"{customer_type.upper()} "
            f"- {region.upper()}"
        )

        print("=" * 60)

        try:

            session = login_to_cacti(
                config["base_url"],
                config["username"],
                config["password"]
            )

            monitor_url = (
                f"{config['base_url'].rstrip('/')}"
                "/plugins/monitor/monitor.php"
            )

            res = session.get(
                monitor_url,
                timeout=10,
                allow_redirects=True
            )

            res.raise_for_status()

            # Proteksi kalau session ternyata kembali ke login
            if "Login to Cacti" in res.text:
                raise Exception(
                    "Session Cacti tidak valid"
                )

            devices = parse_down_devices(
                res.text
            )

            for device in devices:

                device["customer_type"] = (
                    customer_type
                )

                device["server"] = region

                all_devices.append(
                    device
                )

            scans.append({
                "server": region,
                "status": "success",
                "down_count": len(devices),
                "error": None
            })

        except Exception as e:

            print(
                f"❌ Error "
                f"{customer_type.upper()} "
                f"{region.upper()}: "
                f"{e}"
            )

            scans.append({
                "server": region,
                "status": "failed",
                "down_count": None,
                "error": str(e)
            })

    return all_devices, scans


# =========================================================
# KIRIM KE HD WORK
# =========================================================

def send_to_hdwork(
    customer_type,
    devices,
    scans,
    health,
):

    payload = {
        "source": "cacti",
        "customer_type": customer_type,
        "collector": NAMA_PC,
        "scans": scans,
        "devices": devices,
        "health": health,
    }

    print()
    print(
        f"📤 Kirim data "
        f"{customer_type.upper()} "
        f"ke HD Work..."
    )

    try:

        res = requests.post(
            HDWORK_URL,
            json=payload,
            headers={
                "X-Collector-Key":
                    HDWORK_API_KEY
            },
            timeout=15
        )

        print(
            f"📡 HD Work "
            f"{customer_type.upper()} "
            f"status: "
            f"{res.status_code}"
        )

        print(
            "📥 HD Work response:",
            res.text
        )

        res.raise_for_status()

        print(
            f"✅ Data "
            f"{customer_type.upper()} "
            f"berhasil dikirim"
        )

        return True

    except requests.RequestException as e:

        print(
            f"❌ Gagal kirim "
            f"{customer_type.upper()} "
            f"ke HD Work: "
            f"{e}"
        )

        return False


# =========================================================
# MAIN PROCESS
# =========================================================

def gass():

    print()
    print("=" * 60)

    health = {
        "cacti_ping": ping_cacti(),
    }

    print(
        "🚀 CACTI COLLECTOR START"
    )

    print(
        f"💻 Collector: {NAMA_PC}"
    )

    print("=" * 60)

    # =====================================================
    # NODEB
    # =====================================================

    nodeb_devices, nodeb_scans = (
        collect_cacti("nodeb")
    )

    send_to_hdwork(
        "nodeb",
        nodeb_devices,
        nodeb_scans,
        health,
    )

    # =====================================================
    # DATIN
    # =====================================================

    datin_devices, datin_scans = (
        collect_cacti("datin")
    )

    send_to_hdwork(
        "datin",
        datin_devices,
        datin_scans,
        health,
    )

    print()
    print("=" * 60)

    print(
        "✅ CACTI COLLECTOR SELESAI"
    )

    print("=" * 60)


# =========================================================
# START
# =========================================================

def run_forever():
    while True:
        started_at = time.monotonic()
        gass()
        elapsed_seconds = time.monotonic() - started_at
        wait_seconds = max(
            0,
            COLLECTOR_INTERVAL_SECONDS - elapsed_seconds,
        )

        print(
            f"⏱️ Siklus berikutnya dalam "
            f"{round(wait_seconds)} detik"
        )
        time.sleep(wait_seconds)

if __name__ == "__main__":

    try:
        validate_config()
        run_forever()

    except Exception as e:

        print()
        print(
            f"❌ FATAL ERROR: {e}"
        )
