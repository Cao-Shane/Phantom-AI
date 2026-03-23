import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { exit } from "@tauri-apps/plugin-process";
import { Store } from "@tauri-apps/plugin-store";
import { openUrl } from "@tauri-apps/plugin-opener";

interface HistoryMessage { role: "user" | "model"; parts: { text: string }[]; }

async function askGemini(
  apiKey: string, prompt: string, history: HistoryMessage[],
  imageDataUrl: string | null, onChunk: (chunk: string) => void
): Promise<void> {
  const contents: object[] = [];
  for (const h of history.slice(0, -1)) {
    contents.push({ role: h.role, parts: h.parts });
  }
  const userParts: object[] = [];
  if (imageDataUrl) {
    const [header, base64] = imageDataUrl.split(",");
    const mimeType = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
    userParts.push({ inlineData: { mimeType, data: base64 } });
  }
  userParts.push({ text: prompt });
  contents.push({ role: "user", parts: userParts });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (!json || json === "[DONE]") continue;
      try {
        const parsed = JSON.parse(json);
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) onChunk(text);
      } catch {}
    }
  }
}

async function validateGeminiKey(apiKey: string): Promise<void> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
}

function renderMarkdown(text: string, color: string, fontSize: number, accent: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { code.push(lines[i]); i++; }
      nodes.push(<div key={i} style={{ margin: "6px 0" }}>
        {lang && <div style={{ fontSize: fontSize - 3, color: "#94a3b8", marginBottom: 2, fontFamily: "monospace" }}>{lang}</div>}
        <pre style={{ background: "rgba(0,0,0,0.35)", borderRadius: 6, padding: "8px 10px", fontSize: fontSize - 2, fontFamily: "'JetBrains Mono',monospace", overflowX: "auto", margin: 0, color: "#e2e8f0", lineHeight: 1.5, border: "1px solid rgba(255,255,255,0.08)" }}>{code.join("\n")}</pre>
      </div>);
      i++; continue;
    }
    if (line.startsWith("### ")) nodes.push(<div key={i} style={{ fontWeight: 700, fontSize: fontSize + 1, margin: "6px 0 2px", color }}>{fmt(line.slice(4), fontSize, accent)}</div>);
    else if (line.startsWith("## ")) nodes.push(<div key={i} style={{ fontWeight: 700, fontSize: fontSize + 2, margin: "6px 0 2px", color }}>{fmt(line.slice(3), fontSize, accent)}</div>);
    else if (line.startsWith("# ")) nodes.push(<div key={i} style={{ fontWeight: 700, fontSize: fontSize + 3, margin: "6px 0 2px", color }}>{fmt(line.slice(2), fontSize, accent)}</div>);
    else if (line.match(/^[-*] /)) nodes.push(<div key={i} style={{ display: "flex", gap: 6, margin: "1px 0" }}><span style={{ color: "#94a3b8", flexShrink: 0 }}>•</span><span>{fmt(line.slice(2), fontSize, accent)}</span></div>);
    else if (line.match(/^\d+\. /)) { const num = line.match(/^(\d+)\. /)?.[1]; nodes.push(<div key={i} style={{ display: "flex", gap: 6, margin: "1px 0" }}><span style={{ color: "#94a3b8", flexShrink: 0, minWidth: 14 }}>{num}.</span><span>{fmt(line.replace(/^\d+\. /, ""), fontSize, accent)}</span></div>); }
    else if (line.match(/^---+$/)) nodes.push(<hr key={i} style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.1)", margin: "6px 0" }} />);
    else if (line.trim() === "") nodes.push(<div key={i} style={{ height: 4 }} />);
    else nodes.push(<div key={i} style={{ margin: "1px 0", lineHeight: 1.55 }}>{fmt(line, fontSize, accent)}</div>);
    i++;
  }
  return <>{nodes}</>;
}

function fmt(text: string, fontSize: number, accent: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/[^\s)]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("__") && part.endsWith("__")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 3, padding: "1px 4px", fontSize: fontSize - 1, fontFamily: "'JetBrains Mono',monospace" }}>{part.slice(1, -1)}</code>;
    const mdLink = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (mdLink) return <span key={i} onClick={() => openUrl(mdLink[2]).catch(console.error)} style={{ color: accent, cursor: "pointer", textDecoration: "underline" }}>{mdLink[1]}</span>;
    if (/^https?:\/\//.test(part)) return <span key={i} onClick={() => openUrl(part).catch(console.error)} style={{ color: accent, cursor: "pointer", textDecoration: "underline" }}>{part}</span>;
    return part;
  });
}

interface Message { role: "ai" | "user"; text: string; image?: string; timestamp: Date; }
type Theme = "dark" | "light" | "midnight" | "forest";

const THEMES = {
  dark:     { bg: "#0f172a", surface: "#1e293b", border: "#334155", text: "#f1f5f9", subtext: "#94a3b8", input: "#0f172a", userBubble: "#2563eb", aiBubble: "#1e293b", accent: "#3b82f6", header: "#1e293b" },
  light:    { bg: "#f8fafc", surface: "#ffffff", border: "#e2e8f0", text: "#0f172a", subtext: "#64748b", input: "#f1f5f9", userBubble: "#2563eb", aiBubble: "#f1f5f9", accent: "#2563eb", header: "#ffffff" },
  midnight: { bg: "#0a0a14", surface: "#12121f", border: "#2a2a3d", text: "#e2e0ff", subtext: "#7c7a9e", input: "#0a0a14", userBubble: "#6d28d9", aiBubble: "#12121f", accent: "#8b5cf6", header: "#12121f" },
  forest:   { bg: "#0d1f13", surface: "#132a1a", border: "#1e4028", text: "#d1fae5", subtext: "#6ee7b7", input: "#0d1f13", userBubble: "#065f46", aiBubble: "#132a1a", accent: "#10b981", header: "#132a1a" },
} satisfies Record<Theme, Record<string, string>>;

const DEFAULT_PASS_KEY = "Ctrl+Shift+F";
const DEFAULT_VIS_KEY  = "Ctrl+Shift+O";

function Dots({ accent }: { accent: string }) {
  return <div style={{ display: "flex", gap: 4, padding: "10px 14px", alignItems: "center" }}>
    {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: accent, animation: `bounce 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
  </div>;
}

function Gear({ size=12, color="currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>;
}

function Toggle({ on, onToggle, accent, surface, border, subtext }: { on: boolean; onToggle: () => void; accent: string; surface: string; border: string; subtext: string }) {
  return <button onClick={onToggle} style={{ background: on ? accent : surface, border: `1px solid ${on ? accent : border}`, borderRadius: 12, width: 40, height: 22, cursor: "pointer", position: "relative", transition: "background 0.2s, border-color 0.2s", flexShrink: 0 }}>
    <div style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: "50%", background: on ? "white" : subtext, transition: "left 0.2s" }} />
  </button>;
}

export default function App() {
  const [screen, setScreen]           = useState<"setup"|"main">("setup");
  const [showGuide, setShowGuide]     = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardStep, setOnboardStep] = useState(0);

  const [apiKey, setApiKey]           = useState("");
  const [apiInput, setApiInput]       = useState("");
  const [apiError, setApiError]       = useState("");
  const [apiValidating, setApiValidating] = useState(false);

  const [messages, setMessages]       = useState<Message[]>([
    { role: "ai", text: "Hey! I'm **Phantom AI**. Ask me anything while you work.", timestamp: new Date() }
  ]);
  const [input, setInput]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);

  const [theme, setTheme]             = useState<Theme>("dark");
  const [fontSize, setFontSize]       = useState(12);
  const [opacity, setOpacity]         = useState(0.95);
  const [ghost, setGhost]             = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [userScrolled, setUserScrolled] = useState(false);
  const [statusMsg, setStatusMsg]     = useState<string | null>(null);

  const [passKey, setPassKey]         = useState(DEFAULT_PASS_KEY);
  const [visKey, setVisKey]           = useState(DEFAULT_VIS_KEY);
  const [passKeyInput, setPassKeyInput] = useState("");
  const [visKeyInput, setVisKeyInput]   = useState("");

  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const ghostRef    = useRef(false);
  const visibleRef  = useRef(true);
  const lastKeyRef  = useRef(0);
  const lastVisKeyRef = useRef(0);
  const passKeyRef  = useRef(DEFAULT_PASS_KEY);
  const visKeyRef   = useRef(DEFAULT_VIS_KEY);
  const storeRef    = useRef<Store | null>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const scrollRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const fileRef     = useRef<HTMLInputElement>(null);
  const appWindow   = getCurrentWindow() as Window;

  const t = THEMES[theme];

  const flash = (msg: string, ms = 3000) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), ms);
  };

  // ── Load settings ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const store = await Store.load("phantom-settings.json");
        storeRef.current = store;
        const ak  = await store.get<string>("apiKey");
        const th  = await store.get<Theme>("theme");
        const fs  = await store.get<number>("fontSize");
        const op  = await store.get<number>("opacity");
        const pk  = await store.get<string>("passKey");
        const vk  = await store.get<string>("visKey");
        const ob  = await store.get<boolean>("onboarded");
        if (th) setTheme(th);
        if (fs) setFontSize(fs);
        if (op && op >= 0.15) setOpacity(op);
        if (pk) { setPassKey(pk); passKeyRef.current = pk; }
        if (vk) { setVisKey(vk); visKeyRef.current = vk; }
        if (ak) { setApiKey(ak); setScreen("main"); if (!ob) setShowOnboarding(true); }
      } catch(e) { console.error(e); }
      setSettingsLoaded(true);
    })();
  }, []);

  // ── Save settings ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settingsLoaded || !storeRef.current) return;
    (async () => {
      try {
        const s = storeRef.current!;
        await s.set("theme", theme);
        await s.set("fontSize", fontSize);
        await s.set("opacity", opacity);
        await s.set("passKey", passKey);
        await s.set("visKey", visKey);
        if (apiKey) await s.set("apiKey", apiKey);
        await s.save();
      } catch(e) { console.error(e); }
    })();
  }, [theme, fontSize, opacity, passKey, visKey, apiKey, settingsLoaded]);

  // ── Init window + hotkeys ──────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      await new Promise(r => setTimeout(r, 150));
      try { await appWindow.show(); await appWindow.setAlwaysOnTop(true); } catch(e) {}
    })();

    // paste image
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile(); if (!file) return;
          const r = new FileReader(); r.onload = () => setPendingImage(r.result as string); r.readAsDataURL(file);
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);

    // ghost hotkey
    register(passKeyRef.current, async () => {
      const now = Date.now(); if (now - lastKeyRef.current < 600) return; lastKeyRef.current = now;
      const next = !ghostRef.current; ghostRef.current = next; setGhost(next);
      try { await getCurrentWindow().setIgnoreCursorEvents(next); } catch(e) { console.error("ghost hotkey error:", e); }
    }).catch(e => console.error("ghost register error:", e));

    // visibility hotkey
    register(visKeyRef.current, async () => {
      const now = Date.now(); if (now - lastVisKeyRef.current < 600) return; lastVisKeyRef.current = now;
      const next = !visibleRef.current; visibleRef.current = next;
      try {
        const win = getCurrentWindow();
        if (next) await win.show(); else await win.hide();
      } catch(e) { console.error("vis hotkey error:", e); }
    }).catch(e => console.error("vis register error:", e));

    const onOffline = () => flash("No internet connection.", 5000);
    const onOnline  = () => flash("Back online.", 2000);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online",  onOnline);

    return () => {
      unregister(passKeyRef.current).catch(console.error);
      unregister(visKeyRef.current).catch(console.error);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online",  onOnline);
    };
  }, []);

  // ── Smart scroll ───────────────────────────────────────────────────────────
  const onScroll = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    setUserScrolled(el.scrollHeight - el.scrollTop - el.clientHeight > 60);
  }, []);

  useEffect(() => {
    if (!userScrolled) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, userScrolled]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const toggleGhost = async () => {
    const next = !ghostRef.current; ghostRef.current = next; setGhost(next);
    await appWindow.setIgnoreCursorEvents(next).catch(console.error);
  };

  const toggleTop = async () => {
    const next = !alwaysOnTop; setAlwaysOnTop(next);
    await appWindow.setAlwaysOnTop(next).catch(console.error);
  };

  const panicReset = async () => {
    setOpacity(0.95);
    try {
      const win = getCurrentWindow();
      // Tauri 2 uses innerSize - set via the window's setSize with a PhysicalSize or just resize
      await (win as any).setSize({ type: "Logical", width: 420, height: 600 });
      await win.center();
      await win.show();
    } catch(e) { console.error("Reset error:", e); }
    flash("Window reset.");
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => setPendingImage(r.result as string); r.readAsDataURL(file);
    e.target.value = "";
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!e.clipboardData) return;
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile(); if (!file) return;
        const r = new FileReader(); r.onload = () => setPendingImage(r.result as string); r.readAsDataURL(file);
        return;
      }
    }
  }, []);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && !pendingImage) || loading) return;
    const text = input.trim() || "What is in this image?";
    const img  = pendingImage;
    setMessages(prev => [...prev, { role: "user", text, image: img ?? undefined, timestamp: new Date() }]);
    setInput(""); setPendingImage(null); setLoading(true); setUserScrolled(false);
    if (inputRef.current) inputRef.current.style.height = "auto";
    setMessages(prev => [...prev, { role: "ai", text: "", timestamp: new Date() }]);

    const raw = messages.slice(-20).map(m => ({ role: (m.role === "ai" ? "model" : "user") as "user"|"model", parts: [{ text: m.text }] }));
    const fi  = raw.findIndex(m => m.role === "user");
    const history = fi > 0 ? raw.slice(fi) : raw;

    try {
      await askGemini(apiKey, text, history, img, chunk => {
        setMessages(prev => { const u = [...prev]; u[u.length-1] = { ...u[u.length-1], text: u[u.length-1].text + chunk }; return u; });
      });
    } catch(e) {
      const msg = e instanceof Error ? e.message : String(e);
      let friendly = "Error: " + msg;
      if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) friendly = "Rate limited. Wait a moment and try again.";
      else if (msg.includes("API_KEY_INVALID") || msg.includes("expired") || msg.includes("API_KEY")) friendly = "API key invalid or expired. Go to Settings and tap CHANGE.";
      setMessages(prev => { const u = [...prev]; u[u.length-1] = { ...u[u.length-1], text: friendly }; return u; });
    } finally {
      setLoading(false); inputRef.current?.focus();
    }
  }, [input, pendingImage, loading, messages, apiKey]);

  const saveApiKey = async () => {
    const key = apiInput.trim();
    if (!key.startsWith("AIza")) { setApiError("Key should start with AIza"); return; }
    setApiValidating(true); setApiError("");
    try {
      // Check onboarded BEFORE any saves
      const alreadyOnboarded = storeRef.current ? await storeRef.current.get<boolean>("onboarded") : false;
      await validateGeminiKey(key);
      setApiKey(key); setApiInput("");
      if (storeRef.current) {
        await storeRef.current.set("apiKey", key);
        await storeRef.current.save();
      }
      if (!alreadyOnboarded) setShowOnboarding(true);
      setScreen("main");
    } catch(e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
        // Rate limited but key is valid - let them in
        const alreadyOnboarded = storeRef.current ? await storeRef.current.get<boolean>("onboarded") : false;
        setApiKey(key); setApiInput("");
        if (storeRef.current) { await storeRef.current.set("apiKey", key); await storeRef.current.save(); }
        if (!alreadyOnboarded) setShowOnboarding(true);
        setScreen("main");
      } else {
        setApiError("Validation failed. Check your key and try again.");
      }
    } finally { setApiValidating(false); }
  };

  const saveHotkeys = async () => {
    const pk = passKeyInput.trim().slice(-1).toUpperCase() || passKey.split("+").pop()!;
    const vk = visKeyInput.trim().slice(-1).toUpperCase()  || visKey.split("+").pop()!;
    const np = "Ctrl+Shift+" + pk;
    const nv = "Ctrl+Shift+" + vk;
    try { await unregister(passKeyRef.current); } catch {}
    try { await unregister(visKeyRef.current); } catch {}
    try { await register(np, async () => {
      const now = Date.now(); if (now - lastKeyRef.current < 600) return; lastKeyRef.current = now;
      const next = !ghostRef.current; ghostRef.current = next; setGhost(next);
      await getCurrentWindow().setIgnoreCursorEvents(next).catch(console.error);
    }); } catch {}
    try { await register(nv, async () => {
      const now = Date.now(); if (now - lastVisKeyRef.current < 600) return; lastVisKeyRef.current = now;
      const next = !visibleRef.current; visibleRef.current = next;
      const win = getCurrentWindow();
      if (next) await win.show(); else await win.hide();
    }); } catch {}
    passKeyRef.current = np; visKeyRef.current = nv;
    setPassKey(np); setVisKey(nv);
    setPassKeyInput(""); setVisKeyInput(""); setShowShortcuts(false);
    flash("Hotkeys saved.");
  };

  const clearChat = () => setMessages([{ role: "ai", text: "Chat cleared. What can I help you with?", timestamp: new Date() }]);
  const handleExit = async () => {
    await unregister(passKeyRef.current).catch(console.error);
    await unregister(visKeyRef.current).catch(console.error);
    await exit(0).catch(console.error);
  };

  const onboardSlides = [
    { emoji: "👻", title: "Welcome to Phantom AI", desc: "An always-on-top AI overlay. Chat with Gemini without ever leaving your current app." },
    { emoji: "🔒", title: "Ghost Mode", desc: `Press ${passKey} to enable Ghost Mode. Clicks pass straight through to whatever is behind it.` },
    { emoji: "👁️", title: "Show / Hide", desc: `Press ${visKey} to instantly hide or show the overlay. Works even in fullscreen games.` },
    { emoji: "⚙️", title: "Settings", desc: "Click the gear icon to change theme, opacity, font size, and hotkeys. Re-run this tutorial anytime from Settings." },
  ];

  const btnBase: React.CSSProperties = { height: 24, minWidth: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, cursor: "pointer", fontSize: 11, lineHeight: 1, transition: "all 0.15s", padding: "0 8px" };

  // ── Render ─────────────────────────────────────────────────────────────────
  return <>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@300;400;500;600&display=swap');
      *{box-sizing:border-box;margin:0;padding:0}
      html,body,#root{height:100%;background:transparent}
      @keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}
      @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      @keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
      @keyframes pop{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}
      .msg{animation:fadeIn 0.2s ease-out}
      ::-webkit-scrollbar{width:3px}
      ::-webkit-scrollbar-track{background:transparent}
      ::-webkit-scrollbar-thumb{background:${t.border};border-radius:10px}
      input:focus,textarea:focus{outline:none}
      textarea{resize:none;font-family:'Inter',sans-serif}
      .hbtn:hover{filter:brightness(1.3)}
      .exit-btn:hover{background:#ef444422!important;border-color:#ef4444!important;color:#ef4444!important}
      .send-btn:hover{transform:scale(1.05)}
      .send-btn:active{transform:scale(0.95)}
    `}</style>

    <div style={{ width: "100vw", height: "100vh", background: "transparent", fontFamily: "'Inter',sans-serif" }}>

      {/* ── SETUP SCREEN ── */}
      {screen === "setup" && settingsLoaded && (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: t.bg, borderRadius: 14, border: `1px solid ${t.border}`, boxShadow: "0 25px 60px rgba(0,0,0,0.6)", padding: 24, gap: 16, overflow: "hidden" }}>
          {/* drag header */}
          <div onMouseDown={() => appWindow.startDragging().catch(console.error)} style={{ cursor: "grab", userSelect: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {showGuide && <button onClick={() => setShowGuide(false)} onMouseDown={e => e.stopPropagation()} style={{ background: "transparent", border: "none", color: t.subtext, cursor: "pointer", fontSize: 16 }}>←</button>}
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: t.accent, boxShadow: `0 0 6px ${t.accent}` }} />
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: t.text, letterSpacing: "0.08em" }}>{showGuide ? "HOW TO GET A KEY" : "PHANTOM AI"}</span>
            </div>
            <button className="hbtn exit-btn" onClick={handleExit} onMouseDown={e => e.stopPropagation()} style={{ ...btnBase, background: "transparent", border: `1px solid ${t.border}`, color: t.subtext }}>✕</button>
          </div>

          {showGuide ? (
            /* GUIDE */
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 11, color: t.subtext, fontFamily: "'JetBrains Mono',monospace" }}>GOOGLE GEMINI API KEY GUIDE</div>
              {[
                { n: "1", title: "Go to Google AI Studio", desc: "Sign in with your Google account.", url: "https://aistudio.google.com" },
                { n: "2", title: "Open API Keys", desc: 'Click "Get API key" in the sidebar.', url: "https://aistudio.google.com/apikey" },
                { n: "3", title: "Create a new key", desc: 'Click "Create API key in new project".', url: null },
                { n: "4", title: "Copy the key", desc: 'It starts with "AIza" and is ~39 characters.', url: null },
                { n: "5", title: "Paste it here", desc: "Saved only on this device, never shared.", url: null },
              ].map(item => (
                <div key={item.n} style={{ display: "flex", gap: 12 }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: `linear-gradient(135deg,${t.accent},#4285f4)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "white", flexShrink: 0 }}>{item.n}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 3 }}>{item.title}</div>
                    <div style={{ fontSize: 11, color: t.subtext, lineHeight: 1.6 }}>{item.desc}</div>
                    {item.url && <button onClick={() => openUrl(item.url!).catch(console.error)} style={{ background: "transparent", border: "none", padding: 0, fontSize: 11, color: t.accent, cursor: "pointer", textDecoration: "underline", textAlign: "left" }}>{item.url}</button>}
                  </div>
                </div>
              ))}
              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: t.accent, fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>NOTE</div>
                <div style={{ fontSize: 11, color: t.subtext, lineHeight: 1.6 }}>
                  Gemini API is free with limits. Quota errors may need billing enabled at{" "}
                  <button onClick={() => openUrl("https://console.cloud.google.com").catch(console.error)} style={{ background: "transparent", border: "none", padding: 0, fontSize: 11, color: t.accent, cursor: "pointer", textDecoration: "underline" }}>console.cloud.google.com</button>
                  . No charges on the free tier.
                </div>
              </div>
              <button onClick={() => setShowGuide(false)} style={{ background: `linear-gradient(135deg,${t.accent},#4285f4)`, border: "none", borderRadius: 10, padding: 10, color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}>
                BACK TO SETUP
              </button>
            </div>
          ) : (
            /* KEY ENTRY */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 6 }}>Enter your Gemini API Key</div>
                <div style={{ fontSize: 11, color: t.subtext, lineHeight: 1.6 }}>Stored only on this device. Never shared.</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input value={apiInput} onChange={e => { setApiInput(e.target.value); setApiError(""); }} onKeyDown={e => e.key === "Enter" && saveApiKey()} placeholder="AIza..." type="password"
                  style={{ background: t.input, border: `1px solid ${apiError ? "#ef4444" : t.border}`, borderRadius: 10, padding: "10px 12px", color: t.text, fontSize: 12, fontFamily: "'JetBrains Mono',monospace", width: "100%" }}
                  onFocus={e => e.currentTarget.style.borderColor = t.accent} onBlur={e => e.currentTarget.style.borderColor = apiError ? "#ef4444" : t.border} />
                {apiError && <span style={{ fontSize: 10, color: "#ef4444" }}>{apiError}</span>}
                <button onClick={saveApiKey} disabled={apiValidating}
                  style={{ background: `linear-gradient(135deg,${t.accent},#4285f4)`, border: "none", borderRadius: 10, padding: 10, color: "white", fontSize: 12, fontWeight: 600, cursor: apiValidating ? "not-allowed" : "pointer", fontFamily: "'JetBrains Mono',monospace", opacity: apiValidating ? 0.7 : 1 }}>
                  {apiValidating ? "VALIDATING..." : "SAVE & CONTINUE"}
                </button>
                <button onClick={() => setShowGuide(true)} style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 10, padding: 10, color: t.subtext, fontSize: 11, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}>
                  HOW TO GET A KEY
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MAIN APP ── */}
      {screen === "main" && (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: t.bg, borderRadius: 14, border: `1px solid ${t.border}`, boxShadow: "0 25px 60px rgba(0,0,0,0.6)", overflow: "hidden", opacity, position: "relative" }}>

          {/* onboarding */}
          {showOnboarding && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 14 }}>
              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 24, width: "85%", display: "flex", flexDirection: "column", gap: 16, animation: "pop 0.2s ease-out" }}>
                <div style={{ fontSize: 28, textAlign: "center", lineHeight: 1 }}>{onboardSlides[onboardStep].emoji}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.text, textAlign: "center" }}>{onboardSlides[onboardStep].title}</div>
                <div style={{ fontSize: 11, color: t.subtext, lineHeight: 1.7, textAlign: "center" }}>{onboardSlides[onboardStep].desc}</div>
                <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                  {onboardSlides.map((_, i) => <div key={i} style={{ width: i === onboardStep ? 16 : 6, height: 6, borderRadius: 3, background: i === onboardStep ? t.accent : t.border, transition: "all 0.2s" }} />)}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {onboardStep > 0 && <button onClick={() => setOnboardStep(s => s - 1)} style={{ flex: 1, background: "transparent", border: `1px solid ${t.border}`, borderRadius: 10, padding: 8, color: t.subtext, fontSize: 11, cursor: "pointer" }}>Back</button>}
                  <button onClick={() => { if (onboardStep < onboardSlides.length - 1) setOnboardStep(s => s + 1); else { setShowOnboarding(false); if (storeRef.current) { storeRef.current.set("onboarded", true); storeRef.current.save(); } } }}
                    style={{ flex: 1, background: `linear-gradient(135deg,${t.accent},#4285f4)`, border: "none", borderRadius: 10, padding: 8, color: "white", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                    {onboardStep < onboardSlides.length - 1 ? "Next" : "Get Started"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* header */}
          <div onMouseDown={() => appWindow.startDragging().catch(console.error)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: t.header, borderBottom: `1px solid ${t.border}`, cursor: "grab", userSelect: "none", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: t.accent, boxShadow: `0 0 6px ${t.accent}` }} />
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: t.text, letterSpacing: "0.08em" }}>PHANTOM AI</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <button className="hbtn" onClick={toggleGhost} onMouseDown={e => e.stopPropagation()} title={`Ghost Mode (${passKey})`}
                style={{ ...btnBase, background: ghost ? `${t.accent}22` : "transparent", border: `1px solid ${ghost ? t.accent : t.border}`, color: ghost ? t.accent : t.subtext, fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>
                GHOST
              </button>
              <button className="hbtn" onClick={() => setShowSettings(s => !s)} onMouseDown={e => e.stopPropagation()}
                style={{ ...btnBase, background: showSettings ? `${t.accent}22` : "transparent", border: `1px solid ${showSettings ? t.accent : t.border}`, padding: "0 6px" }}>
                <Gear size={12} color={showSettings ? t.accent : t.subtext} />
              </button>
              <button className="hbtn" onClick={() => appWindow.minimize().catch(console.error)} onMouseDown={e => e.stopPropagation()}
                style={{ ...btnBase, background: "transparent", border: `1px solid ${t.border}`, color: t.subtext, fontSize: 18, paddingBottom: 0, paddingTop: 0 }}>−</button>
              <button className="hbtn exit-btn" onClick={handleExit} onMouseDown={e => e.stopPropagation()}
                style={{ ...btnBase, background: "transparent", border: `1px solid ${t.border}`, color: t.subtext }}>✕</button>
            </div>
          </div>

          {/* status */}
          {statusMsg && (
            <div style={{ padding: "4px 12px", background: t.surface, borderBottom: `1px solid ${t.border}`, fontSize: 10, color: t.subtext, fontFamily: "'JetBrains Mono',monospace", textAlign: "center", animation: "slideDown 0.15s ease-out", flexShrink: 0 }}>
              {statusMsg}
            </div>
          )}

          {/* settings */}
          {showSettings && (
            <div style={{ background: t.surface, borderBottom: `1px solid ${t.border}`, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, maxHeight: 360, overflowY: "auto", flexShrink: 0, animation: "slideDown 0.2s ease-out" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: t.subtext, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace" }}>SETTINGS</div>

              {/* opacity */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.text }}>Opacity</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="range" min={0.1} max={1} step={0.01} value={opacity} onChange={e => setOpacity(parseFloat(e.target.value))} style={{ width: 90, accentColor: t.accent }} />
                  <span style={{ fontSize: 10, color: t.subtext, fontFamily: "'JetBrains Mono',monospace", width: 34, textAlign: "right" }}>{Math.round(opacity * 100)}%</span>
                </div>
              </div>

              {/* font size */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.text }}>Font Size</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="range" min={10} max={16} step={1} value={fontSize} onChange={e => setFontSize(parseInt(e.target.value))} style={{ width: 90, accentColor: t.accent }} />
                  <span style={{ fontSize: 10, color: t.subtext, fontFamily: "'JetBrains Mono',monospace", width: 34, textAlign: "right" }}>{fontSize}px</span>
                </div>
              </div>

              {/* theme */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.text }}>Theme</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {(Object.keys(THEMES) as Theme[]).map(th => (
                    <button key={th} onClick={() => setTheme(th)} title={th}
                      style={{ background: THEMES[th].bg, border: `2px solid ${theme === th ? t.accent : THEMES[th].border}`, borderRadius: 6, width: 28, height: 20, cursor: "pointer", fontSize: 8, color: THEMES[th].text, fontWeight: 600 }}>
                      {th[0].toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* always on top */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.text }}>Always on Top</span>
                <Toggle on={alwaysOnTop} onToggle={toggleTop} accent={t.accent} surface={t.surface} border={t.border} subtext={t.subtext} />
              </div>

              {/* ghost mode */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.text }}>Ghost Mode <span style={{ fontSize: 10, color: t.subtext }}>({passKey})</span></span>
                <Toggle on={ghost} onToggle={toggleGhost} accent={t.accent} surface={t.surface} border={t.border} subtext={t.subtext} />
              </div>

              {/* shortcuts */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.text }}>Custom Shortcuts</span>
                <button onClick={() => setShowShortcuts(s => !s)} style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, padding: "3px 10px", color: t.subtext, fontSize: 10, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}>
                  {showShortcuts ? "CLOSE" : "EDIT"}
                </button>
              </div>
              {showShortcuts && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, background: t.bg, borderRadius: 8, padding: "10px 12px", border: `1px solid ${t.border}` }}>
                  <div style={{ fontSize: 10, color: t.subtext }}>Always Ctrl+Shift + your key. Type any single key below.</div>
                  {[
                    { label: "Ghost Mode", current: passKey.split("+").pop()!, val: passKeyInput, set: setPassKeyInput },
                    { label: "Show / Hide", current: visKey.split("+").pop()!, val: visKeyInput, set: setVisKeyInput },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 10, color: t.subtext }}>
                        {row.label}:{" "}
                        <span style={{ color: t.text, fontFamily: "'JetBrains Mono',monospace" }}>
                          Ctrl+Shift+{row.val ? row.val.slice(-1).toUpperCase() : row.current}
                        </span>
                      </span>
                      <input value={row.val} onChange={e => row.set(e.target.value.slice(-1))} placeholder={row.current}
                        style={{ background: t.input, border: `1px solid ${t.border}`, borderRadius: 6, padding: "4px 6px", color: t.text, fontSize: 13, fontFamily: "'JetBrains Mono',monospace", width: 36, textAlign: "center" }} />
                    </div>
                  ))}
                  <button onClick={saveHotkeys} style={{ background: `linear-gradient(135deg,${t.accent},#4285f4)`, border: "none", borderRadius: 6, padding: 6, color: "white", fontSize: 10, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}>SAVE</button>
                </div>
              )}

              {/* clear chat */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.text }}>Clear Chat</span>
                <button onClick={clearChat} style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, padding: "3px 10px", color: t.subtext, fontSize: 10, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}>CLEAR</button>
              </div>

              {/* reset window */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.text }}>Reset Window</span>
                <button onClick={panicReset} style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, padding: "3px 10px", color: t.subtext, fontSize: 10, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}>RESET</button>
              </div>

              {/* api key */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.text }}>API Key</span>
                <button onClick={async () => {
                  setApiKey(""); setApiInput(""); setScreen("setup");
                  if (storeRef.current) { await storeRef.current.delete("apiKey").catch(()=>{}); await storeRef.current.save().catch(()=>{}); }
                }} style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, padding: "3px 10px", color: t.subtext, fontSize: 10, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}>CHANGE</button>
              </div>

              {/* tutorial */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.text }}>Tutorial</span>
                <button onClick={() => { setOnboardStep(0); setShowOnboarding(true); setShowSettings(false); }} style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, padding: "3px 10px", color: t.subtext, fontSize: 10, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}>SHOW</button>
              </div>

              <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 10 }}>
                <span style={{ fontSize: 9, color: t.subtext, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.05em" }}>POWERED BY GOOGLE GEMINI</span>
              </div>
            </div>
          )}

          {/* messages */}
          <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, overflowY: "auto", padding: "16px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.map((msg, i) => (
              <div key={i} className="msg" style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                {msg.role === "ai" && (
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: `linear-gradient(135deg,${t.accent},#4285f4)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: "white", marginRight: 8, flexShrink: 0, marginTop: 2, letterSpacing: "0.05em" }}>PH</div>
                )}
                <div style={{ maxWidth: "78%", padding: loading && i === messages.length - 1 && msg.role === "ai" && msg.text === "" ? 0 : "9px 12px", borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: msg.role === "user" ? `linear-gradient(135deg,${t.userBubble},${t.accent})` : t.aiBubble, color: msg.role === "user" ? "white" : t.text, fontSize, lineHeight: 1.55, border: msg.role === "ai" ? `1px solid ${t.border}` : "none", wordBreak: "break-word" }}>
                  {msg.image && <img src={msg.image} alt="" style={{ maxWidth: "100%", borderRadius: 8, marginBottom: msg.text ? 6 : 0, display: "block" }} />}
                  {loading && i === messages.length - 1 && msg.role === "ai" && msg.text === "" ? <Dots accent={t.accent} /> :
                    msg.role === "ai" ? renderMarkdown(msg.text, t.text, fontSize, t.accent) : <span style={{ whiteSpace: "pre-wrap" }}>{msg.text}</span>}
                  {loading && i === messages.length - 1 && msg.role === "ai" && msg.text !== "" && <span style={{ opacity: 0.5 }}>▋</span>}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* scroll to bottom */}
          {userScrolled && (
            <button onClick={() => { setUserScrolled(false); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }}
              style={{ position: "absolute", bottom: 80, right: 16, background: t.accent, border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.4)", zIndex: 10 }}>↓</button>
          )}

          {/* pending image */}
          {pendingImage && (
            <div style={{ padding: "6px 12px", background: t.surface, borderTop: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <img src={pendingImage} alt="" style={{ height: 48, borderRadius: 6, border: `1px solid ${t.border}` }} />
              <button onClick={() => setPendingImage(null)} style={{ background: "#ef444422", border: "1px solid #ef4444", borderRadius: 6, color: "#ef4444", fontSize: 10, padding: "2px 6px", cursor: "pointer" }}>Remove</button>
            </div>
          )}

          {/* input */}
          <div style={{ padding: "10px 12px", background: t.surface, borderTop: `1px solid ${t.border}`, display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0 }}>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
            <button onClick={() => fileRef.current?.click()} style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: pendingImage ? t.accent : t.subtext, marginBottom: 2 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
            </button>
            <textarea ref={inputRef} value={input}
              onChange={e => {
                setInput(e.target.value);
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, (fontSize - 1) * 1.5 * 3 + 16) + "px";
              }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              onPaste={handlePaste} disabled={loading} rows={1}
              placeholder={loading ? "Thinking..." : pendingImage ? "Describe the image..." : "Ask Phantom AI..."}
              style={{ flex: 1, background: t.input, border: `1px solid ${t.border}`, borderRadius: 10, padding: "8px 12px", color: t.text, fontSize: fontSize - 1, lineHeight: 1.5, transition: "border-color 0.15s", overflowY: "hidden" }}
              onFocus={e => e.currentTarget.style.borderColor = t.accent}
              onBlur={e => e.currentTarget.style.borderColor = t.border}
            />
            <button className="send-btn" onClick={handleSend} disabled={loading || (!input.trim() && !pendingImage)}
              style={{ background: `linear-gradient(135deg,${t.accent},#4285f4)`, border: "none", borderRadius: 10, width: 36, height: 36, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: loading || (!input.trim() && !pendingImage) ? 0.4 : 1, transition: "opacity 0.15s,transform 0.1s", flexShrink: 0, marginBottom: 2 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>

        </div>
      )}
    </div>
  </>;
}
