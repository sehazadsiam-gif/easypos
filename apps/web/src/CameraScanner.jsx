import { useState, useEffect, useRef } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { IconCamera, IconClose, IconCheck, IconAlert, IconSync } from "./Icons";

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1180, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.11);
  } catch {
    // Ignore audio errors when blocked by autoplay policy
  }
}

export function CameraScannerModal({
  title = "Camera Barcode Scanner",
  subtitle = "Point your camera at a CODE-128, EAN, or QR barcode",
  continuous = true,
  onScan,
  onClose,
}) {
  const regionIdRef = useRef(`cam-scanner-${Math.random().toString(36).slice(2, 9)}`);
  const scannerRef = useRef(null);
  const lastScanRef = useRef({ code: "", time: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [cameras, setCameras] = useState([]);
  const [camIdx, setCamIdx] = useState(0);
  const [status, setStatus] = useState("starting"); // starting | active | error
  const [errMsg, setErrMsg] = useState("");
  const [lastCode, setLastCode] = useState("");
  const [scanCount, setScanCount] = useState(0);
  const [keepOpen, setKeepOpen] = useState(continuous);
  const keepOpenRef = useRef(keepOpen);
  keepOpenRef.current = keepOpen;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stopScanner = async () => {
    const inst = scannerRef.current;
    scannerRef.current = null;
    if (!inst) return;
    try {
      if (inst.isScanning) {
        await inst.stop();
      }
    } catch {
      // Ignore stop errors
    }
    try {
      inst.clear();
    } catch {
      // Ignore clear errors
    }
  };

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      setStatus("starting");
      setErrMsg("");

      await stopScanner();
      if (cancelled) return;

      const el = document.getElementById(regionIdRef.current);
      if (!el) return;

      const formatsToSupport = [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.QR_CODE,
      ];

      const html5QrCode = new Html5Qrcode(regionIdRef.current, {
        formatsToSupport,
        verbose: false,
      });
      scannerRef.current = html5QrCode;

      const config = {
        fps: 12,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const w = Math.min(Math.floor(viewfinderWidth * 0.85), 360);
          const h = Math.min(Math.floor(viewfinderHeight * 0.45), 160);
          return { width: Math.max(180, w), height: Math.max(90, h) };
        },
        aspectRatio: 1.5,
      };

      const handleDecoded = (decodedText) => {
        const clean = String(decodedText || "").trim();
        if (!clean) return;
        const now = Date.now();
        // Prevent duplicate rapid-fire scans of the exact same barcode within 1.4s
        if (lastScanRef.current.code === clean && now - lastScanRef.current.time < 1400) {
          return;
        }
        lastScanRef.current = { code: clean, time: now };
        playBeep();
        setLastCode(clean);
        setScanCount((c) => c + 1);
        onScanRef.current?.(clean);

        if (!keepOpenRef.current) {
          stopScanner().then(() => onClose());
        }
      };

      try {
        let cams = cameras;
        if (cams.length === 0) {
          try {
            cams = await Html5Qrcode.getCameras();
            if (!cancelled && cams.length > 0) {
              setCameras(cams);
            }
          } catch {
            cams = [];
          }
        }

        if (cancelled) return;

        // If user switched camera explicitly, use that deviceId; otherwise prefer environment (rear camera)
        const cameraSource =
          cams.length > 0 && camIdx > 0 && cams[camIdx]
            ? cams[camIdx].id
            : { facingMode: "environment" };

        try {
          await html5QrCode.start(cameraSource, config, handleDecoded, () => {});
        } catch (primaryErr) {
          // Fallback to first available camera (e.g. desktop webcam that rejects facingMode: environment)
          if (cams.length > 0) {
            await html5QrCode.start(cams[camIdx % cams.length].id, config, handleDecoded, () => {});
          } else {
            await html5QrCode.start({ facingMode: "user" }, config, handleDecoded, () => {});
          }
        }

        if (!cancelled) {
          setStatus("active");
        }
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          const raw = e?.message || String(e || "Unable to access camera");
          if (raw.toLowerCase().includes("permission") || raw.toLowerCase().includes("notallowed")) {
            setErrMsg("Camera permission denied. Please allow camera access in your browser settings and try again.");
          } else if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
            setErrMsg("Camera scanning requires HTTPS. Open the app over https:// to use the camera.");
          } else {
            setErrMsg(raw);
          }
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [camIdx]);

  const switchCamera = () => {
    if (cameras.length < 2) return;
    setCamIdx((prev) => (prev + 1) % cameras.length);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="confirm-modal"
        style={{ maxWidth: "540px", padding: "1.25rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ marginBottom: "0.75rem", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <div
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "10px",
                background: "var(--brand-light)",
                color: "var(--brand-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <IconCamera size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.08rem", fontWeight: 800, color: "var(--ink)" }}>
                {title}
              </h3>
              <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: "var(--ink-muted)" }}>
                {subtitle}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ minHeight: "34px", padding: "0 10px", borderRadius: "999px" }}
            aria-label="Close scanner"
          >
            <IconClose size={15} />
          </button>
        </div>

        <div
          style={{
            position: "relative",
            width: "100%",
            minHeight: "260px",
            background: "#090d16",
            borderRadius: "14px",
            overflow: "hidden",
            border: "1.5px solid #1e293b",
          }}
        >
          <div id={regionIdRef.current} style={{ width: "100%" }} />

          {status === "starting" && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "#cbd5e1",
                fontSize: "0.9rem",
                fontWeight: 600,
                gap: "0.5rem",
              }}
            >
              <IconCamera size={28} color="#818cf8" />
              <span>Initializing camera...</span>
            </div>
          )}

          {status === "error" && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "1.25rem",
                textAlign: "center",
                color: "#fecdd3",
                gap: "0.6rem",
              }}
            >
              <IconAlert size={28} color="#fb7185" />
              <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>Camera Unavailable</div>
              <div style={{ fontSize: "0.82rem", color: "#cbd5e1", lineHeight: 1.45 }}>{errMsg}</div>
            </div>
          )}
        </div>

        {lastCode && (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "0.6rem 0.85rem",
              borderRadius: "10px",
              background: "var(--emerald-light)",
              border: "1px solid var(--emerald-border)",
              color: "#065f46",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              fontSize: "0.85rem",
              fontWeight: 700,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
              <IconCheck size={15} color="#059669" />
              <span>Scanned: <code>{lastCode}</code></span>
            </span>
            <span style={{ fontSize: "0.75rem", opacity: 0.85 }}>Total: {scanCount}</span>
          </div>
        )}

        <div
          className="row"
          style={{ marginTop: "0.9rem", flexWrap: "wrap", gap: "0.6rem" }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.45rem",
              fontSize: "0.84rem",
              fontWeight: 600,
              color: "var(--ink-muted)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={keepOpen}
              onChange={(e) => setKeepOpen(e.target.checked)}
              style={{ minHeight: "auto", width: "16px", height: "16px" }}
            />
            <span>Continuous scan</span>
          </label>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            {cameras.length > 1 && (
              <button
                className="secondary"
                onClick={switchCamera}
                style={{ minHeight: "38px", padding: "0.35rem 0.85rem", fontSize: "0.84rem" }}
              >
                <IconSync size={14} />
                <span>Switch Camera</span>
              </button>
            )}
            <button
              className="primary"
              onClick={onClose}
              style={{ minHeight: "38px", padding: "0.35rem 1.15rem", fontSize: "0.86rem" }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
