import asyncio
import os
import json
import logging
import urllib.request
import urllib.error

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("PrintAgent")

API_URL = os.getenv("EASYPOS_API_URL", "http://127.0.0.1:8000")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL_SEC", "3"))
AGENT_TOKEN = os.getenv("EASYPOS_AGENT_TOKEN", "")

# ESC/POS Command Constants
ESC = b'\x1b'
GS = b'\x1d'
INIT_PRINTER = ESC + b'@'
CUT_PAPER = GS + b'V\x00'
ALIGN_CENTER = ESC + b'a\x01'
ALIGN_LEFT = ESC + b'a\x00'
BOLD_ON = ESC + b'E\x01'
BOLD_OFF = ESC + b'E\x00'

class EscPosDriver:
    """Mock/Real ESC-POS device handler (USB / Serial / Network raw socket)."""
    def __init__(self, target="console"):
        self.target = target

    def print_text(self, text: str, job_type: str = "receipt"):
        logger.info(f"--- [SENDING TO ESC/POS PRINTER: {job_type}] ---")
        # In hardware mode, this writes raw ESC/POS bytes to /dev/usb/lp0 or raw socket 9100
        print(text)
        logger.info("--- [CUT PAPER SENT] ---")

def fetch_pending_jobs(token: str):
    url = f"{API_URL}/printers/jobs?status=pending"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                return json.loads(response.read().decode())
    except Exception as e:
        logger.warning(f"Error checking print jobs: {e}")
    return []

def ack_job(job_id: int, token: str):
    url = f"{API_URL}/printers/jobs/{job_id}/ack"
    req = urllib.request.Request(url, data=b"{}", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    })
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status == 200
    except Exception as e:
        logger.error(f"Failed to ack job {job_id}: {e}")
    return False

async def main():
    logger.info("EasyPOS Local ESC/POS Thermal Print Spooler starting...")
    driver = EscPosDriver()
    token = AGENT_TOKEN

    while True:
        if token:
            jobs = fetch_pending_jobs(token)
            for j in jobs:
                logger.info(f"Processing Job #{j['id']} ({j['station']}) for Order #{j['order_id']}")
                driver.print_text(j["payload"], j["type"])
                ack_job(j["id"], token)
        await asyncio.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    asyncio.run(main())
