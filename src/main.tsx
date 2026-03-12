// --- ENVIRONMENT COMPATIBILITY (MUST BE FIRST) ---
import { io } from "socket.io-client";

// --- Socket.io Tunneling ---
// This class mimics a standard WebSocket but sends data over Socket.io
class SocketTunnel {
  private socket: any;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: any }) => void) | null = null;
  public onclose: ((event: { code: number, reason: string }) => void) | null = null;
  public onerror: ((err: any) => void) | null = null;
  public readyState: number = 0; // 0 = CONNECTING
  public binaryType: string = "arraybuffer";
  public bufferedAmount: number = 0;
  public extensions: string = "";
  public protocol: string = "";
  public url: string = "";
  
  // Constants
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;

  constructor(url: string) {
    this.url = url;
    console.log("[OwlHelp!] Creating Socket.io Tunnel for:", url);
    this.socket = io({
      path: "/socket.io",
      transports: ["polling", "websocket"] // Start with polling for maximum compatibility
    });

    this.socket.on("connect", () => {
      console.log("[OwlHelp!] Tunnel Connected. Requesting Gemini link...");
      this.socket.emit("gemini-connect", { url });
    });

    this.socket.on("gemini-status", (data: any) => {
      if (data.status === "open") {
        this.readyState = 1; // OPEN
        if (this.onopen) this.onopen();
      } else if (data.status === "closed") {
        this.readyState = 3; // CLOSED
        if (this.onclose) this.onclose({ code: data.code || 1000, reason: data.reason || "Closed" });
      } else if (data.status === "error") {
        if (this.onerror) this.onerror(data.message);
      }
    });

    this.socket.on("gemini-data", (data: any) => {
      // Data can be binary (ArrayBuffer) or string
      if (this.onmessage) this.onmessage({ data });
    });

    this.socket.on("disconnect", () => {
      this.readyState = 3;
      if (this.onclose) this.onclose({ code: 1006, reason: "Abnormal Closure" });
    });
  }

  async send(data: any) {
    if (data instanceof Blob) {
      const buffer = await data.arrayBuffer();
      this.socket.emit("gemini-send", buffer);
    } else {
      this.socket.emit("gemini-send", data);
    }
  }

  close() {
    this.socket.disconnect();
  }

  // Standard event listener interface
  addEventListener(type: string, listener: any) {
    if (type === 'open') this.onopen = listener;
    if (type === 'message') this.onmessage = listener;
    if (type === 'close') this.onclose = listener;
    if (type === 'error') this.onerror = listener;
  }
  removeEventListener() {}
}

if (typeof window !== 'undefined') {
  (function() {
    // Intercept WebSocket creation
    const OriginalWebSocket = window.WebSocket;
    const OwlWS = function(this: any, url: string | URL, protocols?: string | string[]) {
      const targetUrl = url.toString();
      if (targetUrl.includes("generativelanguage.googleapis.com")) {
        // Fix double slash in client side too
        const fixedUrl = targetUrl.replace("googleapis.com//ws/", "googleapis.com/ws/").replace("googleapis.com//v1beta/", "googleapis.com/v1beta/");
        return new SocketTunnel(fixedUrl);
      }
      return new OriginalWebSocket(targetUrl, protocols);
    };
    
    // Preserve constants
    (OwlWS as any).prototype = OriginalWebSocket.prototype;
    (OwlWS as any).CONNECTING = 0;
    (OwlWS as any).OPEN = 1;
    (OwlWS as any).CLOSING = 2;
    (OwlWS as any).CLOSED = 3;

    // Use a getter/setter to protect it
    try {
      Object.defineProperty(window, 'WebSocket', {
        get: () => OwlWS,
        set: () => console.log("[OwlHelp!] Blocked attempt to modify WebSocket."),
        configurable: true
      });
      (window as any).WS_REDIRECTOR_INSTALLED = true;
      console.log("[OwlHelp!] WebSocket constructor protected and proxied via Socket.io. Status: ACTIVE");
    } catch (e) {
      (window as any).WebSocket = OwlWS;
      (window as any).WS_REDIRECTOR_INSTALLED = true;
    }
  })();
}

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initGA } from './services/analytics';

// Initialize Google Analytics
initGA();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
