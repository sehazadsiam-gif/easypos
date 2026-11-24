# EasyPOS Local ESC/POS Print Agent

Standalone daemon that connects to the EasyPOS API via HTTP polling or WebSockets and writes raw ESC/POS bytes directly to kitchen and counter thermal printers (USB, Network/LAN, Bluetooth).

### Configuration
Set environment variables:
- `EASYPOS_API_URL`: Backend URL (e.g. `http://localhost:8000` or `https://crownpointofsale.online/api`)
- `EASYPOS_AGENT_TOKEN`: JWT Auth token of a POS terminal/user
- `POLL_INTERVAL_SEC`: Check frequency in seconds (default: 3)

### Run
```bash
python3 agent.py
```
