import { useState, useEffect, useRef } from "react";
import { Mic, X, Wifi, WifiOff } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";

export function VoiceInterface({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<"idle" | "connecting" | "active">("idle");
  const sessionRef = useRef<any>(null); // For Live session
  const aiRef = useRef<GoogleGenAI | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Lazy initialization
      aiRef.current = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY || "" });
      setStatus("connecting");
      
      // Live API initialization
      const startLive = async () => {
         try {
             // @ts-ignore
            sessionRef.current = await aiRef.current.live.connect({
                model: "gemini-3.1-flash-live-preview",
                config: {
                    responseModalities: ["AUDIO"],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } } }
                }
            });
            setStatus("active");
         } catch (e) {
             console.error("Live failed", e);
             setStatus("idle");
         }
      };
      startLive();

      return () => {
        sessionRef.current?.close();
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center"
    >
      <div className="glass-panel p-12 rounded-2xl flex flex-col items-center gap-8 border border-white/10 w-96">
        <h2 className="text-xl font-serif italic text-white">Live Voice Channel</h2>
        <div className={`p-8 rounded-full ${status === 'active' ? 'bg-blue-500/20' : 'bg-white/5'} animate-pulse`}>
            {status === 'active' ? <Mic size={48} className="text-blue-400" /> : <WifiOff size={48} className="text-white/20" />}
        </div>
        <p className="text-xs font-mono text-white/50 uppercase tracking-widest">{status}</p>
        <button onClick={onClose} className="text-white/40 hover:text-white">
            <X size={24} />
        </button>
      </div>
    </motion.div>
  );
}
