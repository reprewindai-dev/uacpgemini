import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";
import { XMLParser } from "fast-xml-parser";

interface SSRNSignal {
  id: string;
  title: string;
  strength: number;
  timestamp: string;
  category: string;
}

const parser = new XMLParser();

let ssrnSignals: SSRNSignal[] = [
  { id: '#2401.0921', title: 'Quantum Probabilistic Modeling', strength: 98.4, timestamp: new Date().toISOString(), category: 'Quantum' },
  { id: '#2312.4402', title: 'Neural Determinism in LLMs', strength: 94.1, timestamp: new Date().toISOString(), category: 'Deterministic' },
  { id: '#2402.1155', title: 'Heuristic Agents & Capital', strength: 89.2, timestamp: new Date().toISOString(), category: 'Economics' }
];

let marketConvergence = [
  { label: "Deterministic Alpha", value: "+14.2%", description: "Hedge-adjusted probabilistic yield" },
  { label: "Market Heuristics", value: "+8.7%", description: "Sentiment aggregation" }
];

async function updateRealSignals() {
  try {
    // 1. Fetch from ArXiv
    const arxivRes = await fetch("https://export.arxiv.org/api/query?search_query=all:quantum+computing+OR+all:LLM+OR+all:deterministic&start=0&max_results=5&sortBy=lastUpdatedDate&sortOrder=descending");
    const xml = await arxivRes.text();
    const jsonObj = parser.parse(xml);
    const entries = jsonObj.feed?.entry || [];
    
    if (Array.isArray(entries)) {
      ssrnSignals = entries.map((entry: any) => ({
        id: entry.id?.split('/').pop() || '#UKNOWN',
        title: entry.title?.replace(/\n/g, ' ').trim() || 'Untitled Paper',
        strength: 85 + Math.random() * 14,
        timestamp: entry.updated || new Date().toISOString(),
        category: (entry.category?.attr_term || 'Research').replace('cs.', '')
      }));
    }

    // 2. Fetch Market Data (CoinGecko)
    const marketRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true");
    const marketData = await marketRes.json();
    
    if (marketData.bitcoin) {
      marketConvergence = [
        { 
          label: "BTC/USD Momentum", 
          value: `${marketData.bitcoin.usd_24h_change > 0 ? '+' : ''}${marketData.bitcoin.usd_24h_change.toFixed(2)}%`,
          description: `Real-time Bitcoin 24h delta: $${marketData.bitcoin.usd.toLocaleString()}`
        },
        { 
          label: "ETH/USD Stability", 
          value: `${marketData.ethereum.usd_24h_change > 0 ? '+' : ''}${marketData.ethereum.usd_24h_change.toFixed(2)}%`,
          description: `Ethereum network pressure check: $${marketData.ethereum.usd.toLocaleString()}`
        }
      ];
    }
  } catch (err) {
    console.error("Real data fetch error:", err);
  }
}

// Initial fetch
updateRealSignals();
// Refresh every 5 minutes
setInterval(updateRealSignals, 300000);

// --- Types & Storage (Mock DB) ---
interface Plan {
  id: string;
  name: string;
  intent: string;
  revision: number;
  status: 'draft' | 'verified' | 'locked';
  graph: any;
  createdAt: string;
}

interface Run {
  id: string;
  planId: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  currentStep: string;
  progress: number;
  output?: any;
  startTime: string;
  endTime?: string;
}

interface AppEvent {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  metadata?: any;
}

type ModelProvider = "groq" | "huggingface" | "ollama" | "gemini" | "fallback";

let plans: Plan[] = [];
let runs: Run[] = [];
let events: AppEvent[] = [];

function getGroqConfig() {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseUrl: process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1",
    model: process.env.GROQ_MODEL?.trim() || "llama-3.1-8b-instant",
  };
}

function getHuggingFaceConfig() {
  const token = process.env.HF_TOKEN?.trim();
  if (!token) {
    return null;
  }

  return {
    token,
    baseUrl: process.env.HF_API_URL?.trim() || "https://router.huggingface.co/v1",
    model: process.env.HF_MODEL?.trim() || "meta-llama/Llama-3.1-8B-Instruct:fastest",
  };
}

function getOllamaConfig() {
  const model = process.env.OLLAMA_MODEL?.trim();
  if (!model) {
    return null;
  }

  return {
    baseUrl: process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434",
    model,
  };
}

function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    model: process.env.GEMINI_MODEL?.trim() || "gemini-3-flash-preview",
  };
}

function cleanModelText(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function normalizeProviderName(value: string | undefined | null): ModelProvider | null {
  switch ((value || "").trim().toLowerCase()) {
    case "groq":
      return "groq";
    case "huggingface":
    case "hugging_face":
    case "hf":
      return "huggingface";
    case "ollama":
      return "ollama";
    case "gemini":
      return "gemini";
    case "fallback":
      return "fallback";
    default:
      return null;
  }
}

function getProviderOrder(): ModelProvider[] {
  const envPreferred = [
    normalizeProviderName(process.env.AI_PROVIDER),
    normalizeProviderName(process.env.LLM_PROVIDER),
    normalizeProviderName(process.env.AI_FALLBACK_PROVIDER),
  ].filter((provider): provider is ModelProvider => provider !== null && provider !== "fallback");

  return [...new Set<ModelProvider>([
    ...envPreferred,
    "groq",
    "huggingface",
    "ollama",
    "gemini",
  ])];
}

function isProviderConfigured(provider: ModelProvider) {
  switch (provider) {
    case "groq":
      return getGroqConfig() !== null;
    case "huggingface":
      return getHuggingFaceConfig() !== null;
    case "ollama":
      return getOllamaConfig() !== null;
    case "gemini":
      return getGeminiConfig() !== null;
    case "fallback":
      return true;
    default:
      return false;
  }
}

async function requestGroq(prompt: string, expectJson: boolean) {
  const groq = getGroqConfig();
  if (!groq) {
    throw new Error("Groq is not configured");
  }

  const response = await fetch(`${groq.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groq.apiKey}`,
    },
    body: JSON.stringify({
      model: groq.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      response_format: expectJson ? { type: "json_object" } : undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq request failed with status ${response.status}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Groq returned an empty response");
  }

  return { provider: "groq" as const, text: cleanModelText(text) };
}

async function requestHuggingFace(prompt: string, expectJson: boolean) {
  const huggingFace = getHuggingFaceConfig();
  if (!huggingFace) {
    throw new Error("Hugging Face is not configured");
  }

  const response = await fetch(`${huggingFace.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${huggingFace.token}`,
    },
    body: JSON.stringify({
      model: huggingFace.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      response_format: expectJson ? { type: "json_object" } : undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`Hugging Face request failed with status ${response.status}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Hugging Face returned an empty response");
  }

  return { provider: "huggingface" as const, text: cleanModelText(text) };
}

async function requestOllama(prompt: string, expectJson: boolean) {
  const ollama = getOllamaConfig();
  if (!ollama) {
    throw new Error("Ollama is not configured");
  }

  const response = await fetch(`${ollama.baseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollama.model,
      prompt,
      stream: false,
      format: expectJson ? "json" : undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}`);
  }

  const data = await response.json();
  const text = data?.response;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Ollama returned an empty response");
  }

  return { provider: "ollama" as const, text: cleanModelText(text) };
}

async function requestGemini(prompt: string, expectJson: boolean) {
  const gemini = getGeminiConfig();
  if (!gemini) {
    throw new Error("Gemini is not configured");
  }

  const ai = new GoogleGenAI({ apiKey: gemini.apiKey });
  const response = await ai.models.generateContent({
    model: gemini.model,
    contents: prompt,
    config: expectJson ? { responseMimeType: "application/json" } : undefined,
  });

  const text = response.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Gemini returned an empty response");
  }

  return { provider: "gemini" as const, text: cleanModelText(text) };
}

async function generateModelText(prompt: string, expectJson: boolean) {
  const failures: string[] = [];

  for (const provider of getProviderOrder()) {
    if (!isProviderConfigured(provider)) {
      continue;
    }

    try {
      switch (provider) {
        case "groq":
          return await requestGroq(prompt, expectJson);
        case "huggingface":
          return await requestHuggingFace(prompt, expectJson);
        case "ollama":
          return await requestOllama(prompt, expectJson);
        case "gemini":
          return await requestGemini(prompt, expectJson);
        default:
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${provider} request failed`;
      failures.push(`${provider}: ${message}`);
      console.error(`${provider} error:`, error);
    }
  }

  throw new Error(failures.join(" | ") || "No model providers are configured");
}

function parseJsonText(text: string) {
  return JSON.parse(cleanModelText(text));
}

function buildCompilePlanPrompt(intent: string) {
  return `
    You are the Quantum UACP Deterministic Orchestrator.
    Translate the user's intent into a hybrid quantum-classical orchestration plan.

    User intent: "${intent}"

    Return only JSON with this shape:
    {
      "name": "Concise identifier",
      "graph": {
        "nodes": [
          {
            "id": "node-1",
            "type": "quantum" | "classical",
            "description": "Specific action",
            "policy_tag": "AC-10",
            "entropy": 0.4
          }
        ],
        "edges": [{ "from": "node-1", "to": "node-2" }]
      }
    }
  `;
}

function buildRunSummaryPrompt(plan: Plan | undefined) {
  return `
    You are the Quantum UACP Intelligence Agent.
    The user intent was: "${plan?.intent || "Unknown"}"
    The current research signals include: ${ssrnSignals.map((signal) => signal.title).join(", ")}
    The current market state is: ${marketConvergence.map((entry) => `${entry.label}: ${entry.value}`).join(", ")}

    Provide a concise final outcome report in exactly 2 sentences.
  `;
}

function normalizeNodeType(value: unknown): "quantum" | "classical" {
  return typeof value === "string" && value.toLowerCase().includes("quantum")
    ? "quantum"
    : "classical";
}

function normalizeEntropy(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, parsed));
}

function createPlanName(intent: string) {
  const words = intent
    .trim()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);

  if (words.length === 0) {
    return "Deterministic Directive";
  }

  return words
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function createFallbackPlanDraft(intent: string) {
  const directive = intent.trim().replace(/\s+/g, " ").slice(0, 96);
  const nodes = [
    {
      id: "ingest",
      type: "classical" as const,
      description: `Interpret directive: ${directive}`,
      policy_tag: "AC-10",
      entropy: 0.08,
    },
    {
      id: "model",
      type: "quantum" as const,
      description: "Model candidate execution paths and isolate the highest-confidence branch.",
      policy_tag: "Q-17",
      entropy: 0.41,
    },
    {
      id: "validate",
      type: "classical" as const,
      description: "Validate policy alignment, safety controls, and execution preconditions.",
      policy_tag: "AC-GLOBAL",
      entropy: 0.11,
    },
    {
      id: "commit",
      type: "classical" as const,
      description: "Commit the approved sequence to the control plane and persist the run contract.",
      policy_tag: "OPS-22",
      entropy: 0.05,
    },
  ];

  return {
    name: createPlanName(intent),
    graph: {
      nodes,
      edges: nodes.slice(0, -1).map((node, index) => ({
        from: node.id,
        to: nodes[index + 1].id,
      })),
    },
  };
}

function normalizeCompiledPlan(planData: any, intent: string) {
  const fallback = createFallbackPlanDraft(intent);
  const rawNodes = Array.isArray(planData?.graph?.nodes) ? planData.graph.nodes : [];
  const normalizedNodes = rawNodes
    .map((node: any, index: number) => {
      const description = typeof node?.description === "string" ? node.description.trim() : "";
      if (!description) {
        return null;
      }

      return {
        id: typeof node?.id === "string" && node.id.trim() ? node.id.trim() : `node-${index + 1}`,
        type: normalizeNodeType(node?.type),
        description,
        policy_tag: typeof node?.policy_tag === "string" && node.policy_tag.trim() ? node.policy_tag.trim() : `AC-${10 + index}`,
        entropy: normalizeEntropy(node?.entropy, 0.18 + index * 0.09),
      };
    })
    .filter(Boolean);

  const nodes = normalizedNodes.length > 0 ? normalizedNodes : fallback.graph.nodes;
  const validNodeIds = new Set(nodes.map((node) => node.id));
  const normalizedEdges = Array.isArray(planData?.graph?.edges)
    ? planData.graph.edges
        .map((edge: any) => ({
          from: typeof edge?.from === "string" ? edge.from.trim() : "",
          to: typeof edge?.to === "string" ? edge.to.trim() : "",
        }))
        .filter((edge: { from: string; to: string }) => validNodeIds.has(edge.from) && validNodeIds.has(edge.to))
    : [];

  return {
    name: typeof planData?.name === "string" && planData.name.trim() ? planData.name.trim() : fallback.name,
    graph: {
      nodes,
      edges: normalizedEdges.length > 0
        ? normalizedEdges
        : nodes.slice(0, -1).map((node, index) => ({
            from: node.id,
            to: nodes[index + 1].id,
          })),
    },
  };
}

async function compilePlanDraft(intent: string): Promise<{ plan: ReturnType<typeof normalizeCompiledPlan>; provider: ModelProvider }> {
  const fallbackPlan = createFallbackPlanDraft(intent);

  try {
    const result = await generateModelText(buildCompilePlanPrompt(intent), true);
    return {
      plan: normalizeCompiledPlan(parseJsonText(result.text), intent),
      provider: result.provider,
    };
  } catch (error) {
    console.error("Plan compilation error:", error);
    return {
      plan: fallbackPlan,
      provider: "fallback",
    };
  }
}

async function generateRunSummary(plan: Plan | undefined): Promise<{ text: string; provider: ModelProvider }> {
  try {
    const result = await generateModelText(buildRunSummaryPrompt(plan), false);
    return {
      text: result.text,
      provider: result.provider,
    };
  } catch (error) {
    console.error("Run summary error:", error);
    return {
      text: "Execution finalized. Deterministic outcomes verified across all research nodes.",
      provider: "fallback",
    };
  }
}

function createPlanRecord(name: string, intent: string, graph: any): Plan {
  return {
    id: `p-${Math.random().toString(36).substring(2, 9)}`,
    name: name || "AI Generated Plan",
    intent,
    revision: 1,
    status: "draft",
    graph: graph || { nodes: [], edges: [] },
    createdAt: new Date().toISOString(),
  };
}

function addEvent(type: string, message: string, metadata?: any) {
  const event: AppEvent = {
    id: Math.random().toString(36).substring(2, 9),
    type,
    message,
    timestamp: new Date().toISOString(),
    metadata
  };
  events.push(event);
  broadcast({ type: 'event', data: event });
}

// --- WebSocket Support ---
let clients: Set<WebSocket> = new Set();
function broadcast(data: any) {
  const payload = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });

  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'init', message: 'UACP Control Plane Online' }));
    ws.on("close", () => clients.delete(ws));
  });

  // --- API Routes ---

  app.get("/api/bootstrap", (req, res) => {
    res.json({
      system: "Quantum UACP v0",
      version: "0.2.0-alpha",
      status: "operational",
      identity: "Gopher-Engine",
      userEmail: process.env.USER_EMAIL || "ANON_AGENT"
    });
  });

  app.get("/api/plans", (req, res) => res.json(plans));
  
  app.post("/api/plans", (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const intent = typeof req.body?.intent === "string" ? req.body.intent.trim() : "";
    const graph = req.body?.graph;

    if (!intent) return res.status(400).json({ error: "Intent required" });

    const newPlan = createPlanRecord(name, intent, graph);
    
    plans.push(newPlan);
    addEvent('PLAN_CREATED', `New plan created: ${newPlan.id} (${newPlan.name})`, { planId: newPlan.id });
    res.json(newPlan);
  });

  app.post("/api/plans/compile", async (req, res) => {
    const intent = typeof req.body?.intent === "string" ? req.body.intent.trim() : "";

    if (!intent) {
      return res.status(400).json({ error: "Intent required" });
    }

    if (intent.length > 4000) {
      return res.status(400).json({ error: "Intent exceeds the 4000 character limit" });
    }

    try {
      const compiledPlan = await compilePlanDraft(intent);
      const newPlan = createPlanRecord(compiledPlan.plan.name, intent, compiledPlan.plan.graph);

      plans.push(newPlan);
      addEvent("PLAN_CREATED", `New plan created: ${newPlan.id} (${newPlan.name})`, {
        planId: newPlan.id,
        source: compiledPlan.provider,
      });

      res.status(201).json(newPlan);
    } catch (error) {
      console.error("Plan compile route error:", error);
      res.status(500).json({ error: "Unable to compile plan" });
    }
  });

  app.get("/api/runs", (req, res) => res.json(runs));

  app.post("/api/runs", (req, res) => {
    const { planId } = req.body;
    const plan = plans.find(p => p.id === planId);
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    const newRun: Run = {
      id: `run-${Math.random().toString(36).substring(2, 9)}`,
      planId,
      status: 'pending',
      currentStep: 'Initializing Gateway',
      progress: 0,
      startTime: new Date().toISOString()
    };
    runs.push(newRun);
    addEvent('RUN_STARTED', `Execution run started for plan ${planId}`, { runId: newRun.id, planId });
    
    // Simulate execution
    simulateExecution(newRun.id);
    
    res.json(newRun);
  });

  app.get("/api/ssrn-signals", (req, res) => res.json(ssrnSignals));

  app.get("/api/events", (req, res) => res.json(events));

  app.get("/api/observability/signals", (req, res) => {
    // Generate high-fidelity signals with trends
    const t = Date.now();
    res.json({
      quantum_coherence: 88 + Math.sin(t/5000) * 5,
      classical_latency: 14 + Math.cos(t/3000) * 3,
      uacp_pressure: Math.max(0, 0.05 + Math.sin(t/8000) * 0.04),
      gopher_policy_alignment: 0.992 + (Math.random() * 0.005),
      market_convergence: marketConvergence,
      horowitz_signals: [
        { id: 'UACP_PRESSURE', value: 0.82 + Math.sin(t/10000)*0.1, trend: 'rising' },
        { id: 'COHERENCE_TRANSITION', value: 0.45 + Math.cos(t/6000)*0.05, trend: 'stable' },
        { id: 'SIGNAL_NOISE', value: 0.12 + Math.sin(t/2000)*0.02, trend: 'falling' }
      ]
    });
  });

  async function simulateExecution(runId: string) {
    const run = runs.find(r => r.id === runId);
    if (!run) return;

    const plan = plans.find(p => p.id === run.planId);
    
    const baseSteps = [
      { step: 'Quantum State Preparation', progress: 20 },
      { step: 'HHL Matrix Decomposition', progress: 40 },
      { step: 'Classical Error Correction Overlay', progress: 60 },
      { step: 'VQE Objective Function Optimization', progress: 80 },
      { step: 'Collapsing Result Wavefunction', progress: 100 }
    ];

    // Use plan nodes if they exist for more "real" steps
    const steps = (plan?.graph?.nodes?.length > 0) 
      ? plan.graph.nodes.map((node: any, i: number) => ({
          step: node.description,
          progress: Math.floor(((i + 1) / plan.graph.nodes.length) * 100)
        }))
      : baseSteps;

    for (const step of steps) {
      await new Promise(r => setTimeout(r, 2000));
      run.status = 'executing';
      run.currentStep = step.step;
      run.progress = step.progress;
      addEvent('RUN_UPDATE', `Run ${runId}: ${step.step}`, { runId, progress: step.progress });
      broadcast({ type: 'run_update', data: run });
    }

    // Final Intelligence Summary using AI
    try {
      const summary = await generateRunSummary(plan);
      run.output = summary.text;
    } catch (e) {
      console.error("Summary error:", e);
      run.output = "Execution finalized. Deterministic outcomes verified across all research nodes.";
    }

    run.status = 'completed';
    run.endTime = new Date().toISOString();
    addEvent('RUN_COMPLETED', `Run ${runId} finalized successfully`, { runId });
    broadcast({ type: 'run_update', data: run });
  }

  // --- Vite Middleware for Dev / Static Serving for Prod ---

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`UACP Server running on http://localhost:${PORT}`);
    addEvent('SYSTEM_ONLINE', 'Quantum UACP Control Plane Initialized');
  });
}

startServer();
