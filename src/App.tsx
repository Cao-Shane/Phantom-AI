import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { exit } from "@tauri-apps/plugin-process";
import { Store } from "@tauri-apps/plugin-store";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Gemini client ─────────────────────────────────────────────────────────────
interface HistoryMessage { role: "user" | "model"; parts: { text: string }[]; }

async function askGemini(
  apiKey: string,
  prompt: string,
  history: HistoryMessage[],
  imageDataUrl: string | null,
  onChunk: (chunk: string) => void
): Promise<void> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const chat = model.startChat({ history: history.slice(0, -1) });
  const parts: (string | { text: string } | { inlineData: { mimeType: string; data: string } })[] = [];
  if (imageDataUrl) {
    const [header, base64] = imageDataUrl.split(",");
    const mimeType = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
    parts.push({ inlineData: { mimeType, data: base64 } });
  }
  parts.push({ text: prompt });
  const result = await chat.sendMessageStream(parts);
  for await (const chunk of result.stream) onChunk(chunk.text());
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
function renderMarkdown(text: string, color: string, fontSize: number): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      nodes.push(
        <div key={i} style={{ margin: "6px 0" }}>
          {lang && <div style={{ fontSize: fontSize - 3, color: "#94a3b8", marginBottom: 2, fontFamily: "monospace" }}>{lang}</div>}
          <pre style={{ background: "rgba(0,0,0,0.35)", borderRadius: 6, padding: "8px 10px", fontSize: fontSize - 2, fontFamily: "'JetBrains Mono', monospace", overflowX: "auto", margin: 0, color: "#e2e8f0", lineHeight: 1.5, border: "1px solid rgba(255,255,255,0.08)" }}>{codeLines.join("\n")}</pre>
        </div>
      );
      i++; continue;
    }
    if (line.startsWith("### ")) nodes.push(<div key={i} style={{ fontWeight: 700, fontSize: fontSize + 1, margin: "6px 0 2px", color }}>{inlineFormat(line.slice(4), fontSize)}</div>);
    else if (line.startsWith("## ")) nodes.push(<div key={i} style={{ fontWeight: 700, fontSize: fontSize + 2, margin: "6px 0 2px", color }}>{inlineFormat(line.slice(3), fontSize)}</div>);
    else if (line.startsWith("# ")) nodes.push(<div key={i} style={{ fontWeight: 700, fontSize: fontSize + 3, margin: "6px 0 2px", color }}>{inlineFormat(line.slice(2), fontSize)}</div>);
    else if (line.match(/^[-*] /)) nodes.push(<div key={i} style={{ display: "flex", gap: 6, margin: "1px 0" }}><span style={{ color: "#94a3b8", flexShrink: 0 }}>•</span><span>{inlineFormat(line.slice(2), fontSize)}</span></div>);
    else if (line.match(/^\d+\. /)) { const num = line.match(/^(\d+)\. /)?.[1]; nodes.push(<div key={i} style={{ display: "flex", gap: 6, margin: "1px 0" }}><span style={{ color: "#94a3b8", flexShrink: 0, minWidth: 14 }}>{num}.</span><span>{inlineFormat(line.replace(/^\d+\. /, ""), fontSize)}</span></div>); }
    else if (line.match(/^---+$/)) nodes.push(<hr key={i} style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.1)", margin: "6px 0" }} />);
    else if (line.trim() === "") nodes.push(<div key={i} style={{ height: 4 }} />);
    else nodes.push(<div key={i} style={{ margin: "1px 0", lineHeight: 1.55 }}>{inlineFormat(line, fontSize)}</div>);
    i++;
  }
  return <>{nodes}</>;
}

function inlineFormat(text: string, fontSize: number): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("__") && part.endsWith("__")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 3, padding: "1px 4px", fontSize: fontSize - 1, fontFamily: "'JetBrains Mono', monospace" }}>{part.slice(1, -1)}</code>;
    return part;
  });
}

// ── Types & constants ─────────────────────────────────────────────────────────
interface Message { role: "ai" | "user"; text: string; image?: string; timestamp: Date; }
type Theme = "dark" | "light" | "midnight" | "forest";

const THEMES: Record<Theme, { bg: string; surface: string; border: string; text: string; subtext: string; input: string; userBubble: string; aiBubble: string; accent: string; header: string; }> = {
  dark:     { bg: "#0f172a", surface: "#1e293b", border: "#334155", text: "#f1f5f9", subtext: "#94a3b8", input: "#0f172a", userBubble: "#2563eb", aiBubble: "#1e293b", accent: "#3b82f6", header: "#1e293b" },
  light:    { bg: "#f8fafc", surface: "#ffffff", border: "#e2e8f0", text: "#0f172a", subtext: "#64748b", input: "#f1f5f9", userBubble: "#2563eb", aiBubble: "#f1f5f9", accent: "#2563eb", header: "#ffffff" },
  midnight: { bg: "#0a0a14", surface: "#12121f", border: "#2a2a3d", text: "#e2e0ff", subtext: "#7c7a9e", input: "#0a0a14", userBubble: "#6d28d9", aiBubble: "#12121f", accent: "#8b5cf6", header: "#12121f" },
  forest:   { bg: "#0d1f13", surface: "#132a1a", border: "#1e4028", text: "#d1fae5", subtext: "#6ee7b7", input: "#0d1f13", userBubble: "#065f46", aiBubble: "#132a1a", accent: "#10b981", header: "#132a1a" },
};

const HOTKEY = "CommandOrControl+Shift+Space";

const hBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  height: 24, minWidth: 24, display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: 6, cursor: "pointer", fontSize: 11, lineHeight: 1,
  transition: "all 0.15s", padding: "0 8px", ...extra,
});

function TypingIndicator({ accent }: { accent: string }) {
  return (
    <div style={{ display: "flex", gap: 4, padding: "10px 14px", alignItems: "center" }}>
      {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: accent, animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
    </div>
  );
}

function GearIcon({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [opacity, setOpacityState] = useState(0.95);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { role: "ai", text: "Hey! I'm **Phantom AI**. Ask me anything while you work or watch.", timestamp: new Date() }
  ]);
  const [loading, setLoading] = useState(false);
  const [clickThrough, setClickThrough] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [showSettings, setShowSettings] = useState(false);
  const [fontSize, setFontSize] = useState(12);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [apiKey, setApiKey] = useState<string>("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyError, setApiKeyError] = useState("");
  const [showGuide, setShowGuide] = useState(false);

  const clickThroughRef = useRef(false);
  const alwaysOnTopRef = useRef(true);
  const lastHotkeyRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const storeRef = useRef<Store | null>(null);
  const appWindow = getCurrentWindow() as Window;

  const t = THEMES[theme];

  // ── Load persisted settings ──
  useEffect(() => {
    const load = async () => {
      try {
        const store = await Store.load("phantom-settings.json");
        storeRef.current = store;
        const th = await store.get<Theme>("theme");
        const fs = await store.get<number>("fontSize");
        const op = await store.get<number>("opacity");
        const ak = await store.get<string>("apiKey");
        if (th) setTheme(th);
        if (fs) setFontSize(fs);
        if (op) { setOpacityState(op); (appWindow as any).setOpacity(op).catch(console.error); }
        if (ak) setApiKey(ak);
      } catch (e) { console.error("Settings load failed", e); }
      setSettingsLoaded(true);
    };
    load();
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !storeRef.current) return;
    const save = async () => {
      try {
        await storeRef.current!.set("theme", theme);
        await storeRef.current!.set("fontSize", fontSize);
        await storeRef.current!.set("opacity", opacity);
        await storeRef.current!.set("apiKey", apiKey);
        await storeRef.current!.save();
      } catch (e) { console.error("Settings save failed", e); }
    };
    save();
  }, [theme, fontSize, opacity, apiKey, settingsLoaded]);

  // ── Init + hotkey ──
  useEffect(() => {
    const init = async () => {
      await new Promise(r => setTimeout(r, 150));
      try { await appWindow.show(); await appWindow.setAlwaysOnTop(true); }
      catch (e) { console.error("Init failed", e); }
    };
    init();

    const handleGlobalPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => setPendingImage(reader.result as string);
          reader.readAsDataURL(file);
          return;
        }
      }
    };
    window.addEventListener("paste", handleGlobalPaste);

    register(HOTKEY, async () => {
      const now = Date.now();
      if (now - lastHotkeyRef.current < 600) return;
      lastHotkeyRef.current = now;
      const next = !clickThroughRef.current;
      clickThroughRef.current = next;
      setClickThrough(next);
      try { await appWindow.setIgnoreCursorEvents(next); }
      catch (e) { console.error("Hotkey failed", e); }
    }).catch(console.error);

    return () => {
      unregister(HOTKEY).catch(console.error);
      window.removeEventListener("paste", handleGlobalPaste);
    };
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const toggleClickThrough = async () => {
    const next = !clickThroughRef.current;
    clickThroughRef.current = next;
    setClickThrough(next);
    await appWindow.setIgnoreCursorEvents(next).catch(console.error);
  };

  const toggleAlwaysOnTop = async () => {
    const next = !alwaysOnTopRef.current;
    alwaysOnTopRef.current = next;
    setAlwaysOnTop(next);
    await appWindow.setAlwaysOnTop(next).catch(console.error);
  };

  const updateOpacity = async (val: number) => {
    setOpacityState(val);
    await (appWindow as any).setOpacity(val).catch(console.error);
  };

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPendingImage(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setPendingImage(reader.result as string);
        reader.readAsDataURL(file);
        return;
      }
    }
  }, []);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && !pendingImage) || loading) return;
    const text = input.trim() || "What do you see in this image?";
    const imageToSend = pendingImage;

    setMessages(prev => [...prev, { role: "user", text, image: imageToSend ?? undefined, timestamp: new Date() }]);
    setInput("");
    setPendingImage(null);
    setLoading(true);
    setMessages(prev => [...prev, { role: "ai", text: "", timestamp: new Date() }]);

    // Build Gemini history from last 20 messages, must start with user role
    const rawHistory: HistoryMessage[] = messages.slice(-20).map(m => ({
      role: (m.role === "ai" ? "model" : "user") as "user" | "model",
      parts: [{ text: m.text }],
    }));
    const firstUser = rawHistory.findIndex(m => m.role === "user");
    const history: HistoryMessage[] = firstUser > 0 ? rawHistory.slice(firstUser) : rawHistory;

    try {
      await askGemini(apiKey, text, history, imageToSend, (chunk) => {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], text: updated[updated.length - 1].text + chunk };
          return updated;
        });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], text: `⚠️ Error: ${msg}` };
        return updated;
      });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, pendingImage, loading, messages, apiKey]);

  const saveApiKey = async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed.startsWith("AIza")) {
      setApiKeyError("Key should start with AIza");
      return;
    }
    setApiKey(trimmed);
    setApiKeyInput("");
    setApiKeyError("");
  };

  const clearChat = () => setMessages([{ role: "ai", text: "Chat cleared. What can I help you with?", timestamp: new Date() }]);
  const handleExit = async () => { await unregister(HOTKEY).catch(console.error); await exit(0).catch(console.error); };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; background: transparent; }
        @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        .msg { animation: fadeIn 0.2s ease-out; }
        .settings-panel { animation: slideDown 0.2s ease-out; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${t.border}; border-radius: 10px; }
        input:focus, select:focus { outline: none; }
        .hbtn:hover { filter: brightness(1.35); }
        .send-btn:hover { transform: scale(1.05); }
        .send-btn:active { transform: scale(0.95); }
        .exit-btn:hover { background: #ef444422 !important; border-color: #ef4444 !important; color: #ef4444 !important; }
        .img-btn:hover { background: ${t.accent}22 !important; border-color: ${t.accent} !important; }
      `}</style>

      <div style={{ width: "100vw", height: "100vh", background: "transparent", display: "flex", flexDirection: "column", fontFamily: "'Inter', sans-serif" }}>

        {/* ── API Key Setup Screen ── */}
        {!apiKey && settingsLoaded && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: t.bg, borderRadius: 14, border: `1px solid ${t.border}`, boxShadow: "0 25px 60px rgba(0,0,0,0.6)", overflow: "hidden", padding: 24, gap: 16 }}>
            {/* Header */}
            <div onMouseDown={() => appWindow.startDragging().catch(console.error)} style={{ cursor: "grab", userSelect: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {showGuide && (
                  <button onClick={() => setShowGuide(false)} onMouseDown={e => e.stopPropagation()}
                    style={{ background: "transparent", border: "none", color: t.subtext, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px 0 0" }}>←</button>
                )}
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: t.accent, boxShadow: `0 0 6px ${t.accent}` }} />
                <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: t.text, letterSpacing: "0.08em" }}>
                  {showGuide ? "HOW TO GET A KEY" : "PHANTOM AI"}
                </span>
              </div>
              <button className="hbtn exit-btn" onClick={handleExit} onMouseDown={e => e.stopPropagation()}
                style={hBtn({ background: "transparent", border: `1px solid ${t.border}`, color: t.subtext })}>✕</button>
            </div>

            {/* Guide Page */}
            {showGuide ? (
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontSize: 11, color: t.subtext, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em" }}>GOOGLE GEMINI API KEY GUIDE</div>
                {[
                  { step: "1", title: "Go to Google AI Studio", desc: "Open aistudio.google.com in your browser. Sign in with your Google account." },
                  { step: "2", title: "Open API Keys", desc: 'Click "Get API key" in the left sidebar, or go directly to aistudio.google.com/apikey.' },
                  { step: "3", title: "Create a new key", desc: 'Click "Create API key" → select "Create API key in new project". A new key will be generated.' },
                  { step: "4", title: "Copy the key", desc: 'Click the copy icon next to your new key. It starts with "AIza" and is about 39 characters long.' },
                  { step: "5", title: "Paste it here", desc: 'Go back and paste it into the API key field. Your key is saved only on this device.' },
                ].map(item => (
                  <div key={item.step} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", background: `linear-gradient(135deg, ${t.accent}, #4285f4)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "white", flexShrink: 0 }}>{item.step}</div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: t.text, marginBottom: 3 }}>{item.title}</div>
                      <div style={{ fontSize: 11, color: t.subtext, lineHeight: 1.6 }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
                <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 12px", marginTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: t.accent, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>NOTE</div>
                  <div style={{ fontSize: 11, color: t.subtext, lineHeight: 1.6 }}>Gemini API is free to use with limits. If you see a quota error, your account may need billing enabled at console.cloud.google.com No charges apply on the free tier.</div>
                </div>
                <button onClick={() => setShowGuide(false)}
                  style={{ background: `linear-gradient(135deg, ${t.accent}, #4285f4)`, border: "none", borderRadius: 10, padding: "10px", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em", marginTop: 4 }}>
                  ← BACK TO SETUP
                </button>
              </div>
            ) : (
              /* Setup Page */
              <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 6 }}>Enter your Gemini API Key</div>
                  <div style={{ fontSize: 11, color: t.subtext, lineHeight: 1.6 }}>
                    Your key is stored only on this device and never shared.
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    value={apiKeyInput}
                    onChange={e => { setApiKeyInput(e.target.value); setApiKeyError(""); }}
                    onKeyDown={e => e.key === "Enter" && saveApiKey()}
                    placeholder="AIza..."
                    type="password"
                    style={{ background: t.input, border: `1px solid ${apiKeyError ? "#ef4444" : t.border}`, borderRadius: 10, padding: "10px 12px", color: t.text, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", width: "100%" }}
                    onFocus={e => e.target.style.borderColor = t.accent}
                    onBlur={e => e.target.style.borderColor = apiKeyError ? "#ef4444" : t.border}
                  />
                  {apiKeyError && <span style={{ fontSize: 10, color: "#ef4444" }}>{apiKeyError}</span>}
                  <button onClick={saveApiKey}
                    style={{ background: `linear-gradient(135deg, ${t.accent}, #4285f4)`, border: "none", borderRadius: 10, padding: "10px", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em" }}>
                    SAVE & CONTINUE
                  </button>
                  <button onClick={() => setShowGuide(true)}
                    style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px", color: t.subtext, fontSize: 11, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em" }}>
                    HOW TO GET A KEY →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Main App ── */}
        {apiKey && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: t.bg, borderRadius: 14, border: `1px solid ${t.border}`, boxShadow: "0 25px 60px rgba(0,0,0,0.6)", overflow: "hidden", opacity }}>

          {/* ── Header ── */}
          <div onMouseDown={() => appWindow.startDragging().catch(console.error)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: t.header, borderBottom: `1px solid ${t.border}`, cursor: "grab", userSelect: "none" }}>

            {/* Phantom AI branding */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: t.accent, boxShadow: `0 0 6px ${t.accent}`, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: t.text, letterSpacing: "0.08em" }}>PHANTOM AI</span>
            </div>

            {/* Controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <button className="hbtn" onClick={toggleClickThrough} onMouseDown={e => e.stopPropagation()}
                title="Toggle click-through (Ctrl+Shift+Space)"
                style={hBtn({ background: clickThrough ? `${t.accent}22` : "transparent", border: `1px solid ${clickThrough ? t.accent : t.border}`, color: clickThrough ? t.accent : t.subtext, fontFamily: "'JetBrains Mono', monospace", fontSize: 10 })}>
                {clickThrough ? "PASS" : "LOCK"}
              </button>
              <button className="hbtn" onClick={() => setShowSettings(s => !s)} onMouseDown={e => e.stopPropagation()}
                title="Settings"
                style={hBtn({ background: showSettings ? `${t.accent}22` : "transparent", border: `1px solid ${showSettings ? t.accent : t.border}`, padding: "0 6px" })}>
                <GearIcon size={12} color={showSettings ? t.accent : t.subtext} />
              </button>
              <button className="hbtn" onClick={() => appWindow.minimize().catch(console.error)} onMouseDown={e => e.stopPropagation()}
                title="Minimize"
                style={hBtn({ background: "transparent", border: `1px solid ${t.border}`, color: t.subtext, fontSize: 18, lineHeight: 1, paddingBottom: 0, paddingTop: 0 })}>−</button>
              <button className="hbtn exit-btn" onClick={handleExit} onMouseDown={e => e.stopPropagation()}
                title="Close"
                style={hBtn({ background: "transparent", border: `1px solid ${t.border}`, color: t.subtext })}>✕</button>
            </div>
          </div>

          {/* ── Settings Panel ── */}
          {showSettings && (
            <div className="settings-panel" style={{ background: t.surface, borderBottom: `1px solid ${t.border}`, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: t.subtext, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono', monospace" }}>SETTINGS</div>

              {[
                { label: "Opacity", value: opacity, min: 0.1, max: 1, step: 0.01, display: `${Math.round(opacity * 100)}%`, onChange: (v: number) => updateOpacity(v) },
                { label: "Font Size", value: fontSize, min: 10, max: 16, step: 1, display: `${fontSize}px`, onChange: (v: number) => setFontSize(v) },
              ].map(row => (
                <div key={row.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: t.text }}>{row.label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="range" min={row.min} max={row.max} step={row.step} value={row.value}
                      onChange={e => row.onChange(parseFloat(e.target.value))}
                      style={{ width: 90, accentColor: t.accent }} />
                    <span style={{ fontSize: 10, color: t.subtext, fontFamily: "'JetBrains Mono', monospace", width: 34, textAlign: "right" }}>{row.display}</span>
                  </div>
                </div>
              ))}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.text }}>Theme</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {(Object.keys(THEMES) as Theme[]).map(th => (
                    <button key={th} onClick={() => setTheme(th)} style={{ background: THEMES[th].bg, border: `2px solid ${theme === th ? t.accent : THEMES[th].border}`, borderRadius: 6, width: 28, height: 20, cursor: "pointer", fontSize: 8, color: THEMES[th].text, fontWeight: 600 }} title={th}>{th[0].toUpperCase()}</button>
                  ))}
                </div>
              </div>

              {[
                { label: "Always on Top", value: alwaysOnTop, onToggle: toggleAlwaysOnTop },
                { label: <span>Click-Through <span style={{ color: t.subtext, fontSize: 10 }}>(Ctrl+Shift+Space)</span></span>, value: clickThrough, onToggle: toggleClickThrough },
              ].map((row, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: t.text }}>{row.label}</span>
                  <button onClick={row.onToggle} style={{ background: row.value ? t.accent : t.surface, border: `1px solid ${row.value ? t.accent : t.border}`, borderRadius: 12, width: 40, height: 22, cursor: "pointer", position: "relative", transition: "background 0.2s, border-color 0.2s", flexShrink: 0 }}>
                    <div style={{ position: "absolute", top: 3, left: row.value ? 21 : 3, width: 16, height: 16, borderRadius: "50%", background: row.value ? "white" : t.subtext, transition: "left 0.2s" }} />
                  </button>
                </div>
              ))}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.text }}>Clear Chat</span>
                <button onClick={clearChat} style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, padding: "3px 10px", color: t.subtext, fontSize: 10, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }}>CLEAR</button>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: t.text }}>API Key</span>
                <button onClick={() => { setApiKey(""); setApiKeyInput(""); }} style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, padding: "3px 10px", color: t.subtext, fontSize: 10, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }}>CHANGE</button>
              </div>

              {/* Powered by disclaimer */}
              <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 9, color: t.subtext, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em" }}>POWERED BY GOOGLE GEMINI</span>
              </div>
            </div>
          )}

          {/* ── Messages ── */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.map((msg, i) => (
              <div key={i} className="msg" style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                {msg.role === "ai" && (
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: `linear-gradient(135deg, ${t.accent}, #4285f4)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: "white", marginRight: 8, flexShrink: 0, marginTop: 2, letterSpacing: "0.05em" }}>PH</div>
                )}
                <div style={{ maxWidth: "78%", padding: loading && i === messages.length - 1 && msg.role === "ai" && msg.text === "" ? 0 : "9px 12px", borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: msg.role === "user" ? `linear-gradient(135deg, ${t.userBubble}, ${t.accent})` : t.aiBubble, color: msg.role === "user" ? "white" : t.text, fontSize, lineHeight: 1.55, border: msg.role === "ai" ? `1px solid ${t.border}` : "none", wordBreak: "break-word" }}>
                  {msg.image && <img src={msg.image} alt="attached" style={{ maxWidth: "100%", borderRadius: 8, marginBottom: msg.text ? 6 : 0, display: "block" }} />}
                  {loading && i === messages.length - 1 && msg.role === "ai" && msg.text === ""
                    ? <TypingIndicator accent={t.accent} />
                    : msg.role === "ai" ? renderMarkdown(msg.text, t.text, fontSize) : <span style={{ whiteSpace: "pre-wrap" }}>{msg.text}</span>}
                  {loading && i === messages.length - 1 && msg.role === "ai" && msg.text !== "" && <span style={{ opacity: 0.6 }}>▋</span>}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* ── Pending image preview ── */}
          {pendingImage && (
            <div style={{ padding: "6px 12px", background: t.surface, borderTop: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <img src={pendingImage} alt="pending" style={{ height: 48, borderRadius: 6, border: `1px solid ${t.border}` }} />
              <button onClick={() => setPendingImage(null)} style={{ background: "#ef444422", border: "1px solid #ef4444", borderRadius: 6, color: "#ef4444", fontSize: 10, padding: "2px 6px", cursor: "pointer" }}>✕ Remove</button>
            </div>
          )}

          {/* ── Input bar ── */}
          <div style={{ padding: "10px 12px", background: t.surface, borderTop: `1px solid ${t.border}`, display: "flex", gap: 8, alignItems: "center" }}>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageFile} style={{ display: "none" }} />
            <button className="hbtn img-btn" onClick={() => fileInputRef.current?.click()} title="Attach image"
              style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s", color: pendingImage ? t.accent : t.subtext }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
              onPaste={handlePaste} disabled={loading}
              placeholder={loading ? "Thinking..." : pendingImage ? "Describe what you want to know..." : "Ask Phantom AI..."}
              style={{ flex: 1, background: t.input, border: `1px solid ${t.border}`, borderRadius: 10, padding: "8px 12px", color: t.text, fontSize: fontSize - 1, fontFamily: "'Inter', sans-serif", transition: "border-color 0.15s" }}
              onFocus={e => e.target.style.borderColor = t.accent}
              onBlur={e => e.target.style.borderColor = t.border}
            />
            <button className="send-btn" onClick={handleSend} disabled={loading || (!input.trim() && !pendingImage)}
              style={{ background: `linear-gradient(135deg, ${t.accent}, #4285f4)`, border: "none", borderRadius: 10, width: 36, height: 36, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: loading || (!input.trim() && !pendingImage) ? 0.4 : 1, transition: "opacity 0.15s, transform 0.1s", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>


        </div>
        )}

      </div>
    </>
  );
}
