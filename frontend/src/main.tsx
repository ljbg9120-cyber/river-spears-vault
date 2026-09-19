import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { initPerf, startWatching } from "./lib/perf";
import { AuthProvider, PlayerProvider } from "./lib/store";

// Decide the drawing profile before first paint, then keep watching the
// real frame rate and step down if this machine cannot keep up.
initPerf();
startWatching();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <PlayerProvider>
          <App />
        </PlayerProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
