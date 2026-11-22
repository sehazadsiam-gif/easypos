/**
 * Offline Outbox Storage & Sync Engine for EasyPOS
 * Provides client UUID generation, persistent queued actions in localStorage/IndexedDB,
 * and automatic synchronization with /sync/outbox when online.
 */

const OUTBOX_KEY = "easypos_outbox_v1";

export function getOutbox() {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveOutbox(items) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch (e) {
    console.error("Failed to save outbox", e);
  }
}

export function queueOutbox(action, data, client_uuid = null) {
  const uuid = client_uuid || crypto.randomUUID();
  const items = getOutbox();
  const item = {
    action,
    client_uuid: uuid,
    data,
    queued_at: new Date().toISOString(),
    retry_count: 0
  };
  items.push(item);
  saveOutbox(items);
  return item;
}

export async function flushOutbox(token, api) {
  const items = getOutbox();
  if (!items || items.length === 0) return { synced: 0, remaining: 0 };

  const payload = {
    items: items.map(i => ({
      action: i.action,
      client_uuid: i.client_uuid,
      data: i.data
    }))
  };

  try {
    const res = await api("/sync/outbox", token, payload);
    const results = res.results || [];
    
    // Filter out successfully processed items
    const successUuids = new Set(
      results.filter(r => r.status === "success").map(r => r.client_uuid)
    );

    const remaining = items.filter(i => !successUuids.has(i.client_uuid));
    saveOutbox(remaining);

    return {
      synced: successUuids.size,
      remaining: remaining.length,
      results
    };
  } catch (err) {
    console.warn("Outbox sync failed (offline or network error)", err);
    return { synced: 0, remaining: items.length, error: err.message };
  }
}
