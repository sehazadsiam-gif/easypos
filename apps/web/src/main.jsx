import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./style.css";
import { registerServiceWorker } from "./registerServiceWorker.js";

createRoot(document.getElementById("root")).render(<App />);

// Register Service Worker for Progressive Web App capabilities
registerServiceWorker();
