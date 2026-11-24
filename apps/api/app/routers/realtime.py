from typing import Dict, List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["realtime"])

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, tenant_id: int, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.setdefault(tenant_id, []).append(websocket)

    def disconnect(self, tenant_id: int, websocket: WebSocket):
        if tenant_id in self.active_connections:
            if websocket in self.active_connections[tenant_id]:
                self.active_connections[tenant_id].remove(websocket)

    async def broadcast(self, tenant_id: int, message: dict):
        if tenant_id in self.active_connections:
            for connection in self.active_connections[tenant_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    pass

manager = ConnectionManager()

@router.websocket("/ws/{tenant_id}")
async def websocket_endpoint(websocket: WebSocket, tenant_id: int):
    await manager.connect(tenant_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Echo or broadcast client events (table drag, order status)
            await manager.broadcast(tenant_id, {"event": "ping", "data": data})
    except WebSocketDisconnect:
        manager.disconnect(tenant_id, websocket)
