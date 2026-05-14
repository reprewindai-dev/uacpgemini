import { useState, useRef } from "react";
import { Mic, X, WifiOff, Settings2 } from "lucide-react";
import { motion } from "motion/react";
import { GoogleGenAI } from "@google/genai";

type VoiceMode = "live" | "agentic";

export function VoiceInterface({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<VoiceMode>("live");
  const [status, setStatus] = useState<"idle" | "connecting" | "active">("idle");
  const [sensitivity, setSensitivity] = useState(50);
  const sessionRef = useRef<any>(null); // For Live session
  const aiRef = useRef<GoogleGenAI | null>(null);

  const startLiveMode = async () => {
      setStatus("connecting");
      aiRef.current = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY || "" });
      try {
          // @ts-ignore
          sessionRef.current = await aiRef.current.live.connect({
              model: "gemini-3.1-flash-live-preview",
              config: { responseModalities: ["AUDIO"] }
          });
          setStatus("active");
      } catch (e) {
          console.error("Live failed", e);
          setStatus("idle");
      }
  };

  const startAgenticMode = () => {
    setStatus("active");
    // Structural placeholder for agnostic pipeline:
    // 1. Browser MediaStream -> Transcription (e.g., Whisper API)
    // 2. Transcription -> LLM API (Generic endpoint)
    // 3. LLM Response -> Text-to-Speech (e.g., ElevenLabs)
    console.log("Agnostic pipeline initiated");
  };

  if (!isOpen) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center">
      <div className="glass-panel p-8 rounded-3xl flex flex-col items-center gap-6 border border-white/10 w-[420px]">
        <div className="flex justify-between w-full items-center">
            <h2 className="text-lg font-mono text-white/90">Voice Gateway</h2>
            <button onClick={onClose} className="text-white/40 hover:text-white"><X size={20} /></button>
        </div>
        
        <div className="flex bg-white/5 p-1 rounded-full w-full">
            <button onClick={() => setMode("live")} className={`flex-1 py-2 text-xs font-mono rounded-full ${mode === 'live' ? 'bg-blue-600 text-white' : 'text-white/40'}`}>Native Live</button>
            <button onClick={() => setMode("agentic")} className={`flex-1 py-2 text-xs font-mono rounded-full ${mode === 'agentic' ? 'bg-purple-600 text-white' : 'text-white/40'}`}>Pro Agentic</button>
        </div>

        <div className={`p-8 rounded-full ${status === 'active' ? (mode === 'live' ? 'bg-blue-500/20' : 'bg-purple-500/20') : 'bg-white/5'}`}>
            {status === 'active' ? <Mic size={48} className={mode === 'live' ? 'text-blue-400' : 'text-purple-400'} /> : <WifiOff size={48} className="text-white/20" />}
        </div>
        
        <p className="text-xs font-mono text-white/50 uppercase tracking-widest">{status}</p>

        <div className="w-full space-y-2">
            <div className="flex justify-between text-[10px] font-mono text-white/40 uppercase">
                <span>Mic Sensitivity</span>
                <span>{sensitivity}%</span>
            </div>
            <input 
                type="range"
                min="0"
                max="100"
                value={sensitivity}
                onChange={(e) => setSensitivity(parseInt(e.target.value))}
                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
        </div>

        <button 
            onClick={mode === 'live' ? startLiveMode : startAgenticMode}
            className="w-full py-3 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white font-mono text-sm uppercase transition-all"
        >
            Initialize {mode === 'live' ? 'Live Channel' : 'Generic Pipeline'}
        </button>
      </div>
    </motion.div>
  );
}
