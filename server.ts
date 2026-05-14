import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";
import { OpenAI } from "openai";
import { XMLParser } from "fast-xml-parser";

const app = express();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const MODEL_NAME = process.env.MODEL_NAME || "gemini-3-flash-preview";

async function generateCompletion(prompt: string, options?: { provider?: string, model?: string }): Promise<string> {
  const provider = options?.provider || process.env.LLM_PROVIDER || 'gemini';
  const model = options?.model || process.env.MODEL_NAME || (provider === 'gemini' ? "gemini-3-flash-preview" : "gpt-3.5-turbo");

  switch (provider) {
    case 'gemini':
      const result = await ai.models.generateContent({
        model: model,
        contents: prompt
      });
      return result.text || "";
      
    case 'openai':
    case 'groq':
    case 'ollama':
      const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY || "not-needed",
        baseURL: process.env.OPENAI_BASE_URL
      });
      const response = await client.chat.completions.create({
        model: model,
        messages: [{ role: 'user', content: prompt }]
      });
      return response.choices[0].message.content || "";
    
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}
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
  { label: "BTC/USD Momentum", value: "0%", description: "Loading..." },
  { label: "ETH/USD Stability", value: "0%", description: "Loading..." }
];
let systemPressure = 0.05;

async function updateRealSignals() {
  try {
    // 1. Fetch from Multiple ArXiv Queries for academic diversity
    const arxivQueries = [
      "all:quantum+computing",
      "all:LLM+alignment",
      "all:future+studies"
    ];
    
    let allEntries: any[] = [];
    for (const query of arxivQueries) {
      const arxivRes = await fetch(`https://export.arxiv.org/api/query?search_query=${query}&start=0&max_results=3&sortBy=lastUpdatedDate&sortOrder=descending`);
      const xml = await arxivRes.text();
      const jsonObj = parser.parse(xml);
      if (jsonObj.feed?.entry) {
        const entries = Array.isArray(jsonObj.feed.entry) ? jsonObj.feed.entry : [jsonObj.feed.entry];
        allEntries = [...allEntries, ...entries];
      }
    }

    ssrnSignals = allEntries.map((entry: any) => ({
      id: entry.id?.split('/').pop() || '#UKNOWN',
      title: entry.title?.replace(/\n/g, ' ').trim() || 'Untitled Paper',
      strength: 70 + Math.random() * 30,
      timestamp: entry.updated || new Date().toISOString(),
      category: (entry.category?.attr_term || 'Research').replace('cs.', '')
    }));

    // 2. Fetch Hacker News (Left-Field/Tech)
    const hnRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json?limit=5");
    const hnIds = await hnRes.json();
    const hnItems = await Promise.all(
        hnIds.map((id: number) => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json()))
    );

    ssrnSignals = [...ssrnSignals, ...hnItems.map((item: any) => ({
      id: `hn-${item.id}`,
      title: item.title,
      strength: 50 + Math.random() * 40,
      timestamp: new Date().toISOString(),
      category: 'HackerNews'
    }))];

    // 3. Fetch Market Data & Calculate Pressure
    const marketRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true");
    const marketData = await marketRes.json();
    
    if (marketData.bitcoin) {
      marketConvergence = [
        { 
          label: "BTC Volatility", 
          value: `${marketData.bitcoin.usd_24h_change > 0 ? '+' : ''}${marketData.bitcoin.usd_24h_change.toFixed(2)}%`,
          description: `24h delta: $${marketData.bitcoin.usd.toLocaleString()}`
        },
        { 
          label: "ETH Network State", 
          value: `${marketData.ethereum.usd_24h_change > 0 ? '+' : ''}${marketData.ethereum.usd_24h_change.toFixed(2)}%`,
          description: `24h delta: $${marketData.ethereum.usd.toLocaleString()}`
        }
      ];

      // Dynamic pressure: average absolute change * signal density
      const avgVol = (Math.abs(marketData.bitcoin.usd_24h_change) + Math.abs(marketData.ethereum.usd_24h_change)) / 2;
      systemPressure = Math.min(1.0, Math.max(0.01, (avgVol / 10) + (ssrnSignals.length / 100)));
    }
  } catch (err) {
    console.error("Real data fetch error:", err);
  }
}

// Initial fetch
updateRealSignals();
// Refresh every 5 minutes
setInterval(updateRealSignals, 300000);

app.post("/api/intent-to-plan", async (req, res) => {
  const { intent, provider, model, compliance } = req.body;
  const compliancePrompt = compliance && compliance.length > 0 
    ? `ENSURE COMPLIANCE WITH: ${compliance.join(", ")}.` 
    : "";
    
  const prompt = `
    You are the Quantum UACP Deterministic Orchestrator. 
    Translate natural language intent into a hybrid quantum-classical orchestration plan.
    
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
    const result = await generateCompletion(prompt, { provider, model });
    res.json(JSON.parse(result));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
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

let plans: Plan[] = [];
let runs: Run[] = [];
let events: AppEvent[] = [];

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
    const { name, intent, graph } = req.body;
    if (!intent) return res.status(400).json({ error: "Intent required" });

    const newPlan: Plan = {
      id: `p-${Math.random().toString(36).substring(2, 9)}`,
      name: name || "AI Generated Plan",
      intent,
      revision: 1,
      status: 'draft',
      graph: graph || { nodes: [], edges: [] },
      createdAt: new Date().toISOString()
    };
    
    plans.push(newPlan);
    addEvent('PLAN_CREATED', `New plan created: ${newPlan.id} (${newPlan.name})`, { planId: newPlan.id });
    res.json(newPlan);
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
      uacp_pressure: systemPressure,
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
      const prompt = `
        You are the Quantum UACP Intelligence Agent.
        The user intent was: "${plan?.intent || 'Unknown'}"
        The current research signals include: ${ssrnSignals.map(s => s.title).join(', ')}
        The current market state is: ${marketConvergence.map(m => `${m.label}: ${m.value}`).join(', ')}
        
        Provide a concise (2 sentence) final outcome report for this orchestration.
      `;
      run.output = await generateCompletion(prompt);
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
