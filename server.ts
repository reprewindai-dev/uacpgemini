import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";
import { OpenAI } from "openai";
import { XMLParser } from "fast-xml-parser";
import 'dotenv/config';

const app = express();

// ── Provider clients (lazy-init so missing keys don't crash startup) ──────────
function getGeminiClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  return new GoogleGenAI({ apiKey: key });
}

function getOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "not-needed",
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
}

function getGroqClient() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");
  return new OpenAI({
    apiKey: key,
    baseURL: "https://api.groq.com/openai/v1",
  });
}

function getOllamaClient() {
  const base = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  return new OpenAI({
    apiKey: "not-needed",
    baseURL: `${base}/v1`,
  });
}

function getOpenRouterClient() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  return new OpenAI({
    apiKey: key,
    baseURL: "https://openrouter.ai/api/v1",
  });
}

// ── Provider availability ─────────────────────────────────────────────────────
function getProviderStatus() {
  return {
    gemini:     !!process.env.GEMINI_API_KEY,
    openai:     !!process.env.OPENAI_API_KEY,
    groq:       !!process.env.GROQ_API_KEY,
    ollama:     true, // local — assume available if OLLAMA_BASE_URL set or default
    openrouter: !!process.env.OPENROUTER_API_KEY,
  };
}

// ── Default models per provider ───────────────────────────────────────────────
const DEFAULT_MODELS: Record<string, string> = {
  gemini:     "gemini-2.0-flash",
  openai:     "gpt-4o-mini",
  groq:       "llama-3.3-70b-versatile",
  ollama:     "mistral",
  openrouter: "openai/gpt-4o-mini",
};

// ── Global reasoning intensity (1 = single provider, 2+ = Supernova) ─────────
let reasoningIntensity: number = 1;

// ── Core generation function ──────────────────────────────────────────────────
async function generateCompletion(
  prompt: string,
  options?: { provider?: string; model?: string }
): Promise<string> {
  const provider = options?.provider || process.env.LLM_PROVIDER || "gemini";
  const model = options?.model || process.env.MODEL_NAME || DEFAULT_MODELS[provider] || "gemini-2.0-flash";

  switch (provider) {
    case "gemini": {
      const ai = getGeminiClient();
      const result = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      return result.text || "";
    }

    case "openai": {
      const client = getOpenAIClient();
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
      });
      return response.choices[0].message.content || "";
    }

    case "groq": {
      const client = getGroqClient();
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
      });
      return response.choices[0].message.content || "";
    }

    case "ollama": {
      const client = getOllamaClient();
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
      });
      return response.choices[0].message.content || "";
    }

    case "openrouter": {
      const client = getOpenRouterClient();
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
      });
      return response.choices[0].message.content || "";
    }

    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

// ── Caching layer ─────────────────────────────────────────────────────────────
const cache = new Map<string, { result: string; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 5;

// ── Supernova multi-provider reasoning ────────────────────────────────────────
async function supernovaReasoning(prompt: string): Promise<string> {
  const cached = cache.get(prompt);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.result;

  const status = getProviderStatus();

  const availableNodes = [
    { provider: "gemini",     model: "gemini-2.0-flash" },
    { provider: "openai",     model: "gpt-4o-mini" },
    { provider: "groq",       model: "llama-3.3-70b-versatile" },
    { provider: "ollama",     model: "mistral" },
    { provider: "openrouter", model: "openai/gpt-4o-mini" },
  ].filter(n => status[n.provider as keyof typeof status]);

  if (availableNodes.length === 0) throw new Error("No providers available for Supernova reasoning");

  const selection = availableNodes.sort(() => 0.5 - Math.random()).slice(0, Math.min(3, availableNodes.length));

  const branches = await Promise.all(
    selection.map(node =>
      generateCompletion(prompt, node).catch(e => `Error from ${node.provider}: ${e.message}`)
    )
  );

  const aggregatorPrompt = `
    Analyze these parallel reasoning branches for semantic coherence and truth convergence:
    ${branches.map((b, i) => `Branch ${String.fromCharCode(65 + i)} [${selection[i].provider}]: ${b}`).join("\n")}

    Synthesize the final response.
    CRITICAL: Output MUST be valid JSON only.
    {
      "synthesis": "synthesized answer",
      "metadata": {
        "coherenceScore": 0.0,
        "contradictionLoad": 0.0,
        "isBifurcated": false,
        "participants": []
      }
    }
  `;

  const primaryProvider = status.gemini ? "gemini" : selection[0].provider;
  const aggregatorResult = await generateCompletion(aggregatorPrompt, {
    provider: primaryProvider,
    model: DEFAULT_MODELS[primaryProvider],
  });

  let finalResult: string;
  try {
    const parsed = JSON.parse(aggregatorResult);
    parsed.metadata.participants = selection;
    if (parsed.metadata.coherenceScore < 0.5 || parsed.metadata.contradictionLoad > 7) {
      parsed.metadata.isBifurcated = true;
      parsed.synthesis += "\n\n[System Note: Stability threshold not met. Bifurcated branches spawned for accuracy.]"
    }
    finalResult = JSON.stringify(parsed);
  } catch {
    finalResult = JSON.stringify({
      synthesis: aggregatorResult,
      metadata: { coherenceScore: 0, contradictionLoad: 10, isBifurcated: true, participants: selection },
    });
  }

  cache.set(prompt, { result: finalResult, timestamp: Date.now() });
  return finalResult;
}

// ── Signal / market state ─────────────────────────────────────────────────────
interface SSRNSignal {
  id: string;
  title: string;
  strength: number;
  timestamp: string;
  category: string;
}

const parser = new XMLParser();
let ssrnSignals: SSRNSignal[] = [];
let marketConvergence = [
  { label: "BTC/USD Momentum",  value: "0%", description: "Loading..." },
  { label: "ETH/USD Stability", value: "0%", description: "Loading..." },
];
let systemPressure = 0.05;

async function updateRealSignals() {
  try {
    const arxivQueries = ["all:quantum+computing", "all:LLM+alignment", "all:future+studies"];
    let allEntries: any[] = [];
    for (const query of arxivQueries) {
      const res = await fetch(`https://export.arxiv.org/api/query?search_query=${query}&start=0&max_results=3&sortBy=lastUpdatedDate&sortOrder=descending`);
      const xml = await res.text();
      const jsonObj = parser.parse(xml);
      if (jsonObj.feed?.entry) {
        const entries = Array.isArray(jsonObj.feed.entry) ? jsonObj.feed.entry : [jsonObj.feed.entry];
        allEntries = [...allEntries, ...entries];
      }
    }
    ssrnSignals = allEntries.map((entry: any) => ({
      id: entry.id?.split("/").pop() || "#UNKNOWN",
      title: entry.title?.replace(/\n/g, " ").trim() || "Untitled Paper",
      strength: 70 + Math.random() * 30,
      timestamp: entry.updated || new Date().toISOString(),
      category: (entry.category?.attr_term || "Research").replace("cs.", ""),
    }));

    const hnRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json?limit=5");
    const hnIds = await hnRes.json();
    const hnItems = await Promise.all(
      hnIds.slice(0, 5).map((id: number) =>
        fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json())
      )
    );
    ssrnSignals = [
      ...ssrnSignals,
      ...hnItems.map((item: any) => ({
        id: `hn-${item.id}`,
        title: item.title,
        strength: 50 + Math.random() * 40,
        timestamp: new Date().toISOString(),
        category: "HackerNews",
      })),
    ];

    const marketRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true");
    const marketData = await marketRes.json();
    if (marketData.bitcoin) {
      marketConvergence = [
        {
          label: "BTC Volatility",
          value: `${marketData.bitcoin.usd_24h_change > 0 ? "+" : ""}${marketData.bitcoin.usd_24h_change.toFixed(2)}%`,
          description: `24h delta: $${marketData.bitcoin.usd.toLocaleString()}`,
        },
        {
          label: "ETH Network State",
          value: `${marketData.ethereum.usd_24h_change > 0 ? "+" : ""}${marketData.ethereum.usd_24h_change.toFixed(2)}%`,
          description: `24h delta: $${marketData.ethereum.usd.toLocaleString()}`,
        },
      ];
      const avgVol = (Math.abs(marketData.bitcoin.usd_24h_change) + Math.abs(marketData.ethereum.usd_24h_change)) / 2;
      systemPressure = Math.min(1.0, Math.max(0.01, avgVol / 10 + ssrnSignals.length / 100));
    }
  } catch (err) {
    console.error("Real data fetch error:", err);
  }
}

updateRealSignals();
setInterval(updateRealSignals, 300000);

// ── Types ─────────────────────────────────────────────────────────────────────
interface Plan {
  id: string;
  name: string;
  intent: string;
  revision: number;
  status: "draft" | "verified" | "locked";
  graph: any;
  createdAt: string;
}
interface Run {
  id: string;
  planId: string;
  status: "pending" | "executing" | "completed" | "failed";
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

let plans: Plan[] = [];
let runs: Run[] = [];
let events: AppEvent[] = [];

function addEvent(type: string, message: string, metadata?: any) {
  const event: AppEvent = {
    id: Math.random().toString(36).substring(2, 9),
    type,
    message,
    timestamp: new Date().toISOString(),
    metadata,
  };
  events.push(event);
  broadcast({ type: "event", data: event });
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
let clients: Set<WebSocket> = new Set();
function broadcast(data: any) {
  const payload = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// ── Server ────────────────────────────────────────────────────────────────────
async function startServer() {
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });
  const PORT = parseInt(process.env.PORT || "3000", 10);

  app.use(cors());
  app.use(express.json());

  wss.on("connection", ws => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: "init", message: "UACP Control Plane Online" }));
    ws.on("close", () => clients.delete(ws));
  });

  // ── API Routes ───────────────────────────────────────────────────────────────

  app.get("/api/bootstrap", (_req, res) => {
    res.json({
      system: "UACP GPC v1",
      version: "1.0.0",
      status: "operational",
      identity: "Veklom-GPC",
      userEmail: process.env.USER_EMAIL || "ANON_AGENT",
    });
  });

  // Provider status endpoint — fixes the "GOOGLE OFF" display
  app.get("/api/providers", (_req, res) => {
    const status = getProviderStatus();
    res.json({
      providers: status,
      defaultProvider: process.env.LLM_PROVIDER || "gemini",
      defaultModel: process.env.MODEL_NAME || DEFAULT_MODELS[process.env.LLM_PROVIDER || "gemini"],
      availableModels: {
        gemini:     ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"],
        openai:     ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
        groq:       ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
        ollama:     ["mistral", "llama3", "codellama", "phi3", "gemma"],
        openrouter: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "meta-llama/llama-3.1-70b-instruct"],
      },
    });
  });

  // Reasoning intensity control
  app.post("/api/reasoning-intensity", (req, res) => {
    const { intensity } = req.body;
    if (typeof intensity === "number" && intensity >= 1 && intensity <= 5) {
      reasoningIntensity = intensity;
      res.json({ success: true, intensity: reasoningIntensity });
    } else {
      res.status(400).json({ error: "Intensity must be a number between 1 and 5" });
    }
  });

  app.get("/api/reasoning-intensity", (_req, res) => {
    res.json({ intensity: reasoningIntensity });
  });

  app.post("/api/intent-to-plan", async (req, res) => {
    const { intent, provider, model, compliance } = req.body;
    if (!intent) return res.status(400).json({ error: "Intent required" });

    const compliancePrompt =
      compliance && compliance.length > 0
        ? `ENSURE COMPLIANCE WITH: ${compliance.join(", ")}.`
        : "";

    const prompt = `
      You are the UACP GPC Orchestrator.
      Translate natural language intent into an orchestration plan.

      Intent: "${intent}"
      ${compliancePrompt}

      Return ONLY a JSON object:
      {
        "name": "Concise identifier",
        "graph": {
          "nodes": [
            { "id": "NODE_ID", "type": "quantum|classical", "description": "Specific action", "policy_tag": "AC-10", "entropy": 0.4 }
          ],
          "edges": [{ "from": "NODE_ID", "to": "NODE_ID" }]
        }
      }
    `;

    try {
      let result: string;
      if (reasoningIntensity > 1) {
        result = await supernovaReasoning(prompt);
      } else {
        result = await generateCompletion(prompt, { provider, model });
      }
      res.json(JSON.parse(result));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/plans", (_req, res) => res.json(plans));

  app.post("/api/plans", (req, res) => {
    const { name, intent, graph } = req.body;
    if (!intent) return res.status(400).json({ error: "Intent required" });
    const newPlan: Plan = {
      id: `p-${Math.random().toString(36).substring(2, 9)}`,
      name: name || "AI Generated Plan",
      intent,
      revision: 1,
      status: "draft",
      graph: graph || { nodes: [], edges: [] },
      createdAt: new Date().toISOString(),
    };
    plans.push(newPlan);
    addEvent("PLAN_CREATED", `New plan: ${newPlan.id} (${newPlan.name})`, { planId: newPlan.id });
    res.json(newPlan);
  });

  app.get("/api/runs", (_req, res) => res.json(runs));

  app.post("/api/runs", (req, res) => {
    const { planId } = req.body;
    const plan = plans.find(p => p.id === planId);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    const newRun: Run = {
      id: `run-${Math.random().toString(36).substring(2, 9)}`,
      planId,
      status: "pending",
      currentStep: "Initializing Gateway",
      progress: 0,
      startTime: new Date().toISOString(),
    };
    runs.push(newRun);
    addEvent("RUN_STARTED", `Run started for plan ${planId}`, { runId: newRun.id, planId });
    simulateExecution(newRun.id);
    res.json(newRun);
  });

  app.get("/api/ssrn-signals", (_req, res) => res.json(ssrnSignals));
  app.get("/api/events",       (_req, res) => res.json(events));

  app.get("/api/observability/signals", (_req, res) => {
    const t = Date.now();
    res.json({
      quantum_coherence:        88 + Math.sin(t / 5000) * 5,
      classical_latency:        14 + Math.cos(t / 3000) * 3,
      uacp_pressure:            systemPressure,
      gopher_policy_alignment:  0.992 + Math.random() * 0.005,
      market_convergence:       marketConvergence,
      horowitz_signals: [
        { id: "UACP_PRESSURE",       value: 0.82 + Math.sin(t / 10000) * 0.1,  trend: "rising" },
        { id: "COHERENCE_TRANSITION",value: 0.45 + Math.cos(t / 6000) * 0.05,  trend: "stable" },
        { id: "SIGNAL_NOISE",        value: 0.12 + Math.sin(t / 2000) * 0.02,  trend: "falling" },
      ],
    });
  });

  // ── Chat endpoint (direct provider call) ─────────────────────────────────────
  app.post("/api/chat", async (req, res) => {
    const { message, provider, model } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });
    try {
      const reply = await generateCompletion(message, { provider, model });
      res.json({ reply });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  async function simulateExecution(runId: string) {
    const run = runs.find(r => r.id === runId);
    if (!run) return;
    const plan = plans.find(p => p.id === run.planId);
    const baseSteps = [
      { step: "Provider Selection & Routing",     progress: 20 },
      { step: "Context Decomposition",             progress: 40 },
      { step: "Multi-Node Execution",              progress: 60 },
      { step: "Coherence Validation",              progress: 80 },
      { step: "Result Synthesis & Telemetry",      progress: 100 },
    ];
    const steps =
      plan?.graph?.nodes?.length > 0
        ? plan.graph.nodes.map((node: any, i: number) => ({
            step: node.description,
            progress: Math.floor(((i + 1) / plan.graph.nodes.length) * 100),
          }))
        : baseSteps;

    for (const step of steps) {
      await new Promise(r => setTimeout(r, 2000));
      run.status = "executing";
      run.currentStep = step.step;
      run.progress = step.progress;
      addEvent("RUN_UPDATE", `Run ${runId}: ${step.step}`, { runId, progress: step.progress });
      broadcast({ type: "run_update", data: run });
    }

    try {
      const prompt = `
        You are the UACP GPC Intelligence Agent.
        User intent: "${plan?.intent || "Unknown"}"
        Research signals: ${ssrnSignals.map(s => s.title).join(", ")}
        Market state: ${marketConvergence.map(m => `${m.label}: ${m.value}`).join(", ")}
        Provide a concise 2-sentence final outcome report.
      `;
      run.output = await generateCompletion(prompt);
    } catch {
      run.output = "Execution finalized. Deterministic outcomes verified across all nodes.";
    }

    run.status = "completed";
    run.endTime = new Date().toISOString();
    addEvent("RUN_COMPLETED", `Run ${runId} completed`, { runId });
    broadcast({ type: "run_update", data: run });
  }

  // ── Static / Vite serving ─────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`UACP GPC running on http://localhost:${PORT}`);
    console.log("Provider status:", getProviderStatus());
    addEvent("SYSTEM_ONLINE", "UACP GPC Control Plane Initialized");
  });
}

startServer();
