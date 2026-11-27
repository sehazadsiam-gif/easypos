import asyncio
import os
import json
import socket
import subprocess
import logging
import urllib.request
import urllib.error
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("PrintAgent")

# ==============================================================================
# PRINTER CONFIGURATION (Kitchen vs Bar vs Counter)
# ==============================================================================
# Option A: Edit printers.json in this folder (apps/print-agent/printers.json)
# Option B: Set environment variables before running agent.py:
#   EASYPOS_API_URL="https://crownpointofsale.online/api"
#   EASYPOS_TENANT="crown"
#   EASYPOS_EMP_ID="1001"
#   EASYPOS_PASSWORD="<owner-or-cashier-password>"
#   KITCHEN_PRINTER="192.168.1.50:9100"    # LAN thermal printer IP:port, OR "lp:Kitchen_Printer", OR "console"
#   BAR_PRINTER="192.168.1.51:9100"        # Separate LAN/USB printer for Bar KOTs
#   COUNTER_PRINTER="192.168.1.52:9100"    # Counter receipt / customer bill printer
# ==============================================================================

CONFIG_PATH = Path(__file__).parent / "printers.json"


def load_config():
    cfg = {
        "api_url": os.getenv("EASYPOS_API_URL", "https://crownpointofsale.online/api").rstrip("/"),
        "poll_interval": int(os.getenv("POLL_INTERVAL_SEC", "3")),
        "agent_token": os.getenv("EASYPOS_AGENT_TOKEN", ""),
        "tenant": os.getenv("EASYPOS_TENANT", "crown"),
        "emp_id": os.getenv("EASYPOS_EMP_ID", ""),
        "password": os.getenv("EASYPOS_PASSWORD", ""),
        "printers": {
            "kitchen": os.getenv("KITCHEN_PRINTER", "console"),
            "bar": os.getenv("BAR_PRINTER", "console"),
            "counter": os.getenv("COUNTER_PRINTER", "console"),
        },
    }
    if CONFIG_PATH.exists():
        try:
            file_cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            for k in ("api_url", "poll_interval", "agent_token", "tenant", "emp_id", "password"):
                if k in file_cfg and file_cfg[k]:
                    cfg[k] = file_cfg[k]
            if "printers" in file_cfg and isinstance(file_cfg["printers"], dict):
                cfg["printers"].update(file_cfg["printers"])
            cfg["api_url"] = str(cfg["api_url"]).rstrip("/")
        except Exception as e:
            logger.error(f"Failed to read {CONFIG_PATH}: {e}")
    return cfg


# ESC/POS Command Constants
ESC = b"\x1b"
GS = b"\x1d"
INIT_PRINTER = ESC + b"@"
CUT_PAPER = GS + b"V\x00"


class EscPosRouter:
    """Routes print jobs by station ('kitchen', 'bar', 'counter') to separate thermal printers."""

    def __init__(self, station_map: dict):
        self.station_map = {k.lower(): v for k, v in station_map.items()}

    def _build_escpos_bytes(self, text: str) -> bytes:
        # Encode cleanly for thermal printers (fallback ASCII for unsupported glyphs)
        body = text.replace("৳", "Tk ").encode("ascii", errors="replace")
        return INIT_PRINTER + body + b"\n\n\n\n" + CUT_PAPER

    def send(self, station: str, text: str, job_type: str = "receipt") -> bool:
        st = (station or "kitchen").lower()
        target = self.station_map.get(st) or self.station_map.get("counter") or "console"

        logger.info(f"Routing [{st.upper()}] ({job_type}) -> {target}")

        # 1. Console test mode
        if target == "console":
            print(f"\n--- [STATION: {st.upper()} | TYPE: {job_type}] ---\n{text}\n--- [CUT PAPER] ---\n")
            return True

        payload = self._build_escpos_bytes(text)

        # 2. Direct Network Thermal Printer (TCP Port 9100), e.g. "192.168.1.50:9100"
        if ":" in target and not target.startswith("lp:") and not target.startswith("/dev/"):
            host, port_str = target.rsplit(":", 1)
            port = int(port_str)
            try:
                with socket.create_connection((host, port), timeout=5) as sock:
                    sock.sendall(payload)
                logger.info(f"Printed to LAN printer {host}:{port}")
                return True
            except Exception as e:
                logger.error(f"LAN printer {host}:{port} failed: {e}")
                return False

        # 3. USB / OS Printer Queue via `lp` (macOS / Linux), e.g. "lp:Kitchen_Thermal"
        if target.startswith("lp:"):
            queue_name = target[3:].strip()
            try:
                proc = subprocess.run(
                    ["lp", "-d", queue_name, "-o", "raw"],
                    input=payload,
                    capture_output=True,
                    timeout=10,
                )
                if proc.returncode == 0:
                    logger.info(f"Printed to OS queue '{queue_name}'")
                    return True
                logger.error(f"lp failed for '{queue_name}': {proc.stderr.decode(errors='ignore')}")
                return False
            except Exception as e:
                logger.error(f"OS printer '{queue_name}' failed: {e}")
                return False

        # 4. Raw USB device path (Linux), e.g. "/dev/usb/lp0"
        try:
            with open(target, "wb") as dev:
                dev.write(payload)
            logger.info(f"Printed to device {target}")
            return True
        except Exception as e:
            logger.error(f"Device {target} failed: {e}")
            return False


def login_for_token(cfg: dict) -> str:
    if cfg.get("agent_token"):
        return cfg["agent_token"]
    if not cfg.get("emp_id") or not cfg.get("password"):
        return ""
    url = f"{cfg['api_url']}/auth/login"
    body = json.dumps({
        "tenant": cfg["tenant"],
        "emp_id": cfg["emp_id"],
        "password": cfg["password"],
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            data = json.loads(response.read().decode())
            logger.info(f"Authenticated print agent as {data.get('name')} ({data.get('role')})")
            return data.get("token", "")
    except Exception as e:
        logger.error(f"Print agent login failed: {e}")
        return ""


def fetch_pending_jobs(api_url: str, token: str):
    url = f"{api_url}/printers/jobs?status=pending"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                return json.loads(response.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return None  # Signal token refresh
        logger.warning(f"HTTP {e.code} checking print jobs")
    except Exception as e:
        logger.warning(f"Error checking print jobs: {e}")
    return []


def ack_job(api_url: str, job_id: int, token: str):
    url = f"{api_url}/printers/jobs/{job_id}/ack"
    req = urllib.request.Request(url, data=b"{}", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status == 200
    except Exception as e:
        logger.error(f"Failed to ack job {job_id}: {e}")
    return False


async def main():
    cfg = load_config()
    logger.info("Crown POS Multi-Station Thermal Print Agent starting...")
    logger.info(f"API: {cfg['api_url']} | Printers: {cfg['printers']}")
    router = EscPosRouter(cfg["printers"])
    token = login_for_token(cfg)

    while True:
        if not token:
            token = login_for_token(cfg)
        if token:
            jobs = fetch_pending_jobs(cfg["api_url"], token)
            if jobs is None:
                token = login_for_token(cfg)
            else:
                for j in jobs:
                    logger.info(f"Processing Job #{j['id']} | Station: {j['station']} | Order #{j['order_id']}")
                    ok = router.send(j.get("station", "kitchen"), j["payload"], j["type"])
                    if ok:
                        ack_job(cfg["api_url"], j["id"], token)
        await asyncio.sleep(cfg["poll_interval"])


if __name__ == "__main__":
    asyncio.run(main())
