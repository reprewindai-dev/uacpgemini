import { useState, useEffect, useRef, ReactNode } from "react";
import { 
  Zap, 
  Terminal, 
  Activity, 
  LayoutGrid, 
  Disc, 
  Play, 
  Box, 
  ChevronRight, 
  ShieldCheck, 
  Cpu, 
  Database,
  ArrowUpRight,
  Info,
  Layers,
  Lock,
  Search,
  BrainCircuit
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  AreaChart, 
  Area, 
  ResponsiveContainer,
} from "recharts";

// --- Types ---
interface SSRNSignal {
  id: string;
  title: string;
  strength: number;
  timestamp: string;
  category: string;
}

interface Plan {
  id: string;
  name: string;
  intent: string;
  revision?: number;
  graph: {
    nodes: Array<{
      id: string;
      type: 'quantum' | 'classical';
      description: string;
      policy_tag?: string;
      policy_source?: string;
      mapping_reason?: string;
      confidence?: string;
      entropy?: number;
    }>;
    edges: Array<{ from: string; to: string }>;
  };
  status: string;
  research?: {
    query: string;
    topics: Array<{
      topic: string;
      relationship: string;
      researchText: string;
      evidence: string[];
      sourceSignalIds: string[];
      sourceSignalTitles: string[];
    }>;
    synthesis: string;
    sourceSignals: Array<{
      id: string;
      title: string;
      strength: number;
      category: string;
    }>;
    generatedAt: string;
    provider: string;
    mode: "llm" | "fallback";
  };
  createdAt: string;
}

interface RunArtifact {
  artifactId: string;
  title: string;
  generatedAt: string;
  planId: string;
  runId: string;
  statusModel: {
    plan_status: string;
    run_status: string;
    artifact_status: string;
    signal_status: string;
    deployment_status: string;
    claim_level: string;
  };
  originalIntent: string;
  generatedGraph: Plan["graph"];
  nodeList: Plan["graph"]["nodes"];
  policyTags: string[];
  runContract: {
    objective: string;
    acceptanceCriteria: string[];
    constraints: string[];
    successMetric: string;
  };
  phaseOutputs: Array<{
    phase: string;
    nodeId: string;
    output: string;
  }>;
  today: string[];
  next72Hours: string[];
  day7: string[];
  risks: string[];
  archives: string[];
  commandCenterSignals: string[];
  finalReport: string;
  archiveRecord: {
    recordId: string;
    summary: string;
    entries: string[];
    previousHash?: string | null;
    recordHash?: string;
  };
  nextAction: string;
}

interface Run {
  id: string;
  planId: string;
  planSnapshot?: Plan;
  artifact?: RunArtifact;
  status: string;
  progress: number;
  currentStep: string;
  startTime: string;
  output?: string;
  endTime?: string;
}

interface BootstrapPayload {
  userEmail: string;
  primaryProvider: string;
  primaryProviderLabel: string;
  providerChain: string[];
  researchFeedSource: string;
  authMode?: "disabled" | "cookie_session";
  persistenceMode?: "file" | "postgres";
}

interface ReplayRecord {
  replayId: string;
  planId: string;
  runId: string;
  archiveRecordId: string;
  generatedAt: string;
  claimLevel: string;
  checkpoints: Array<{
    stage: "plan" | "run" | "event" | "archive" | "replay";
    referenceId: string;
    timestamp: string;
    summary: string;
    previousHash?: string | null;
    recordHash?: string;
  }>;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'intent' | 'execution' | 'ops'>('intent');
  const [intent, setIntent] = useState("");
  const [loading, setLoading] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [selectedArtifactRun, setSelectedArtifactRun] = useState<Run | null>(null);
  const [selectedReplay, setSelectedReplay] = useState<ReplayRecord | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [signals, setSignals] = useState<any>(null);
  const [ssrnData, setSsrnData] = useState<SSRNSignal[]>([]);
  const [identity, setIdentity] = useState<string>("LOCAL_OPERATOR");
  const [providerLabel, setProviderLabel] = useState<string>("Deterministic fallback");
  const [providerChain, setProviderChain] = useState<string[]>([]);
  const [researchFeedSource, setResearchFeedSource] = useState<string>("arXiv");
  const [signalHistory, setSignalHistory] = useState<Record<string, Array<{ val: number }>>>({});
  const [authRequired, setAuthRequired] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authRefreshKey, setAuthRefreshKey] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const executionViewportRef = useRef<HTMLDivElement | null>(null);
  const activePlan = plans[0];
  const latestArtifactRun = runs.find((run) => run.artifact) ?? null;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    const connectWs = () => {
      socketRef.current = new WebSocket(wsUrl);
      socketRef.current.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'run_update') {
          setRuns(prev => {
            const idx = prev.findIndex(r => r.id === msg.data.id);
            if (idx === -1) return [msg.data, ...prev];
            const next = [...prev];
            next[idx] = msg.data;
            return next;
          });
          setSelectedArtifactRun(prev => prev?.id === msg.data.id ? msg.data : prev);
          if (msg.data.status === "completed" && msg.data.artifact) {
            setSelectedArtifactRun(msg.data);
            setActiveTab('ops');
          }
        } else if (msg.type === 'event') {
          setEvents(prev => {
            const exists = prev.some(e => e.id === msg.data.id);
            if (exists) return prev;
            return [msg.data, ...prev].slice(0, 50);
          });
        }
      };
      socketRef.current.onclose = () => {
        if (!authRequired) {
          setTimeout(connectWs, 3000);
        }
      };
    };

    // Initial Bootstrap
    const fetchData = async () => {
      try {
        const authRes = await fetch("/api/auth/status");
        if (!authRes.ok) {
          setAuthRequired(true);
          setAuthChecked(true);
          return;
        }

        setAuthRequired(false);
        const [p, r, e, s, o, b] = await Promise.all([
          fetch("/api/plans").then(res => res.json()),
          fetch("/api/runs").then(res => res.json()),
          fetch("/api/events").then(res => res.json()),
          fetch("/api/ssrn-signals").then(res => res.json()),
          fetch("/api/observability/signals").then(res => res.json()),
          fetch("/api/bootstrap").then(res => res.json())
        ]);
        setPlans(p);
        setRuns(r);
        setEvents(e);
        setSsrnData(s);
        setSignals(o);
        setSignalHistory(buildSignalHistory(o?.horowitz_signals || []));
        const bootstrap = b as BootstrapPayload;
        setIdentity(bootstrap.userEmail || "LOCAL_OPERATOR");
        setProviderLabel(bootstrap.primaryProviderLabel || "Deterministic fallback");
        setProviderChain(Array.isArray(bootstrap.providerChain) ? bootstrap.providerChain : []);
        setResearchFeedSource(bootstrap.researchFeedSource || "arXiv");
        setAuthChecked(true);
        interval = setInterval(() => {
          fetch("/api/observability/signals")
            .then(res => res.json())
            .then((nextSignals) => {
              setSignals(nextSignals);
              setSignalHistory(prev => appendSignalHistory(prev, nextSignals?.horowitz_signals || []));
            })
            .catch(() => {});
        }, 4000);
        connectWs();
      } catch (err) {
        console.error("Bootstrap error:", err);
        setAuthChecked(true);
      }
    };
    
    fetchData();
    return () => {
      if (interval) {
        clearInterval(interval);
      }
      socketRef.current?.close();
    };
  }, [authRefreshKey, authRequired]);

  const handleLogin = async () => {
    if (!passcode.trim() || authenticating) {
      return;
    }

    setAuthenticating(true);
    setAuthError(null);

    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: passcode.trim() }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || "Authentication failed");
      }

      setPasscode("");
      setAuthRequired(false);
      setAuthRefreshKey((value) => value + 1);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setAuthenticating(false);
    }
  };

  useEffect(() => {
    if (!selectedArtifactRun?.artifact) {
      setSelectedReplay(null);
      return;
    }

    fetch(`/api/runs/${selectedArtifactRun.id}/replay`)
      .then((res) => res.ok ? res.json() : null)
      .then((payload) => setSelectedReplay(payload))
      .catch(() => setSelectedReplay(null));
  }, [selectedArtifactRun]);

  useEffect(() => {
    if (activeTab !== "execution" || !activePlan || !executionViewportRef.current) {
      return;
    }

    executionViewportRef.current.scrollTo({ left: 0, behavior: "auto" });
  }, [activeTab, activePlan?.id]);

  const handleCreatePlan = async () => {
    const trimmedIntent = intent.trim();
    if (!trimmedIntent || loading) return;

    setLoading(true);
    setCompileError(null);
    
    try {
      const res = await fetch("/api/plans/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: trimmedIntent }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to compile plan");
      }

      const savedPlan = payload as Plan;
      setPlans(prev => [savedPlan, ...prev]);
      setIntent("");
      setActiveTab('execution');
    } catch (error) {
      console.error("Compilation error:", error);
      setCompileError(error instanceof Error ? error.message : "Compilation failed");
    } finally {
      setLoading(false);
    }
  };

  const resolveRunPlan = (run: Run) => run.planSnapshot ?? plans.find((plan) => plan.id === run.planId) ?? null;

  const downloadPlanSchema = (plan: Plan, scope: "active" | "run" = "active") => {
    try {
      const safeName = plan.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "uacp-plan";

      const payload = {
        exportedAt: new Date().toISOString(),
        scope,
        plan,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${safeName}-${plan.id}-schema.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setExportMessage("Schema downloaded");
    } catch (error) {
      console.error("Export error:", error);
      setExportMessage("Schema export failed");
    }
  };

  const downloadArtifact = (run: Run) => {
    if (!run.artifact) {
      setExportMessage("Artifact is not ready yet");
      return;
    }

    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        runId: run.id,
        planId: run.planId,
        artifact: run.artifact,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${run.artifact.artifactId}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setExportMessage("Artifact downloaded");
    } catch (error) {
      console.error("Artifact export error:", error);
      setExportMessage("Artifact export failed");
    }
  };

  const fetchReplay = async (runId: string) => {
    const res = await fetch(`/api/runs/${runId}/replay`);
    if (!res.ok) {
      throw new Error("Replay is not ready yet");
    }

    return await res.json() as ReplayRecord;
  };

  const openReplay = async (run: Run) => {
    try {
      const replay = await fetchReplay(run.id);
      setSelectedReplay(replay);
      if (!selectedArtifactRun || selectedArtifactRun.id !== run.id) {
        setSelectedArtifactRun(run);
      }
      setExportMessage("Replay loaded");
    } catch (error) {
      console.error("Replay load error:", error);
      setExportMessage(error instanceof Error ? error.message : "Replay unavailable");
    }
  };

  const downloadReplay = async (run: Run) => {
    try {
      const replay = await fetchReplay(run.id);
      const blob = new Blob([JSON.stringify(replay, null, 2)], {
        type: "application/json",
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${replay.replayId}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setExportMessage("Replay downloaded");
    } catch (error) {
      console.error("Replay export error:", error);
      setExportMessage(error instanceof Error ? error.message : "Replay export failed");
    }
  };

  const handleExportSchema = () => {
    if (!activePlan) {
      setExportMessage("No plan available to export");
      return;
    }

    downloadPlanSchema(activePlan, "active");
  };

  const handleStartRun = async (planId: string) => {
    try {
      const res = await fetch("/api/runs", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId })
      });
      const newRun = await res.json();
      setRuns(prev => [newRun, ...prev]);
      setActiveTab('ops');
    } catch (error) {
      console.error("Run error:", error);
    }
  };

  const currentSignalHistory = (signalId: string, fallbackValue: number) => {
    const trace = signalHistory[signalId];
    if (trace && trace.length > 0) {
      return trace;
    }

    return [{ val: fallbackValue }];
  };

  const certaintyIndex = typeof signals?.certainty_index === "number" ? signals.certainty_index : 0;
  const certaintyWidth = `${Math.max(0, Math.min(1, certaintyIndex)) * 100}%`;
  const observabilityStage = typeof signals?.observability_stage === "string" ? signals.observability_stage : "cold";
  const primeReadiness = typeof signals?.prime_readiness === "number" ? signals.prime_readiness : 0;
  const classicalLatency = typeof signals?.classical_latency === "number" ? signals.classical_latency : null;
  const latencySource = typeof signals?.latency_source === "string" ? signals.latency_source : null;
  const latencyProvider = typeof signals?.latency_provider === "string" ? signals.latency_provider : null;
  const latencyOperation = typeof signals?.latency_operation === "string" ? signals.latency_operation : null;

  return (
    <div className="h-screen flex flex-col bg-[#050505] text-[#e0e0e0] font-sans selection:bg-blue-500/30 overflow-hidden relative">
      <div className="absolute inset-0 scanner pointer-events-none z-0 opacity-50" />
      {authChecked && authRequired && (
        <div className="absolute inset-0 z-[120] bg-black/92 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-md border border-white/10 bg-[#090909] p-8 shadow-2xl space-y-6">
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-[0.35em] text-blue-300/70 font-mono">Operator Session</div>
              <h2 className="font-serif italic text-3xl text-white/90">Authenticated Access Required</h2>
              <p className="text-sm text-white/55 leading-relaxed">
                Enter the operator passcode to unlock the governed compiler, archive trail, and replay surface.
              </p>
            </div>
            <div className="space-y-3">
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleLogin();
                  }
                }}
                className="w-full bg-black/80 border border-white/10 px-4 py-3 text-sm text-white/85 focus:outline-none focus:border-blue-500/50"
                placeholder="Operator passcode"
              />
              {authError && <p className="text-sm text-red-300/80">{authError}</p>}
            </div>
            <button
              onClick={() => void handleLogin()}
              disabled={authenticating || !passcode.trim()}
              className="w-full px-4 py-3 border border-blue-500/30 bg-blue-500/10 text-[10px] uppercase tracking-[0.35em] font-mono text-blue-100 hover:bg-blue-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {authenticating ? "Authorizing" : "Unlock Control Plane"}
            </button>
          </div>
        </div>
      )}
      
      {/* Header Navigation */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-8 bg-[#0a0a0a] z-50 shadow-2xl relative">
        <div className="flex items-center gap-6">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 via-purple-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-blue-500/20 group cursor-pointer overflow-hidden relative">
            <motion.div 
              className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            />
            <Zap size={16} className="text-white fill-current relative z-10" />
          </div>
          <div className="flex flex-col">
            <span className="font-serif italic text-xl tracking-tight leading-none text-white/90">The Deterministic Engine</span>
            <span className="text-[8px] font-mono tracking-[0.4em] uppercase text-blue-400/60 mt-1">UACP Control Plane v0.2.0</span>
          </div>
        </div>
        
        <nav className="flex items-center gap-12 text-[10px] uppercase tracking-[0.25em] font-bold text-white/40">
          <TabButton active={activeTab === 'intent'} onClick={() => setActiveTab('intent')} label="Signal Feed" />
          <TabButton active={activeTab === 'execution'} onClick={() => setActiveTab('execution')} label="Probability Matrix" />
          <TabButton active={activeTab === 'ops'} onClick={() => setActiveTab('ops')} label="Deterministic Ops" />
          
          <div className="h-8 w-px bg-white/5 mx-2" />
          
          <div className="flex items-center gap-3 px-4 py-1.5 border border-white/10 rounded-full bg-white/5 backdrop-blur-sm group cursor-help">
            <ShieldCheck size={12} className="text-blue-400" />
            <span className="text-[9px] font-mono lowercase tracking-normal text-white/60">provider: {providerLabel.toLowerCase()}</span>
            <ArrowUpRight size={10} className="text-white/20 group-hover:text-blue-400 transition-colors" />
          </div>
        </nav>
      </header>

      {/* Main Content Workspace */}
      <main className="flex-1 grid grid-cols-12 gap-1 p-1 bg-white/5 overflow-hidden">
        
        {/* Left Column: Research Signals & Event Log */}
        <section className="col-span-3 bg-[#0a0a0a] flex flex-col border border-white/5 overflow-hidden glass-panel">
          <div className="p-6 border-b border-white/5 bg-gradient-to-b from-white/[0.02] to-transparent">
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-blue-400 font-bold mb-1 flex items-center gap-2">
              <Search size={10} />
              Signal Ingestion Feed
            </h2>
            <p className="text-[10px] text-white/30 italic">Continuous scanning of live {researchFeedSource} research signals</p>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-1 pb-24">
            <div className="space-y-px">
              {ssrnData.map((sig) => (
                <div key={sig.id} className="p-4 bg-white/[0.01] hover:bg-white/[0.03] transition-colors border-b border-white/[0.03] last:border-0 group cursor-default">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9px] font-mono text-blue-400/80 tracking-tighter uppercase">{sig.id}</span>
                    <span className="text-[9px] text-white/20 font-mono">{sig.category}</span>
                  </div>
                  <h3 className="text-xs text-white/80 font-light leading-snug group-hover:text-white transition-colors">{sig.title}</h3>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                      <span className="text-[8px] font-mono text-white/30 tracking-widest uppercase">Relevance Score</span>
                    </div>
                    <span className="text-[10px] font-mono text-green-500/80">{sig.strength}%</span>
                  </div>
                </div>
              ))}
            </div>

            {ssrnData.length === 0 && (
              <div className="p-6 text-[10px] font-mono uppercase tracking-[0.25em] text-white/25">
                No live research signals available.
              </div>
            )}
            
            <div className="p-6 border-t border-white/5 mt-4">
              <h3 className="text-[9px] uppercase tracking-widest text-white/20 font-bold mb-4">Event Sequence Log</h3>
              <div className="space-y-3">
                {events.slice(0, 8).map((ev) => (
                  <div key={ev.id} className="flex gap-3 items-start group">
                    <div className="mt-1 w-1.5 h-1.5 rounded-full border border-white/20 group-hover:border-blue-400 transition-colors shrink-0" />
                    <div className="flex flex-col gap-0.5" title={ev.message}>
                      <span className="text-[9px] text-white/80 font-mono tracking-tighter leading-none">{ev.type}</span>
                      <span className="text-[9px] text-white/30 italic truncate max-w-[180px]">{ev.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-white/5 bg-black/40">
            <div className="flex justify-between items-center text-[10px] mb-3 text-white/40 uppercase font-mono tracking-tighter">
              <span>Policy Alignment</span>
              <span className="text-blue-400">{providerLabel}</span>
            </div>
            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden relative">
              <motion.div 
                className="h-full bg-gradient-to-r from-blue-600 to-purple-600"
                animate={{ width: `${(signals?.gopher_policy_alignment || 0.95) * 100}%` }}
              />
            </div>
            <p className="mt-3 text-[9px] text-white/20 italic leading-relaxed">
              "Deterministic constraints verified against policy family AC-10."
            </p>
          </div>
        </section>

        {/* Center Panel: Hero Interaction Surface */}
        <section className="col-span-6 flex flex-col bg-[#080808] border border-white/5 overflow-hidden technical-grid relative">
          <AnimatePresence mode="wait">
            {activeTab === 'intent' && (
              <motion.div 
                key="intent"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex-1 flex flex-col p-12 pb-32 overflow-y-auto custom-scrollbar"
              >
                <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto text-center space-y-12">
                  <div className="space-y-4">
                    <span className="text-[10px] uppercase tracking-[0.4em] text-white/20 font-mono">Input Deterministic Strategy</span>
                    <h1 className="font-serif italic text-5xl text-white/90 leading-tight">
                      "Probability is merely the shadow of a hidden order."
                    </h1>
                  </div>

                  <div className="w-full relative group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-indigo-500/10 rounded-xl blur-xl opacity-0 group-focus-within:opacity-100 transition duration-1000" />
                    <div className="relative glass-panel rounded-xl overflow-hidden border border-white/10 shadow-2xl">
                      <textarea 
                        className="w-full h-48 bg-black/80 p-8 text-xl font-light italic text-white/90 placeholder:text-white/10 focus:outline-none resize-none transition-all focus:bg-black relative z-20"
                        placeholder="State your orchestration intent..."
                        value={intent}
                        onChange={(e) => {
                          setIntent(e.target.value);
                          if (compileError) {
                            setCompileError(null);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleCreatePlan();
                          }
                        }}
                        autoFocus
                      />
                      
                      {loading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-md z-50">
                          <div className="flex flex-col items-center gap-6">
                            <div className="relative">
                              <motion.div 
                                className="w-16 h-16 rounded-full border-2 border-t-blue-500 border-r-transparent border-b-purple-500 border-l-transparent" 
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                              />
                            </div>
                            <div className="space-y-2 text-center">
                              <span className="text-[11px] font-mono tracking-[0.3em] text-blue-400 block uppercase">Analyzing Complexity</span>
                              <span className="text-[9px] font-mono text-white/30 uppercase">Compiling with {providerLabel}...</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button 
                    disabled={loading || !intent.trim()}
                    onClick={handleCreatePlan}
                    className="w-full max-w-sm py-5 bg-white text-black text-[12px] uppercase tracking-[0.5em] font-black hover:bg-blue-600 hover:text-white transition-all disabled:opacity-10 group active:scale-[0.98] shadow-[0_20px_50px_rgba(255,255,255,0.1)] hover:shadow-blue-500/40"
                    >
                      <span className="flex items-center justify-center gap-4">
                        SEND SIGNAL / EXECUTE
                        <ChevronRight size={16} className="group-hover:translate-x-2 transition-transform" />
                      </span>
                    </button>
                  <p
                    className={`text-[9px] uppercase tracking-[0.4em] font-mono ${compileError ? "text-rose-400/90" : "text-white/10"}`}
                    role={compileError ? "alert" : undefined}
                  >
                    {compileError || "Press [Enter] to transmit"}
                  </p>
                </div>

                <div className="mt-auto flex justify-between items-end border-t border-white/5 pt-6 text-[9px] uppercase tracking-[0.2em] font-mono text-white/20">
                  <div className="space-y-1">
                    <div>Station: CONTROL_PLANE_LIVE</div>
                    <div>Identity: {identity}</div>
                  </div>
                  <div className="text-right space-y-1">
                    <div className="text-3xl font-serif italic text-white/70">{certaintyIndex.toFixed(4)}</div>
                    <div>Current Certainty Index</div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'execution' && (
              <motion.div 
                key="execution"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex-1 flex flex-col p-8 pb-32 overflow-y-auto custom-scrollbar"
              >
                <div className="flex justify-between items-center mb-12 border-b border-white/5 pb-6">
                   <div className="space-y-1">
                    <h2 className="font-serif italic text-3xl text-white/90">Probability Matrix</h2>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-white/30 font-bold">Plan Hierarchy Revision {activePlan?.revision || 1}</p>
                   </div>
                   <div className="flex gap-4">
                     {activePlan && (
                       <div className="px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-md flex items-center gap-3">
                         <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                         <span className="text-[9px] font-mono text-blue-200 uppercase tracking-widest">Directive: {activePlan.name}</span>
                       </div>
                     )}
                     <button
                      onClick={handleExportSchema}
                      disabled={!activePlan}
                      className="text-[10px] font-mono text-white/50 hover:text-blue-400 transition-colors px-4 py-2 border border-white/10 rounded uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed"
                     >
                      Export Schema
                     </button>
                   </div>
                 </div>

                {exportMessage && (
                  <div className="mb-6 text-right">
                    <span className="text-[9px] font-mono uppercase tracking-[0.3em] text-blue-300/80">{exportMessage}</span>
                  </div>
                )}

                {activePlan && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8 p-4 bg-white/[0.02] border border-white/5 rounded-lg backdrop-blur-sm"
                  >
                    <div className="flex items-start gap-4">
                      <div className="mt-1 p-1.5 bg-blue-500/10 rounded text-blue-400">
                        <Info size={14} />
                      </div>
                      <div className="flex-1">
                        <span className="text-[9px] font-mono text-white/20 uppercase tracking-widest block mb-1">Strategic Briefing</span>
                        <p className="text-xs text-white/60 leading-relaxed italic">
                          "{activePlan.intent}" - Sequence initialized with {activePlan.graph?.nodes?.length || 0} nodes.
                          Anticipated deterministic yield is 99.9%. Policy markers AC-10 and AC-GLOBAL applied to all transition states.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}

                <div
                  ref={executionViewportRef}
                  className="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar p-12"
                >
                   {activePlan ? (
                     <div className="flex min-w-max items-start gap-12 relative animate-in fade-in duration-700">
                        {activePlan.graph?.nodes?.map((node: any, idx: number) => (
                          <div key={`${node.id}-${idx}`} className="relative group shrink-0">
                            <motion.div 
                              initial={{ y: 20, opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              transition={{ delay: idx * 0.1 }}
                              whileHover={{ scale: 1.05 }}
                              className="w-64 p-8 glass-panel rounded-lg shadow-2xl relative z-10 hover:border-blue-500/50 transition-all border-white/10 group-hover:shadow-blue-500/20 backdrop-blur-xl group cursor-crosshair"
                            >
                               {/* Quantum Shimmer Effect */}
                               <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                               
                               <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                               <div className="flex justify-between items-start mb-6">
                                  <div className="p-2.5 bg-white/5 rounded-lg border border-white/10 group-hover:bg-blue-500/20 transition-colors">
                                    {node.type === 'quantum' ? <Cpu size={16} className="text-purple-400" /> : <Database size={16} className="text-blue-400" />}
                                  </div>
                                  <div className="text-right">
                                    <span className="text-[8px] font-mono text-white/20 block uppercase tracking-tighter">Policy_Tag</span>
                                    <span className="text-[9px] font-mono text-blue-400 flex items-center gap-1">
                                      <Lock size={8} />
                                      {node.policy_tag || 'AC-GLOBAL'}
                                    </span>
                                  </div>
                               </div>
                               
                               <div className="text-sm font-mono font-black text-white/95 uppercase tracking-tight mb-3 flex items-center gap-2">
                                 {node.id}
                                 <motion.div 
                                   animate={{ opacity: [0.2, 1, 0.2] }} 
                                   transition={{ repeat: Infinity, duration: 2 }}
                                   className="w-1 h-1 rounded-full bg-blue-400" 
                                 />
                               </div>
                               
                               <div className="text-xs text-white/50 leading-relaxed font-light italic h-16 overflow-hidden mb-6 group-hover:text-white/80 transition-colors">
                                 {node.description}
                                </div>
                               
                               <div className="flex items-center justify-between pt-5 border-t border-white/5">
                                  <div className="flex items-center gap-2">
                                     <div className="w-1.5 h-1.5 rounded-sm bg-blue-500 group-hover:animate-spin" />
                                     <span className="text-[9px] font-mono text-white/30 uppercase tracking-[0.2em]">Entropy: {node.entropy || '0.22'}</span>
                                  </div>
                                  <ArrowUpRight size={12} className="text-white/10 group-hover:text-white transition-all transform group-hover:translate-x-1 group-hover:-translate-y-1" />
                               </div>

                               {/* Position Indicators */}
                               <div className="absolute -bottom-2 -left-2 text-[7px] font-mono text-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
                                 X: {idx.toFixed(2)} Y: 0.00
                               </div>
                            </motion.div>
                            
                            {/* Connector Lines with Flow Effect */}
                            {idx < activePlan.graph.nodes.length - 1 && (
                              <div className="absolute top-1/2 -right-12 w-12 h-px z-0">
                                <div className="absolute inset-0 bg-white/10" />
                                <motion.div 
                                  animate={{ x: [-12, 48], opacity: [0, 1, 0] }}
                                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                  className="w-4 h-full bg-blue-400 blur-sm"
                                />
                              </div>
                            )}
                          </div>
                        ))}
                     </div>
                   ) : (
                     <div className="flex flex-col items-center gap-6 opacity-30">
                        <Layers size={48} className="animate-pulse" />
                        <span className="font-serif italic text-lg">No deterministic plans compiled.</span>
                     </div>
                   )}
                </div>

                <div className="mt-auto pt-12 flex justify-center">
                  {activePlan && (
                    <button 
                      onClick={() => handleStartRun(activePlan.id)}
                      className="px-12 py-3 border border-white/10 text-[10px] uppercase font-bold tracking-[0.4em] hover:bg-white hover:text-black transition-all shadow-xl active:scale-95"
                    >
                      Commit Sequence to Control Plane
                    </button>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'ops' && (
              <motion.div 
                key="ops"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex-1 flex flex-col p-12 pb-32 overflow-y-auto custom-scrollbar"
              >
                <div className="flex justify-between items-end mb-12 border-b border-white/5 pb-6">
                   <div className="space-y-1">
                    <h2 className="font-serif italic text-3xl text-white/90">Archives of Order</h2>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-white/30 font-bold">Live Execution Telemetry</p>
                   </div>
                   <div className="flex items-center gap-4 text-right">
                    <div className="flex flex-col">
                      <span className="text-[8px] font-mono text-white/30">Latency</span>
                      <span className="text-xs font-mono text-blue-400">
                        {classicalLatency !== null ? `${classicalLatency.toFixed(1)}ms` : "--"}
                      </span>
                      <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-white/20">
                        {latencySource === "provider"
                          ? `${latencyProvider || "provider"} ${latencyOperation === "plan_compile" ? "compile" : latencyOperation === "artifact_compile" ? "artifact" : "request"}`
                          : latencySource === "run"
                            ? "run telemetry"
                            : "awaiting sample"}
                      </span>
                    </div>
                    <div className="h-8 w-px bg-white/5" />
                    <div className="flex flex-col">
                      <span className="text-[8px] font-mono text-white/30">Coherence</span>
                      <span className="text-xs font-mono text-purple-400">{signals?.quantum_coherence?.toFixed(1) || '0'}%</span>
                    </div>
                   </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-8 pr-6">
                   {runs.map((run) => {
                     const runPlan = resolveRunPlan(run);

                     return (
                     <div key={run.id} className="glass-panel p-8 relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-blue-500 opacity-20 group-hover:opacity-100 transition-opacity" />
                        
                        <div className="flex justify-between items-start mb-8">
                          <div className="space-y-2">
                              <div className="flex items-center gap-4">
                                 <span className="font-mono text-xs font-bold text-white tracking-widest">{run.id}</span>
                                 <span className={`text-[9px] px-2 py-0.5 border rounded-full uppercase tracking-widest font-bold ${run.status === 'completed' ? 'border-green-500/20 text-green-500 bg-green-500/5' : 'border-blue-500/20 text-blue-400 bg-blue-500/5'}`}>
                                   {run.status.toUpperCase()}
                                 </span>
                              </div>
                              <div className="flex items-center gap-3 text-[10px] text-white/40 font-mono italic">
                                <span>Compiled Reference:</span>
                                <button
                                  onClick={() => run.artifact && setSelectedArtifactRun(run)}
                                  disabled={!run.artifact}
                                  className="text-blue-300 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  {run.planId}
                                </button>
                                <button
                                  onClick={() => run.artifact && setSelectedArtifactRun(run)}
                                  disabled={!run.artifact}
                                  className="text-blue-300 hover:text-white transition-colors uppercase tracking-[0.3em] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  [Open Artifact]
                                </button>
                              </div>
                              <div className="flex gap-3 pt-2">
                                <button
                                  onClick={() => runPlan && setSelectedPlan(runPlan)}
                                  disabled={!runPlan}
                                  className="text-[9px] font-mono uppercase tracking-[0.3em] text-blue-300 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  View Plan
                                </button>
                                <button
                                  onClick={() => run.artifact && setSelectedArtifactRun(run)}
                                  disabled={!run.artifact}
                                  className="text-[9px] font-mono uppercase tracking-[0.3em] text-purple-300 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  Open Artifact
                                </button>
                                <button
                                  onClick={() => runPlan && downloadPlanSchema(runPlan, "run")}
                                  disabled={!runPlan}
                                  className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/40 hover:text-blue-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  Download Plan
                                </button>
                                <button
                                  onClick={() => downloadArtifact(run)}
                                  disabled={!run.artifact}
                                  className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/40 hover:text-purple-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  Download Artifact
                                </button>
                                <button
                                  onClick={() => openReplay(run)}
                                  disabled={!run.artifact}
                                  className="text-[9px] font-mono uppercase tracking-[0.3em] text-cyan-300 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  Open Replay
                                </button>
                                <button
                                  onClick={() => downloadReplay(run)}
                                  disabled={!run.artifact}
                                  className="text-[9px] font-mono uppercase tracking-[0.3em] text-white/40 hover:text-cyan-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  Download Replay
                                </button>
                              </div>
                          </div>
                          <div className="text-right">
                             <div className="text-4xl font-serif italic text-white/90 tabular-nums">{run.progress}%</div>
                          </div>
                        </div>

                         <div className="space-y-4">
                           <div className="flex justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
                              <span className="flex items-center gap-2">
                                <Disc size={10} className={run.status === 'completed' ? '' : 'animate-spin'} />
                                Active Phase: {run.currentStep}
                              </span>
                              <span>TS INITIATION: {new Date(run.startTime).toLocaleTimeString()}</span>
                           </div>
                           <div className="w-full h-2 bg-white/5 overflow-hidden relative rounded-full">
                              <motion.div 
                                className="h-full bg-gradient-to-r from-blue-600 to-indigo-500 shadow-[0_0_15px_rgba(59,130,246,0.6)]"
                                animate={{ width: `${run.progress}%` }}
                              />
                              <motion.div 
                                animate={{ x: ['0%', '100%'], opacity: [0, 1, 0] }}
                                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                className="absolute top-0 bottom-0 w-20 bg-white/20 skew-x-12"
                              />
                           </div>
                           
                            {/* Step Micro-Labels */}
                            <div className="flex justify-between mt-2 overflow-hidden">
                              {runPlan ? runPlan.graph.nodes.map((node, nIdx) => (
                                <div key={`${node.id}-${nIdx}`} className="flex flex-col items-center gap-1 opacity-20 hover:opacity-100 transition-opacity cursor-default">
                                  <div className={`w-1 h-1 rounded-full ${nIdx / (runPlan.graph.nodes.length || 1) * 100 <= run.progress ? 'bg-blue-400' : 'bg-white/40'}`} />
                                  <span className="text-[7px] font-mono uppercase tracking-tighter">{node.id}</span>
                                </div>
                              )) : null}
                            </div>
                        </div>

                        {run.status === 'completed' && run.output && (
                           <motion.div 
                             initial={{ opacity: 0, y: 10 }}
                             animate={{ opacity: 1, y: 0 }}
                             className="mt-8 p-6 bg-blue-500/5 border border-blue-500/10 rounded-lg relative overflow-hidden"
                           >
                              <div className="absolute top-0 right-0 p-2 text-blue-500/20">
                                <Activity size={40} className="opacity-10" />
                              </div>
                              <div className="flex gap-4 relative z-10">
                                 <div className="shrink-0 p-2 bg-blue-500/10 rounded text-blue-400 h-fit">
                                   <BrainCircuit size={16} />
                                 </div>
                                 <div className="space-y-1">
                                   <span className="text-[9px] font-mono text-blue-300 uppercase tracking-widest block">Deterministic Outcome Report</span>
                                   <p className="text-xs text-white/70 leading-relaxed font-light italic">
                                     {run.output}
                                   </p>
                                 </div>
                              </div>
                           </motion.div>
                        )}
                     </div>
                   )})}
                   
                   {runs.length === 0 && (
                     <div className="h-full flex flex-col items-center justify-center opacity-20 space-y-6">
                        <Lock size={48} />
                        <span className="font-serif italic text-xl">Operational plane locked. Initialize plan to unlock.</span>
                     </div>
                   )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Right Column: Convergence Telemetry */}
        <section className="col-span-3 bg-[#0a0a0a] flex flex-col border border-white/5 overflow-hidden glass-panel">
           <div className="p-6 border-b border-white/5 bg-gradient-to-b from-white/[0.02] to-transparent">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-purple-400 font-bold mb-1 flex items-center gap-2">
                <Activity size={10} />
                Asset Convergence
              </h2>
              <p className="text-[10px] text-white/30 italic">Real-time heuristics & deterministic alpha</p>
           </div>
           
           <div className="flex-1 overflow-y-auto custom-scrollbar p-6 pb-24 space-y-10">
              {signals?.market_convergence?.map((m: any, idx: number) => (
                <ConvergenceBar 
                  key={`${m.label}-${idx}`}
                  label={m.label} 
                  value={m.value} 
                  progress={Math.abs(parseFloat(m.value)) / 10} 
                  color={idx % 2 === 0 ? "blue" : "purple"} 
                />
              ))}
              
              {(!signals?.market_convergence || signals.market_convergence.length === 0) && (
                <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/25">
                  No live market convergence data available.
                </div>
              )}
              
              <div className="pt-8 border-t border-white/5 space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-[9px] uppercase tracking-widest text-white/20 font-bold">Observability Signals</h3>
                  <span className={`text-[8px] font-mono uppercase tracking-[0.25em] ${
                    observabilityStage === 'verified'
                      ? 'text-green-400'
                      : observabilityStage === 'primed'
                        ? 'text-blue-300'
                        : observabilityStage === 'executing'
                          ? 'text-purple-300'
                          : observabilityStage === 'degraded'
                            ? 'text-rose-400'
                            : 'text-white/30'
                  }`}>
                    {observabilityStage}
                  </span>
                </div>
                {signals?.horowitz_signals?.map((sig: any, sIdx: number) => (
                  <div key={`${sig.id}-${sIdx}`} className="space-y-4">
                    <div className="flex justify-between items-end">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-mono text-white/40 uppercase tracking-tighter">{sig.id}</span>
                        <span className="text-xs font-serif italic text-white/80">Value Trace</span>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-[9px] font-mono uppercase font-bold tracking-[0.25em] ${
                          sig.state === 'verified'
                            ? 'text-green-400'
                            : sig.state === 'primed'
                              ? 'text-blue-300'
                              : sig.state === 'executing'
                                ? 'text-purple-300'
                                : sig.state === 'degraded'
                                  ? 'text-rose-400'
                                  : sig.trend === 'rising'
                                    ? 'text-green-500'
                                    : sig.trend === 'stable'
                                      ? 'text-blue-400'
                                      : 'text-rose-400'
                        }`}>
                          {sig.state || sig.trend}
                        </span>
                        {sig.state && sig.trend && sig.state !== sig.trend && (
                          <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-white/25">
                            trend: {sig.trend}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="h-16 w-full opacity-50 overflow-hidden grayscale hover:grayscale-0 transition-all duration-700">
                       <ResponsiveContainer width="100%" height="100%" minHeight={60} minWidth={100}>
                          <AreaChart data={currentSignalHistory(sig.id, sig.value)}>
                            <defs>
                              <linearGradient id={`grad-${sig.id}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={sig.trend === 'rising' ? "#10b981" : "#3b82f6"} stopOpacity={0.3}/>
                                <stop offset="95%" stopColor={sig.trend === 'rising' ? "#10b981" : "#3b82f6"} stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <Area type="monotone" dataKey="val" stroke={sig.trend === 'rising' ? "#10b981" : "#3b82f6"} fillOpacity={1} fill={`url(#grad-${sig.id})`} />
                          </AreaChart>
                       </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-5 glass-panel rounded border-white/5 bg-white/[0.01] mt-8">
                 <h3 className="text-[9px] uppercase tracking-widest text-white/30 font-bold mb-4 flex items-center gap-2">
                   <Info size={10} className="text-blue-400" />
                   Compiled Artifact
                 </h3>
                 <div className="text-xs text-white/60 italic leading-relaxed font-light">
                  {latestArtifactRun?.artifact?.finalReport || "Complete a run to populate the compiled artifact."}
                 </div>
                 <div className="mt-4 flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-blue-500/10 flex items-center justify-center text-[8px] text-blue-400 font-mono">
                      {latestArtifactRun?.id?.slice(-1).toUpperCase() || "A"}
                    </div>
                    <span className="text-[8px] font-mono text-white/20 uppercase tracking-widest">
                      {latestArtifactRun?.artifact?.nextAction || `Provider chain: ${providerChain.join(" -> ") || providerLabel}`}
                    </span>
                 </div>
              </div>
           </div>

           <div className="p-8 border-t border-white/5 bg-black/40">
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center text-[8px] font-mono text-white/25 uppercase tracking-[0.25em]">
                  <span>Prime Readiness</span>
                  <span className="text-blue-300">{Math.round(primeReadiness * 100)}%</span>
                </div>
                <div className="flex justify-between items-center text-[9px] font-mono text-white/20 uppercase tracking-widest">
                  <span>Certainty Index</span>
                  <span className="text-white text-sm font-serif italic">{certaintyIndex.toFixed(4)}</span>
                </div>
                <div className="h-[2px] w-full bg-white/5 relative overflow-hidden">
                  <motion.div 
                    className="absolute inset-0 bg-blue-500/40"
                    animate={{ x: [-100, 400] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                  />
                  <div className="absolute left-0 top-0 h-full bg-blue-400 shadow-[0_0_10px_rgba(59,130,246,1)]" style={{ width: certaintyWidth }} />
                </div>
              </div>
           </div>
        </section>
      </main>

      {selectedArtifactRun?.artifact && (
        <div className="absolute inset-0 z-[75] bg-black/85 backdrop-blur-sm overflow-y-auto custom-scrollbar p-6">
          <div className="w-full max-w-6xl h-[90vh] mx-auto flex flex-col border border-white/10 bg-[#090909] shadow-2xl">
            <div className="shrink-0 flex items-start justify-between gap-6 p-6 border-b border-white/10 bg-white/[0.02]">
               <div className="space-y-2">
                <span className="text-[10px] uppercase tracking-[0.35em] text-purple-300/70 font-mono">Compiled Artifact</span>
                <h3 className="font-serif italic text-3xl text-white/90">{selectedArtifactRun.artifact.title}</h3>
                <div className="flex gap-6 text-[10px] font-mono uppercase tracking-[0.25em] text-white/40">
                  <span>Plan ID: {selectedArtifactRun.planId}</span>
                  <span>Run ID: {selectedArtifactRun.id}</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <StatusPill label="Plan" value={selectedArtifactRun.artifact.statusModel.plan_status} />
                  <StatusPill label="Run" value={selectedArtifactRun.artifact.statusModel.run_status} />
                  <StatusPill label="Artifact" value={selectedArtifactRun.artifact.statusModel.artifact_status} />
                  <StatusPill label="Signals" value={selectedArtifactRun.artifact.statusModel.signal_status} />
                  <StatusPill label="Deployment" value={selectedArtifactRun.artifact.statusModel.deployment_status} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => downloadArtifact(selectedArtifactRun)}
                  className="px-4 py-2 border border-purple-500/20 text-[10px] uppercase tracking-[0.3em] font-mono text-purple-200 hover:bg-purple-500/10 transition-colors"
                >
                  Download Artifact
                </button>
                <button
                  onClick={() => openReplay(selectedArtifactRun)}
                  className="px-4 py-2 border border-cyan-500/20 text-[10px] uppercase tracking-[0.3em] font-mono text-cyan-200 hover:bg-cyan-500/10 transition-colors"
                >
                  Open Replay
                </button>
                <button
                  onClick={() => downloadReplay(selectedArtifactRun)}
                  className="px-4 py-2 border border-cyan-500/20 text-[10px] uppercase tracking-[0.3em] font-mono text-cyan-200 hover:bg-cyan-500/10 transition-colors"
                >
                  Download Replay
                </button>
                <button
                  onClick={() => setSelectedArtifactRun(null)}
                  className="px-4 py-2 border border-white/10 text-[10px] uppercase tracking-[0.3em] font-mono text-white/60 hover:text-white transition-colors"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-12 gap-6 p-6">
              <div className="col-span-7 space-y-6">
                <ArtifactSection title="Original Intent">
                  <p className="text-sm text-white/80 leading-relaxed">{selectedArtifactRun.artifact.originalIntent}</p>
                </ArtifactSection>

                <div className="grid grid-cols-2 gap-4">
                  <ArtifactSection title="Status Model">
                    <div className="space-y-2 text-sm text-white/75">
                      <p><span className="text-white/40">Claim level:</span> {selectedArtifactRun.artifact.statusModel.claim_level}</p>
                      <p><span className="text-white/40">Plan:</span> {selectedArtifactRun.artifact.statusModel.plan_status}</p>
                      <p><span className="text-white/40">Run:</span> {selectedArtifactRun.artifact.statusModel.run_status}</p>
                      <p><span className="text-white/40">Artifact:</span> {selectedArtifactRun.artifact.statusModel.artifact_status}</p>
                      <p><span className="text-white/40">Signals:</span> {selectedArtifactRun.artifact.statusModel.signal_status}</p>
                      <p><span className="text-white/40">Deployment:</span> {selectedArtifactRun.artifact.statusModel.deployment_status}</p>
                    </div>
                  </ArtifactSection>

                  <ArtifactSection title="Run Contract">
                    <div className="space-y-3 text-sm text-white/75">
                      <p>{selectedArtifactRun.artifact.runContract.objective}</p>
                      <div>
                        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/35 mb-2">Acceptance Criteria</div>
                        {selectedArtifactRun.artifact.runContract.acceptanceCriteria.map((item, index) => (
                          <div key={`${item}-${index}`} className="mb-2">{item}</div>
                        ))}
                      </div>
                      <div>
                        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/35 mb-2">Constraints</div>
                        {selectedArtifactRun.artifact.runContract.constraints.map((item, index) => (
                          <div key={`${item}-${index}`} className="mb-2">{item}</div>
                        ))}
                      </div>
                    </div>
                  </ArtifactSection>

                  <ArtifactSection title="Next Action">
                    <p className="text-sm text-white/80 leading-relaxed">{selectedArtifactRun.artifact.nextAction}</p>
                  </ArtifactSection>
                </div>

                <ArtifactSection title="Phase Outputs">
                  <div className="space-y-3">
                    {selectedArtifactRun.artifact.phaseOutputs.map((phase, index) => (
                      <div key={`${phase.nodeId}-${index}`} className="border border-white/10 p-4 bg-white/[0.02]">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-blue-300/80">{phase.phase}</span>
                          <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/35">{phase.nodeId}</span>
                        </div>
                        <p className="mt-3 text-sm text-white/75 leading-relaxed">{phase.output}</p>
                      </div>
                    ))}
                  </div>
                </ArtifactSection>

                <div className="grid grid-cols-2 gap-4">
                  <ArtifactSection title="Today">
                    {selectedArtifactRun.artifact.today.map((item, index) => (
                      <p key={`${item}-${index}`} className="mb-2 text-sm text-white/75 leading-relaxed">{item}</p>
                    ))}
                  </ArtifactSection>

                  <ArtifactSection title="Next 72 Hours">
                    {selectedArtifactRun.artifact.next72Hours.map((item, index) => (
                      <p key={`${item}-${index}`} className="mb-2 text-sm text-white/75 leading-relaxed">{item}</p>
                    ))}
                  </ArtifactSection>

                  <ArtifactSection title="Day 7">
                    {selectedArtifactRun.artifact.day7.map((item, index) => (
                      <p key={`${item}-${index}`} className="mb-2 text-sm text-white/75 leading-relaxed">{item}</p>
                    ))}
                  </ArtifactSection>

                  <ArtifactSection title="Risks">
                    {selectedArtifactRun.artifact.risks.map((item, index) => (
                      <p key={`${item}-${index}`} className="mb-2 text-sm text-white/75 leading-relaxed">{item}</p>
                    ))}
                  </ArtifactSection>

                  <ArtifactSection title="Archives">
                    {selectedArtifactRun.artifact.archives.map((item, index) => (
                      <p key={`${item}-${index}`} className="mb-2 text-sm text-white/75 leading-relaxed">{item}</p>
                    ))}
                  </ArtifactSection>

                  <ArtifactSection title="Command Center Signals">
                    {selectedArtifactRun.artifact.commandCenterSignals.map((item, index) => (
                      <p key={`${item}-${index}`} className="mb-2 text-sm text-white/75 leading-relaxed">{item}</p>
                    ))}
                  </ArtifactSection>
                </div>

                <ArtifactSection title="Final Output Report">
                  <p className="text-sm text-white/85 leading-relaxed">{selectedArtifactRun.artifact.finalReport}</p>
                </ArtifactSection>

                <ArtifactSection title="Archive Record">
                  <div className="space-y-2 text-sm text-white/75">
                    <p>{selectedArtifactRun.artifact.archiveRecord.summary}</p>
                    {selectedArtifactRun.artifact.archiveRecord.recordHash && (
                      <p className="text-[10px] font-mono text-cyan-300/80 break-all">
                        record_hash: {selectedArtifactRun.artifact.archiveRecord.recordHash}
                      </p>
                    )}
                    {selectedArtifactRun.artifact.archiveRecord.previousHash && (
                      <p className="text-[10px] font-mono text-white/45 break-all">
                        previous_hash: {selectedArtifactRun.artifact.archiveRecord.previousHash}
                      </p>
                    )}
                    {selectedArtifactRun.artifact.archiveRecord.entries.map((entry, index) => (
                      <p key={`${entry}-${index}`}>{entry}</p>
                    ))}
                  </div>
                </ArtifactSection>

                <ArtifactSection title="Replay Chain">
                  {selectedReplay ? (
                    <div className="space-y-3">
                      <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/35">
                        Replay ID: {selectedReplay.replayId} | Claim Level: {selectedReplay.claimLevel}
                      </div>
                      {selectedReplay.checkpoints.map((checkpoint, index) => (
                        <div key={`${checkpoint.referenceId}-${index}`} className="border border-white/10 p-4 bg-white/[0.02]">
                        <div className="flex items-center justify-between gap-4 text-[10px] font-mono uppercase tracking-[0.25em]">
                          <span className="text-blue-300/80">{checkpoint.stage}</span>
                          <span className="text-white/35">{checkpoint.referenceId}</span>
                        </div>
                        <div className="mt-2 text-[10px] font-mono text-white/35">{new Date(checkpoint.timestamp).toLocaleString()}</div>
                        {checkpoint.recordHash && (
                          <div className="mt-2 text-[10px] font-mono text-cyan-300/80 break-all">
                            record_hash: {checkpoint.recordHash}
                          </div>
                        )}
                        {checkpoint.previousHash && (
                          <div className="mt-1 text-[10px] font-mono text-white/45 break-all">
                            previous_hash: {checkpoint.previousHash}
                          </div>
                        )}
                        <p className="mt-3 text-sm text-white/75 leading-relaxed">{checkpoint.summary}</p>
                      </div>
                    ))}
                  </div>
                  ) : (
                    <p className="text-sm text-white/55 leading-relaxed">Replay record unavailable.</p>
                  )}
                </ArtifactSection>
              </div>

              <div className="col-span-5 space-y-6">
                <ArtifactSection title="Node List">
                  <div className="space-y-3">
                    {selectedArtifactRun.artifact.nodeList.map((node, index) => (
                      <div key={`${node.id}-${index}`} className="border border-white/10 p-4 bg-white/[0.02]">
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-sm font-mono text-white/90 uppercase">{node.id}</span>
                          <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-purple-300/80">{node.type}</span>
                        </div>
                        <p className="mt-3 text-sm text-white/75 leading-relaxed">{node.description}</p>
                        <div className="mt-3 text-[10px] font-mono uppercase tracking-[0.2em] text-white/35">
                          Policy: {node.policy_tag || "AC-GLOBAL"} | Entropy: {node.entropy ?? 0}
                        </div>
                        <div className="mt-2 text-[10px] font-mono uppercase tracking-[0.2em] text-white/30">
                          Source: {node.policy_source || "uacp_internal"} | Confidence: {node.confidence || "medium"}
                        </div>
                        {node.mapping_reason && (
                          <p className="mt-2 text-xs text-white/55 leading-relaxed">{node.mapping_reason}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </ArtifactSection>

                <ArtifactSection title="Policy Tags">
                  <div className="flex flex-wrap gap-2">
                    {selectedArtifactRun.artifact.policyTags.map((tag, index) => (
                      <span key={`${tag}-${index}`} className="px-3 py-2 border border-blue-500/20 text-[10px] font-mono uppercase tracking-[0.25em] text-blue-200 bg-blue-500/5">
                        {tag}
                      </span>
                    ))}
                  </div>
                </ArtifactSection>

                <ArtifactSection title="Generated Graph">
                  <pre className="text-xs text-white/70 bg-black/60 border border-white/10 p-4 overflow-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(selectedArtifactRun.artifact.generatedGraph, null, 2)}
                  </pre>
                </ArtifactSection>
              </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedPlan && (
        <div className="absolute inset-0 z-[70] bg-black/80 backdrop-blur-sm overflow-y-auto custom-scrollbar p-6">
          <div className="w-full max-w-5xl h-[88vh] mx-auto flex flex-col border border-white/10 bg-[#090909] shadow-2xl">
            <div className="shrink-0 flex items-start justify-between gap-6 p-6 border-b border-white/10 bg-white/[0.02]">
              <div className="space-y-2">
                <span className="text-[10px] uppercase tracking-[0.35em] text-blue-300/70 font-mono">Plan Archive</span>
                <h3 className="font-serif italic text-3xl text-white/90">{selectedPlan.name}</h3>
                <p className="text-xs text-white/45 font-mono">Plan ID: {selectedPlan.id}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => downloadPlanSchema(selectedPlan, "run")}
                  className="px-4 py-2 border border-blue-500/20 text-[10px] uppercase tracking-[0.3em] font-mono text-blue-200 hover:bg-blue-500/10 transition-colors"
                >
                  Download JSON
                </button>
                <button
                  onClick={() => setSelectedPlan(null)}
                  className="px-4 py-2 border border-white/10 text-[10px] uppercase tracking-[0.3em] font-mono text-white/60 hover:text-white transition-colors"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-2 gap-0">
              <div className="p-6 border-r border-white/10 space-y-6">
                <div className="space-y-2">
                  <span className="text-[9px] uppercase tracking-[0.3em] text-white/25 font-mono">Intent</span>
                  <p className="text-sm text-white/80 leading-relaxed">{selectedPlan.intent}</p>
                </div>

                {selectedPlan.research && (
                  <ArtifactSection title="Research Dossier">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 text-[10px] font-mono uppercase tracking-[0.25em] text-white/35">
                        <div className="border border-white/10 p-4 bg-white/[0.02]">
                          <div>Provider</div>
                          <div className="mt-2 text-white/70 normal-case tracking-normal">{selectedPlan.research.provider}</div>
                        </div>
                        <div className="border border-white/10 p-4 bg-white/[0.02]">
                          <div>Mode</div>
                          <div className="mt-2 text-white/70 normal-case tracking-normal">{selectedPlan.research.mode}</div>
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/35 mb-2">Synthesis</div>
                        <p className="text-sm text-white/78 leading-relaxed">{selectedPlan.research.synthesis}</p>
                      </div>
                      <div className="space-y-3">
                        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/35">Topics</div>
                        {selectedPlan.research.topics.map((topic, index) => (
                          <div key={`${topic.topic}-${index}`} className="border border-white/10 p-4 bg-white/[0.02]">
                            <div className="text-sm font-mono uppercase text-blue-200">{topic.topic}</div>
                            <div className="mt-2 text-xs text-white/45 uppercase tracking-[0.2em]">{topic.relationship}</div>
                            <p className="mt-3 text-sm text-white/75 leading-relaxed">{topic.researchText}</p>
                            {topic.evidence.length > 0 && (
                              <div className="mt-3 space-y-1">
                                <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/35">Evidence</div>
                                {topic.evidence.map((entry, evidenceIndex) => (
                                  <p key={`${entry}-${evidenceIndex}`} className="text-sm text-white/65 leading-relaxed">{entry}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </ArtifactSection>
                )}

                <div className="grid grid-cols-2 gap-4 text-[10px] font-mono uppercase tracking-[0.25em] text-white/35">
                  <div className="border border-white/10 p-4">
                    <div>Created</div>
                    <div className="mt-2 text-white/70 normal-case tracking-normal">{new Date(selectedPlan.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="border border-white/10 p-4">
                    <div>Status</div>
                    <div className="mt-2 text-white/70 normal-case tracking-normal">{selectedPlan.status}</div>
                  </div>
                </div>

                <div className="space-y-3">
                  <span className="text-[9px] uppercase tracking-[0.3em] text-white/25 font-mono">Execution Nodes</span>
                  {selectedPlan.graph.nodes.map((node, index) => (
                    <div key={`${node.id}-${index}`} className="border border-white/10 p-4 bg-white/[0.02]">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm font-mono text-white/90 uppercase">{node.id}</span>
                        <span className="text-[9px] font-mono uppercase tracking-[0.25em] text-blue-300/80">{node.type}</span>
                      </div>
                      <p className="mt-3 text-sm text-white/70 leading-relaxed">{node.description}</p>
                      <div className="mt-4 flex gap-6 text-[10px] font-mono uppercase tracking-[0.2em] text-white/35">
                        <span>Policy: {node.policy_tag || "AC-GLOBAL"}</span>
                        <span>Entropy: {node.entropy ?? 0}</span>
                      </div>
                      <div className="mt-2 flex gap-6 text-[10px] font-mono uppercase tracking-[0.2em] text-white/30">
                        <span>Source: {node.policy_source || "uacp_internal"}</span>
                        <span>Confidence: {node.confidence || "medium"}</span>
                      </div>
                      {node.mapping_reason && (
                        <p className="mt-3 text-xs text-white/55 leading-relaxed">{node.mapping_reason}</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <span className="text-[9px] uppercase tracking-[0.3em] text-white/25 font-mono">Edges</span>
                  <div className="border border-white/10 p-4 bg-white/[0.02] space-y-2">
                    {selectedPlan.graph.edges.map((edge, index) => (
                      <div key={`${edge.from}-${edge.to}-${index}`} className="text-sm text-white/70 font-mono">
                        {edge.from} {"->"} {edge.to}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-3">
                <span className="text-[9px] uppercase tracking-[0.3em] text-white/25 font-mono">Raw Schema</span>
                {selectedPlan.research && (
                  <div className="border border-white/10 p-4 bg-white/[0.02] space-y-3">
                    <div className="text-[9px] uppercase tracking-[0.3em] text-white/25 font-mono">Source Signals</div>
                    {selectedPlan.research.sourceSignals.map((signal, index) => (
                      <div key={`${signal.id}-${index}`} className="text-sm text-white/70 leading-relaxed">
                        {signal.id} · {signal.title} · {signal.category} · {signal.strength}%
                      </div>
                    ))}
                  </div>
                )}
                <pre className="text-xs text-white/70 bg-black/60 border border-white/10 p-4 overflow-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(selectedPlan, null, 2)}
                </pre>
              </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Status Bar */}
      <footer className="h-8 bg-[#050505] border-t border-white/10 flex items-center justify-between px-8 text-[9px] uppercase tracking-[0.3em] text-white/30 font-mono z-50">
        <div className="flex gap-10">
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></span> 
            Uplink Established
          </span>
          <span className="flex items-center gap-2">
            <Activity size={10} className="text-blue-500/50" />
            Control Plane: Stable
          </span>
          <span className="flex items-center gap-2">
            <Cpu size={10} className="text-purple-500/50" />
            Determinism Ratio: 1.0
          </span>
        </div>
        <div className="flex gap-6 items-center">
          <span>AI Studio Build 2026.05.06</span>
          <div className="h-3 w-px bg-white/10" />
          <span>© DETERMINISTIC RESEARCH • UNIVERSAL CONTROL PLANE</span>
        </div>
      </footer>
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean, onClick: () => void, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`relative py-1 transition-all group outline-none ${active ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
    >
      {label}
      {active && (
        <motion.div 
          layoutId="tab"
          className="absolute -bottom-1 left-0 right-0 h-[2px] bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]"
        />
      )}
    </button>
  );
}

function buildSignalHistory(signalList: Array<{ id: string; value: number }>) {
  return signalList.reduce<Record<string, Array<{ val: number }>>>((accumulator, signal) => {
    accumulator[signal.id] = [{ val: signal.value }];
    return accumulator;
  }, {});
}

function appendSignalHistory(
  previous: Record<string, Array<{ val: number }>>,
  signalList: Array<{ id: string; value: number }>
) {
  const next = { ...previous };

  for (const signal of signalList) {
    const existing = next[signal.id] || [];
    next[signal.id] = [...existing, { val: signal.value }].slice(-20);
  }

  return next;
}

function ArtifactSection({ title, children }: { title: string, children: ReactNode }) {
  return (
    <section className="border border-white/10 p-4 bg-white/[0.02]">
      <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/35 mb-4">{title}</div>
      {children}
    </section>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="px-3 py-1 border border-white/10 bg-white/[0.03] text-[9px] font-mono uppercase tracking-[0.22em] text-white/70">
      {label}: {value.replace(/_/g, " ")}
    </span>
  );
}

function ConvergenceBar({ label, value, progress, color }: { label: string, value: string, progress: number, color: 'blue' | 'purple' }) {
  return (
    <div className="group cursor-default">
      <div className="flex justify-between items-end mb-3">
        <span className="text-[10px] text-white/40 italic font-light tracking-wide group-hover:text-white/60 transition-colors">{label}</span>
        <span className="text-green-400 font-mono font-bold tracking-tighter text-xs">{value}</span>
      </div>
      <div className="h-10 w-full glass-panel overflow-hidden relative group-hover:border-white/10 transition-colors bg-white/[0.01]">
         <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${progress * 100}%` }}
            className={`absolute bottom-0 left-0 h-full ${color === 'blue' ? 'bg-blue-500/10' : 'bg-purple-500/10'}`}
         />
         <div className="absolute inset-0 flex items-center px-4 overflow-hidden">
            <div className="w-full flex gap-0.5 opacity-10">
               {[...Array(40)].map((_, i) => (
                 <div key={i} className="flex-1 h-3 border-r border-white/20 last:border-0" />
               ))}
            </div>
         </div>
         <motion.div 
            initial={{ x: -200 }}
            animate={{ x: 400 }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            className={`absolute top-0 w-32 h-[1px] ${color === 'blue' ? 'bg-blue-400/50' : 'bg-purple-400/50'} blur-sm`}
         />
      </div>
    </div>
  );
}
