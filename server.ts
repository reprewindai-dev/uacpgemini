import "dotenv/config";
import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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

let ssrnSignals: SSRNSignal[] = [];

let marketConvergence: Array<{ label: string; value: string; description: string }> = [];

function computeSignalStrength(entry: any) {
  const title = typeof entry?.title === "string" ? entry.title.toLowerCase() : "";
  const summary = typeof entry?.summary === "string" ? entry.summary.toLowerCase() : "";
  const corpus = `${title} ${summary}`;
  const keywords = [
    "quantum",
    "llm",
    "deterministic",
    "agent",
    "optimization",
    "risk",
    "policy",
    "control",
    "governance",
    "evaluation",
  ];
  const keywordMatches = keywords.reduce((count, keyword) => (
    corpus.includes(keyword) ? count + 1 : count
  ), 0);
  const updatedAt = typeof entry?.updated === "string" ? new Date(entry.updated).getTime() : Date.now();
  const ageHours = Math.max(0, (Date.now() - updatedAt) / 36e5);
  const recencyScore = Math.max(0, 24 - Math.min(24, ageHours / 6));
  const category = String(entry?.category?.attr_term || "");
  const categoryScore = /^cs\./i.test(category) ? 6 : 0;
  const total = 55 + (keywordMatches * 4) + recencyScore + categoryScore;

  return Number(Math.min(99.9, Math.max(50, total)).toFixed(1));
}

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
        strength: computeSignalStrength(entry),
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

// --- Types & Storage (In-Memory State) ---
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
  planSnapshot?: Plan;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  currentStep: string;
  progress: number;
  output?: any;
  artifact?: RunArtifact;
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

interface RunArtifact {
  artifactId: string;
  title: string;
  generatedAt: string;
  planId: string;
  runId: string;
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
  };
  nextAction: string;
}

type ModelProvider = "groq" | "huggingface" | "ollama" | "gemini" | "fallback";
type ModelOperation = "plan_compile" | "artifact_compile";

interface LatencyMeasurement {
  durationMs: number;
  provider: ModelProvider;
  operation: ModelOperation;
  recordedAt: string;
}

interface ObservabilityTelemetry {
  recentLatencies: LatencyMeasurement[];
  lastMeasuredLatencyMs: number | null;
  lastMeasuredProvider: ModelProvider | null;
  lastMeasuredOperation: ModelOperation | null;
  lastMeasuredAt: string | null;
}

interface AppState {
  plans: Plan[];
  runs: Run[];
  events: AppEvent[];
  observabilityTelemetry: ObservabilityTelemetry;
}

let plans: Plan[] = [];
let runs: Run[] = [];
let events: AppEvent[] = [];
let observabilityTelemetry: ObservabilityTelemetry = {
  recentLatencies: [],
  lastMeasuredLatencyMs: null,
  lastMeasuredProvider: null,
  lastMeasuredOperation: null,
  lastMeasuredAt: null,
};
let ollamaProcess: ChildProcess | null = null;
let ollamaBootstrapPromise: Promise<void> | null = null;
let ollamaReady = false;
const DATA_FILE_PATH = process.env.DATA_FILE_PATH?.trim() || path.join(process.cwd(), "data", "uacp-state.json");

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function ensureDataFileDirectory() {
  const dir = path.dirname(DATA_FILE_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function persistState() {
  ensureDataFileDirectory();

  const state: AppState = {
    plans,
    runs,
    events,
    observabilityTelemetry,
  };

  writeFileSync(DATA_FILE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function loadPersistedState() {
  try {
    if (!existsSync(DATA_FILE_PATH)) {
      return;
    }

    const raw = readFileSync(DATA_FILE_PATH, "utf8");
    if (!raw.trim()) {
      return;
    }

    const parsed = JSON.parse(raw) as Partial<AppState>;
    plans = Array.isArray(parsed.plans) ? parsed.plans : [];
    runs = Array.isArray(parsed.runs) ? parsed.runs.map((run) => {
      const matchedPlan = plans.find((plan) => plan.id === run.planId);
      return {
        ...run,
        planSnapshot: run.planSnapshot || (matchedPlan ? deepClone(matchedPlan) : undefined),
      };
    }) as Run[] : [];
    events = Array.isArray(parsed.events) ? parsed.events : [];
    observabilityTelemetry = parsed.observabilityTelemetry && Array.isArray(parsed.observabilityTelemetry.recentLatencies)
      ? {
          recentLatencies: parsed.observabilityTelemetry.recentLatencies
            .filter((entry): entry is LatencyMeasurement => (
              typeof entry?.durationMs === "number" &&
              typeof entry?.provider === "string" &&
              typeof entry?.operation === "string" &&
              typeof entry?.recordedAt === "string"
            ))
            .slice(0, 20),
          lastMeasuredLatencyMs: typeof parsed.observabilityTelemetry.lastMeasuredLatencyMs === "number"
            ? parsed.observabilityTelemetry.lastMeasuredLatencyMs
            : null,
          lastMeasuredProvider: typeof parsed.observabilityTelemetry.lastMeasuredProvider === "string"
            ? parsed.observabilityTelemetry.lastMeasuredProvider as ModelProvider
            : null,
          lastMeasuredOperation: typeof parsed.observabilityTelemetry.lastMeasuredOperation === "string"
            ? parsed.observabilityTelemetry.lastMeasuredOperation as ModelOperation
            : null,
          lastMeasuredAt: typeof parsed.observabilityTelemetry.lastMeasuredAt === "string"
            ? parsed.observabilityTelemetry.lastMeasuredAt
            : null,
        }
      : {
          recentLatencies: [],
          lastMeasuredLatencyMs: null,
          lastMeasuredProvider: null,
          lastMeasuredOperation: null,
          lastMeasuredAt: null,
        };
  } catch (error) {
    console.error("State load error:", error);
    plans = [];
    runs = [];
    events = [];
    observabilityTelemetry = {
      recentLatencies: [],
      lastMeasuredLatencyMs: null,
      lastMeasuredProvider: null,
      lastMeasuredOperation: null,
      lastMeasuredAt: null,
    };
  }
}

loadPersistedState();

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

function getOllamaAutostartEnabled() {
  return process.env.OLLAMA_AUTOSTART?.trim().toLowerCase() === "true";
}

function getOllamaPullOnBootEnabled() {
  return process.env.OLLAMA_PULL_ON_BOOT?.trim().toLowerCase() === "true";
}

function getOllamaStartupTimeoutMs() {
  const parsed = Number(process.env.OLLAMA_STARTUP_TIMEOUT_MS || "120000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120000;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
}

function isLocalOllamaBaseUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return ["127.0.0.1", "localhost", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProviderRequestTimeoutMs() {
  const parsed = Number(process.env.LLM_REQUEST_TIMEOUT_MS || "20000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string) {
  const controller = new AbortController();
  const timeoutMs = getProviderRequestTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function withTimeout<T>(factory: () => Promise<T>, label: string): Promise<T> {
  const timeoutMs = getProviderRequestTimeoutMs();

  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    factory()
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

async function isOllamaReachable(baseUrl: string) {
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForOllamaReady(baseUrl: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isOllamaReachable(baseUrl)) {
      ollamaReady = true;
      return;
    }

    await delay(2000);
  }

  throw new Error(`Ollama did not become ready at ${baseUrl} within ${timeoutMs}ms`);
}

async function runOllamaCommand(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ollama", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stderr = "";

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ollama ${args.join(" ")} failed with exit code ${code}: ${stderr.trim()}`));
    });
  });
}

async function ensureOllamaReady() {
  const ollama = getOllamaConfig();
  if (!ollama) {
    return;
  }

  if (ollamaReady && await isOllamaReachable(ollama.baseUrl)) {
    return;
  }

  if (ollamaBootstrapPromise) {
    return ollamaBootstrapPromise;
  }

  ollamaBootstrapPromise = (async () => {
    const baseUrl = normalizeBaseUrl(ollama.baseUrl);
    if (await isOllamaReachable(baseUrl)) {
      ollamaReady = true;
      return;
    }

    if (!getOllamaAutostartEnabled()) {
      throw new Error(`Ollama is not reachable at ${baseUrl}. Set OLLAMA_AUTOSTART=true to let the app start it automatically.`);
    }

    if (!isLocalOllamaBaseUrl(baseUrl)) {
      throw new Error(`OLLAMA_AUTOSTART only supports local OLLAMA_BASE_URL values. Received ${baseUrl}.`);
    }

    if (!ollamaProcess || ollamaProcess.exitCode !== null || ollamaProcess.killed) {
      console.log(`Starting Ollama at ${baseUrl}...`);
      ollamaProcess = spawn("ollama", ["serve"], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      ollamaProcess.stdout?.on("data", (chunk) => {
        console.log(`[ollama] ${chunk.toString().trim()}`);
      });

      ollamaProcess.stderr?.on("data", (chunk) => {
        console.error(`[ollama] ${chunk.toString().trim()}`);
      });

      ollamaProcess.on("error", (error) => {
        ollamaReady = false;
        console.error("Failed to start Ollama:", error);
      });

      ollamaProcess.on("close", (code) => {
        ollamaReady = false;
        console.error(`Ollama exited with code ${code}`);
      });
    }

    await waitForOllamaReady(baseUrl, getOllamaStartupTimeoutMs());

    if (getOllamaPullOnBootEnabled()) {
      console.log(`Ensuring Ollama model ${ollama.model} is present...`);
      await runOllamaCommand(["pull", ollama.model]);
    }
  })().finally(() => {
    ollamaBootstrapPromise = null;
  });

  return ollamaBootstrapPromise;
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

function getConfiguredProviders() {
  return getProviderOrder().filter(isProviderConfigured);
}

function formatProviderLabel(provider: ModelProvider) {
  switch (provider) {
    case "groq":
      return "Groq";
    case "huggingface":
      return "Hugging Face";
    case "ollama":
      return "Ollama";
    case "gemini":
      return "Gemini";
    default:
      return "Deterministic fallback";
  }
}

function getPrimaryProvider() {
  return getConfiguredProviders()[0] || "fallback";
}

function recordLatency(provider: ModelProvider, operation: ModelOperation, durationMs: number) {
  const measurement: LatencyMeasurement = {
    durationMs: Number(durationMs.toFixed(1)),
    provider,
    operation,
    recordedAt: new Date().toISOString(),
  };

  observabilityTelemetry = {
    recentLatencies: [measurement, ...observabilityTelemetry.recentLatencies].slice(0, 20),
    lastMeasuredLatencyMs: measurement.durationMs,
    lastMeasuredProvider: provider,
    lastMeasuredOperation: operation,
    lastMeasuredAt: measurement.recordedAt,
  };

  persistState();
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

async function requestGroq(prompt: string, expectJson: boolean, operation: ModelOperation) {
  const groq = getGroqConfig();
  if (!groq) {
    throw new Error("Groq is not configured");
  }

  const startedAt = Date.now();
  const response = await fetchWithTimeout(`${groq.baseUrl}/chat/completions`, {
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
  }, "Groq request");

  if (!response.ok) {
    throw new Error(`Groq request failed with status ${response.status}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Groq returned an empty response");
  }

  recordLatency("groq", operation, Date.now() - startedAt);

  return { provider: "groq" as const, text: cleanModelText(text) };
}

async function requestHuggingFace(prompt: string, expectJson: boolean, operation: ModelOperation) {
  const huggingFace = getHuggingFaceConfig();
  if (!huggingFace) {
    throw new Error("Hugging Face is not configured");
  }

  const startedAt = Date.now();
  const response = await fetchWithTimeout(`${huggingFace.baseUrl.replace(/\/$/, "")}/chat/completions`, {
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
  }, "Hugging Face request");

  if (!response.ok) {
    throw new Error(`Hugging Face request failed with status ${response.status}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Hugging Face returned an empty response");
  }

  recordLatency("huggingface", operation, Date.now() - startedAt);

  return { provider: "huggingface" as const, text: cleanModelText(text) };
}

async function requestOllama(prompt: string, expectJson: boolean, operation: ModelOperation) {
  const ollama = getOllamaConfig();
  if (!ollama) {
    throw new Error("Ollama is not configured");
  }

  await ensureOllamaReady();

  const startedAt = Date.now();
  const response = await fetchWithTimeout(`${normalizeBaseUrl(ollama.baseUrl)}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollama.model,
      prompt,
      stream: false,
      format: expectJson ? "json" : undefined,
    }),
  }, "Ollama request");

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}`);
  }

  const data = await response.json();
  const text = data?.response;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Ollama returned an empty response");
  }

  recordLatency("ollama", operation, Date.now() - startedAt);

  return { provider: "ollama" as const, text: cleanModelText(text) };
}

async function requestGemini(prompt: string, expectJson: boolean, operation: ModelOperation) {
  const gemini = getGeminiConfig();
  if (!gemini) {
    throw new Error("Gemini is not configured");
  }

  const ai = new GoogleGenAI({ apiKey: gemini.apiKey });
  const startedAt = Date.now();
  const response = await withTimeout(() => ai.models.generateContent({
    model: gemini.model,
    contents: prompt,
    config: expectJson ? { responseMimeType: "application/json" } : undefined,
  }), "Gemini request");

  const text = response.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Gemini returned an empty response");
  }

  recordLatency("gemini", operation, Date.now() - startedAt);

  return { provider: "gemini" as const, text: cleanModelText(text) };
}

async function generateModelText(prompt: string, expectJson: boolean, operation: ModelOperation) {
  const failures: string[] = [];

  for (const provider of getProviderOrder()) {
    if (!isProviderConfigured(provider)) {
      continue;
    }

    try {
      switch (provider) {
        case "groq":
          return await requestGroq(prompt, expectJson, operation);
        case "huggingface":
          return await requestHuggingFace(prompt, expectJson, operation);
        case "ollama":
          return await requestOllama(prompt, expectJson, operation);
        case "gemini":
          return await requestGemini(prompt, expectJson, operation);
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

    Requirements:
    - Decode the actual task deeply. Do not return generic placeholder nodes.
    - Every node must reflect concrete deliverables from the intent.
    - If the intent contains explicit time windows such as "today", "next 72 hours", "day 7", or a 7-day operating plan, encode those phases directly in the node descriptions.
    - Policy tags must correspond to real governance or control checkpoints.

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

function buildArtifactPrompt(plan: Plan, run: Run) {
  return `
    You are the Quantum UACP Artifact Compiler.
    Convert the completed run into a concrete artifact that exposes exactly what was produced.

    Plan ID: ${plan.id}
    Run ID: ${run.id}
    Original intent: "${plan.intent}"
    Plan graph: ${JSON.stringify(plan.graph)}
    Current research signals: ${ssrnSignals.map((signal) => signal.title).join(", ")}
    Current market state: ${marketConvergence.map((entry) => `${entry.label}: ${entry.value}`).join(", ")}

    Requirements:
    - Return only JSON.
    - The artifact must depend on the actual prompt.
    - If the intent asks for a 7-day operating plan, explicitly fill:
      - today
      - next72Hours
      - day7
      - risks
      - archives
      - commandCenterSignals
    - Do not use generic filler like "execution finalized" as the main content.
    - Phase outputs must tie back to the node list.

    Return JSON with this shape:
    {
      "title": "Compiled Artifact title",
      "runContract": {
        "objective": "string",
        "acceptanceCriteria": ["string"],
        "constraints": ["string"],
        "successMetric": "string"
      },
      "phaseOutputs": [
        {
          "phase": "Today|72 Hours|Day 7|Archive|Control",
          "nodeId": "string",
          "output": "string"
        }
      ],
      "today": ["string"],
      "next72Hours": ["string"],
      "day7": ["string"],
      "risks": ["string"],
      "archives": ["string"],
      "commandCenterSignals": ["string"],
      "finalReport": "string",
      "archiveRecord": {
        "summary": "string",
        "entries": ["string"]
      },
      "nextAction": "string"
    }
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
  const timelineIntent = /7[- ]?day|today|72 hours|day 7/i.test(intent);
  const nodes = timelineIntent
    ? [
        {
          id: "today-scope",
          type: "classical" as const,
          description: `Define today's execution scope for: ${directive}`,
          policy_tag: "AC-10",
          entropy: 0.08,
        },
        {
          id: "72h-owners",
          type: "classical" as const,
          description: "Assign owners, evidence requirements, and operating checkpoints for the next 72 hours.",
          policy_tag: "OPS-14",
          entropy: 0.14,
        },
        {
          id: "day7-plan",
          type: "quantum" as const,
          description: "Assemble the day-7 operating plan, risks, and command-center review package.",
          policy_tag: "Q-17",
          entropy: 0.27,
        },
        {
          id: "archive-control",
          type: "classical" as const,
          description: "Archive the evidence trail and define the live control-plane signals required for execution.",
          policy_tag: "AC-GLOBAL",
          entropy: 0.06,
        },
      ]
    : [
        {
          id: "intent-scope",
          type: "classical" as const,
          description: `Interpret directive and define execution scope: ${directive}`,
          policy_tag: "AC-10",
          entropy: 0.08,
        },
        {
          id: "execution-design",
          type: "quantum" as const,
          description: "Model candidate execution paths and isolate the highest-confidence branch.",
          policy_tag: "Q-17",
          entropy: 0.41,
        },
        {
          id: "policy-review",
          type: "classical" as const,
          description: "Validate policy alignment, safety controls, and execution preconditions.",
          policy_tag: "AC-GLOBAL",
          entropy: 0.11,
        },
        {
          id: "run-contract",
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
    const result = await generateModelText(buildCompilePlanPrompt(intent), true, "plan_compile");
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

function createFallbackArtifact(plan: Plan, run: Run): RunArtifact {
  const nodes = Array.isArray(plan.graph?.nodes) ? plan.graph.nodes : [];
  const nodeOutputs = nodes.map((node, index) => ({
    phase: index === 0 ? "Today" : index === 1 ? "72 Hours" : index === 2 ? "Day 7" : `Phase ${index + 1}`,
    nodeId: node.id,
    output: node.description,
  }));
  const policyTags = [...new Set(nodes.map((node) => node.policy_tag).filter(Boolean))] as string[];
  const intent = plan.intent.trim();
  const baseToday = [
    `Lock scope and ownership for: ${intent}`,
    `Translate node ${nodes[0]?.id || "phase-1"} into an executable deliverable with acceptance criteria.`,
  ];
  const base72Hours = [
    `Drive node outputs through governance review and assign owners for ${nodes.slice(0, 2).map((node) => node.id).join(", ") || "the first execution phases"}.`,
    `Write archive entries for decisions, evidence, and blocked dependencies.`,
  ];
  const baseDay7 = [
    `Deliver the compiled operating plan to the command center with evidence attached for ${plan.name}.`,
    `Review unresolved constraints and approve the next execution cycle.`,
  ];

  return {
    artifactId: `artifact-${run.id}`,
    title: "Deterministic Outcome Artifact",
    generatedAt: new Date().toISOString(),
    planId: plan.id,
    runId: run.id,
    originalIntent: intent,
    generatedGraph: deepClone(plan.graph),
    nodeList: deepClone(nodes),
    policyTags,
    runContract: {
      objective: intent,
      acceptanceCriteria: [
        `Every node in ${plan.id} has an owner, output, and policy checkpoint.`,
        `The compiled artifact contains a day-structured execution record.`,
      ],
      constraints: [
        "No generic filler output is allowed.",
        "Archive every decision that changes execution order or ownership.",
      ],
      successMetric: `Run ${run.id} completes with a usable artifact and explicit next action.`,
    },
    phaseOutputs: nodeOutputs,
    today: baseToday,
    next72Hours: base72Hours,
    day7: baseDay7,
    risks: [
      "Ownership drift across pillars can break the execution schedule.",
      "Missing archive evidence will weaken operational auditability.",
    ],
    archives: [
      `Archive the compiled graph for ${plan.id}.`,
      `Store phase outputs, owner decisions, and blockers for ${run.id}.`,
    ],
    commandCenterSignals: [
      "Owner assignment completion",
      "Policy checkpoint coverage",
      "Blocked dependency count",
      "Archive evidence freshness",
    ],
    finalReport: `Run ${run.id} completed with ${nodes.length} artifact phases derived from the original intent: ${intent}`,
    archiveRecord: {
      recordId: `archive-${run.id}`,
      summary: `Artifact bundle for ${plan.id}`,
      entries: [
        `Intent captured: ${intent}`,
        `Node outputs recorded: ${nodes.map((node) => node.id).join(", ") || "none"}`,
      ],
    },
    nextAction: "Open the compiled artifact, review the phase outputs, and approve the next execution cycle.",
  };
}

function normalizeArtifactResponse(data: any, plan: Plan, run: Run): RunArtifact {
  const fallback = createFallbackArtifact(plan, run);

  return {
    artifactId: `artifact-${run.id}`,
    title: typeof data?.title === "string" && data.title.trim() ? data.title.trim() : fallback.title,
    generatedAt: new Date().toISOString(),
    planId: plan.id,
    runId: run.id,
    originalIntent: plan.intent,
    generatedGraph: deepClone(plan.graph),
    nodeList: deepClone(plan.graph?.nodes || []),
    policyTags: Array.from(new Set<string>(
      (plan.graph?.nodes || []).flatMap((node: any) => (
        typeof node?.policy_tag === "string" && node.policy_tag.trim().length > 0
          ? [node.policy_tag.trim()]
          : []
      ))
    )),
    runContract: {
      objective: typeof data?.runContract?.objective === "string" && data.runContract.objective.trim() ? data.runContract.objective.trim() : fallback.runContract.objective,
      acceptanceCriteria: Array.isArray(data?.runContract?.acceptanceCriteria) && data.runContract.acceptanceCriteria.length > 0 ? data.runContract.acceptanceCriteria.map(String) : fallback.runContract.acceptanceCriteria,
      constraints: Array.isArray(data?.runContract?.constraints) && data.runContract.constraints.length > 0 ? data.runContract.constraints.map(String) : fallback.runContract.constraints,
      successMetric: typeof data?.runContract?.successMetric === "string" && data.runContract.successMetric.trim() ? data.runContract.successMetric.trim() : fallback.runContract.successMetric,
    },
    phaseOutputs: Array.isArray(data?.phaseOutputs) && data.phaseOutputs.length > 0
      ? data.phaseOutputs.map((entry: any, index: number) => ({
          phase: typeof entry?.phase === "string" && entry.phase.trim() ? entry.phase.trim() : fallback.phaseOutputs[index]?.phase || `Phase ${index + 1}`,
          nodeId: typeof entry?.nodeId === "string" && entry.nodeId.trim() ? entry.nodeId.trim() : fallback.phaseOutputs[index]?.nodeId || `node-${index + 1}`,
          output: typeof entry?.output === "string" && entry.output.trim() ? entry.output.trim() : fallback.phaseOutputs[index]?.output || "",
        }))
      : fallback.phaseOutputs,
    today: Array.isArray(data?.today) && data.today.length > 0 ? data.today.map(String) : fallback.today,
    next72Hours: Array.isArray(data?.next72Hours) && data.next72Hours.length > 0 ? data.next72Hours.map(String) : fallback.next72Hours,
    day7: Array.isArray(data?.day7) && data.day7.length > 0 ? data.day7.map(String) : fallback.day7,
    risks: Array.isArray(data?.risks) && data.risks.length > 0 ? data.risks.map(String) : fallback.risks,
    archives: Array.isArray(data?.archives) && data.archives.length > 0 ? data.archives.map(String) : fallback.archives,
    commandCenterSignals: Array.isArray(data?.commandCenterSignals) && data.commandCenterSignals.length > 0 ? data.commandCenterSignals.map(String) : fallback.commandCenterSignals,
    finalReport: typeof data?.finalReport === "string" && data.finalReport.trim() ? data.finalReport.trim() : fallback.finalReport,
    archiveRecord: {
      recordId: `archive-${run.id}`,
      summary: typeof data?.archiveRecord?.summary === "string" && data.archiveRecord.summary.trim() ? data.archiveRecord.summary.trim() : fallback.archiveRecord.summary,
      entries: Array.isArray(data?.archiveRecord?.entries) && data.archiveRecord.entries.length > 0 ? data.archiveRecord.entries.map(String) : fallback.archiveRecord.entries,
    },
    nextAction: typeof data?.nextAction === "string" && data.nextAction.trim() ? data.nextAction.trim() : fallback.nextAction,
  };
}

async function generateRunArtifact(plan: Plan, run: Run): Promise<{ artifact: RunArtifact; provider: ModelProvider }> {
  try {
    const result = await generateModelText(buildArtifactPrompt(plan, run), true, "artifact_compile");
    return {
      artifact: normalizeArtifactResponse(parseJsonText(result.text), plan, run),
      provider: result.provider,
    };
  } catch (error) {
    console.error("Run artifact error:", error);
    return {
      artifact: createFallbackArtifact(plan, run),
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

function createRunRecord(plan: Plan): Run {
  return {
    id: `run-${Math.random().toString(36).substring(2, 9)}`,
    planId: plan.id,
    planSnapshot: deepClone(plan),
    status: "pending",
    currentStep: "Initializing Gateway",
    progress: 0,
    startTime: new Date().toISOString(),
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
  persistState();
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

  const PORT = Number(process.env.PORT || "3000");

  app.use(cors());
  app.use(express.json());

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'init', message: 'UACP Control Plane Online' }));
    ws.on("close", () => clients.delete(ws));
  });

  // --- API Routes ---

  app.get("/api/bootstrap", (req, res) => {
    const configuredProviders = getConfiguredProviders();
    res.json({
      system: "Quantum UACP",
      version: "0.2.0",
      status: "operational",
      identity: "Gopher-Engine",
      userEmail: process.env.USER_EMAIL || "LOCAL_OPERATOR",
      primaryProvider: getPrimaryProvider(),
      primaryProviderLabel: formatProviderLabel(getPrimaryProvider()),
      providerChain: configuredProviders.map(formatProviderLabel),
      researchFeedSource: "arXiv",
    });
  });

  app.get("/api/plans", (req, res) => res.json(plans));

  app.get("/api/plans/:planId", (req, res) => {
    const plan = plans.find((entry) => entry.id === req.params.planId);
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    res.json(plan);
  });
  
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

  app.get("/api/runs/:runId", (req, res) => {
    const run = runs.find((entry) => entry.id === req.params.runId);
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    res.json(run);
  });

  app.get("/api/runs/:runId/plan", (req, res) => {
    const run = runs.find((entry) => entry.id === req.params.runId);
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    res.json(run.planSnapshot);
  });

  app.get("/api/runs/:runId/artifact", (req, res) => {
    const run = runs.find((entry) => entry.id === req.params.runId);
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    if (!run.artifact) {
      return res.status(404).json({ error: "Artifact not ready" });
    }

    res.json(run.artifact);
  });

  app.post("/api/runs", (req, res) => {
    const { planId } = req.body;
    const plan = plans.find(p => p.id === planId);
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    const newRun = createRunRecord(plan);
    runs.push(newRun);
    addEvent('RUN_STARTED', `Execution run started for plan ${planId}`, { runId: newRun.id, planId });
    
    // Simulate execution
    simulateExecution(newRun.id);
    
    res.json(newRun);
  });

  app.get("/api/ssrn-signals", (req, res) => res.json(ssrnSignals));

  app.get("/api/events", (req, res) => res.json(events));

  app.get("/api/observability/signals", (req, res) => {
    const completedRuns = runs.filter((run) => run.status === "completed");
    const latestPlan = [...plans].sort((left, right) => (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    ))[0];
    const latestRun = [...runs].sort((left, right) => (
      new Date(right.startTime).getTime() - new Date(left.startTime).getTime()
    ))[0];
    const referencePlan = latestPlan || latestRun?.planSnapshot;
    const referenceRun = latestRun && referencePlan && (
      latestRun.planId === referencePlan.id || latestRun.planSnapshot?.id === referencePlan.id
    )
      ? latestRun
      : undefined;
    const referenceNodes = Array.isArray(referencePlan?.graph?.nodes) ? referencePlan.graph.nodes : [];
    const referenceEdges = Array.isArray(referencePlan?.graph?.edges) ? referencePlan.graph.edges : [];
    const totalNodes = referenceNodes.length;
    const policyTaggedNodes = referenceNodes.filter((node: any) => (
      typeof node?.policy_tag === "string" && node.policy_tag.trim()
    )).length;
    const policyAlignment = totalNodes > 0 ? policyTaggedNodes / totalNodes : 0;
    const edgeCoverage = totalNodes <= 1
      ? (totalNodes === 1 ? 1 : 0)
      : Math.min(1, referenceEdges.length / (totalNodes - 1));
    const nodeCoverage = totalNodes > 0 ? clamp01(totalNodes / 4) : 0;
    const providerReadiness = getConfiguredProviders().length > 0 ? 1 : 0.7;
    const researchReadiness = ssrnSignals.length > 0 ? 1 : 0.5;
    const persistenceReadiness = (plans.length > 0 || runs.length > 0 || existsSync(DATA_FILE_PATH)) ? 1 : 0.5;
    const planStructureReadiness = referencePlan && totalNodes > 0 ? 1 : 0;
    const artifactCoverage = referenceRun?.artifact && totalNodes > 0
      ? clamp01((referenceRun.artifact.phaseOutputs?.length || 0) / totalNodes)
      : 0;
    const primeReadiness = referencePlan
      ? clamp01(
          (planStructureReadiness * 0.24) +
          (policyAlignment * 0.24) +
          (edgeCoverage * 0.16) +
          (providerReadiness * 0.14) +
          (researchReadiness * 0.12) +
          (persistenceReadiness * 0.1)
        )
      : 0;
    const latestCompletedRun = [...completedRuns].sort((left, right) => {
      const leftTime = left.endTime ? new Date(left.endTime).getTime() : 0;
      const rightTime = right.endTime ? new Date(right.endTime).getTime() : 0;
      return rightTime - leftTime;
    })[0];
    let observabilityStage: "cold" | "primed" | "executing" | "verified" | "degraded" = "cold";

    if (referenceRun?.status === "failed") {
      observabilityStage = "degraded";
    } else if (referenceRun && (referenceRun.status === "pending" || referenceRun.status === "executing")) {
      observabilityStage = "executing";
    } else if (referenceRun?.status === "completed" && referenceRun.artifact) {
      observabilityStage = "verified";
    } else if (referencePlan) {
      observabilityStage = "primed";
    }

    let completionSignal = 0;
    if (referenceRun?.status === "completed" && referenceRun.artifact) {
      completionSignal = 1;
    } else if (referenceRun?.status === "executing") {
      completionSignal = clamp01(0.2 + ((referenceRun.progress / 100) * 0.8));
    } else if (referenceRun?.status === "pending") {
      completionSignal = clamp01(
        0.72 +
        (nodeCoverage * 0.06) +
        (edgeCoverage * 0.05) +
        (providerReadiness * 0.04) +
        (persistenceReadiness * 0.03)
      );
    } else if (referenceRun?.status === "failed") {
      completionSignal = clamp01(primeReadiness * 0.25);
    } else if (referencePlan) {
      completionSignal = clamp01(
        0.7 +
        (nodeCoverage * 0.08) +
        (edgeCoverage * 0.06) +
        (providerReadiness * 0.04) +
        (researchReadiness * 0.03) +
        (persistenceReadiness * 0.02)
      );
    }

    let pressure = 0;
    if (referenceRun?.status === "completed" && referenceRun.artifact) {
      pressure = clamp01(
        0.76 +
        (artifactCoverage * 0.12) +
        (referenceRun.artifact.nextAction ? 0.06 : 0) +
        Math.min(0.04, totalNodes * 0.01)
      );
    } else if (referenceRun && (referenceRun.status === "pending" || referenceRun.status === "executing")) {
      pressure = clamp01(
        0.48 +
        ((referenceRun.progress / 100) * 0.22) +
        (edgeCoverage * 0.12) +
        (providerReadiness * 0.08) +
        (researchReadiness * 0.04) +
        Math.min(0.06, totalNodes * 0.015)
      );
    } else if (referenceRun?.status === "failed") {
      pressure = 0.25;
    } else if (referencePlan) {
      pressure = clamp01(
        0.34 +
        (edgeCoverage * 0.16) +
        (providerReadiness * 0.12) +
        (researchReadiness * 0.07) +
        (persistenceReadiness * 0.08) +
        Math.min(0.1, totalNodes * 0.025)
      );
    }

    let coherence = 0;
    if (referenceRun?.status === "completed" && referenceRun.artifact) {
      coherence = 100;
    } else if (referenceRun?.status === "executing") {
      coherence = Math.min(
        100,
        62 +
        ((referenceRun.progress / 100) * 24) +
        (policyAlignment * 6) +
        (edgeCoverage * 4) +
        (providerReadiness * 4)
      );
    } else if (referenceRun?.status === "pending") {
      coherence = Math.min(
        100,
        74 +
        (policyAlignment * 8) +
        (edgeCoverage * 6) +
        (researchReadiness * 4) +
        (providerReadiness * 3)
      );
    } else if (referenceRun?.status === "failed") {
      coherence = Math.min(35, 18 + (policyAlignment * 10) + (edgeCoverage * 7));
    } else if (referencePlan) {
      coherence = Math.min(
        100,
        72 +
        (policyAlignment * 8) +
        (edgeCoverage * 7) +
        (researchReadiness * 5) +
        (providerReadiness * 4)
      );
    }

    const latestRunLatency = latestCompletedRun?.endTime
      ? (
          new Date(latestCompletedRun.endTime).getTime() -
          new Date(latestCompletedRun.startTime).getTime()
        ) / Math.max(
          1,
          Array.isArray((latestCompletedRun.planSnapshot || referencePlan)?.graph?.nodes)
            ? (latestCompletedRun.planSnapshot || referencePlan)?.graph?.nodes.length
            : 1
        )
      : null;
    const latestMeasuredTelemetryAt = observabilityTelemetry.lastMeasuredAt
      ? new Date(observabilityTelemetry.lastMeasuredAt).getTime()
      : 0;
    const latestRunLatencyAt = latestCompletedRun?.endTime
      ? new Date(latestCompletedRun.endTime).getTime()
      : 0;
    const latency = latestMeasuredTelemetryAt >= latestRunLatencyAt
      ? observabilityTelemetry.lastMeasuredLatencyMs
      : latestRunLatency;
    const latencySource = latestMeasuredTelemetryAt >= latestRunLatencyAt
      ? "provider"
      : latestRunLatency !== null
        ? "run"
        : null;
    const stageBoost = observabilityStage === "verified"
      ? 0.04
      : observabilityStage === "executing"
        ? 0.03
        : observabilityStage === "primed"
          ? 0.025
          : observabilityStage === "degraded"
            ? -0.1
            : 0;
    const certaintyIndex = Math.min(0.9999, Math.max(
      0,
      (primeReadiness * 0.38) +
      (policyAlignment * 0.22) +
      (completionSignal * 0.16) +
      (pressure * 0.12) +
      ((coherence / 100) * 0.12) +
      stageBoost
    ));

    const signalState = observabilityStage;

    res.json({
      observability_stage: observabilityStage,
      prime_readiness: Number(primeReadiness.toFixed(3)),
      quantum_coherence: coherence,
      classical_latency: typeof latency === "number" ? Number(latency.toFixed(1)) : null,
      latency_source: latencySource,
      latency_provider: latencySource === "provider" ? observabilityTelemetry.lastMeasuredProvider : null,
      latency_operation: latencySource === "provider" ? observabilityTelemetry.lastMeasuredOperation : null,
      uacp_pressure: Number(pressure.toFixed(3)),
      gopher_policy_alignment: Number(policyAlignment.toFixed(3)),
      certainty_index: Number(certaintyIndex.toFixed(4)),
      market_convergence: marketConvergence,
      horowitz_signals: [
        {
          id: 'RUN_COMPLETION',
          value: Number(completionSignal.toFixed(3)),
          trend: completionSignal >= 0.9 ? 'rising' : completionSignal >= 0.6 ? 'stable' : 'falling',
          state: signalState,
        },
        {
          id: 'POLICY_ALIGNMENT',
          value: Number(policyAlignment.toFixed(3)),
          trend: policyAlignment >= 0.9 ? 'rising' : policyAlignment >= 0.6 ? 'stable' : 'falling',
          state: signalState,
        },
        {
          id: 'EXECUTION_PRESSURE',
          value: Number(pressure.toFixed(3)),
          trend: pressure >= 0.88 ? 'rising' : pressure >= 0.66 ? 'stable' : 'falling',
          state: signalState,
        }
      ]
    });
  });

  async function simulateExecution(runId: string) {
    const run = runs.find(r => r.id === runId);
    if (!run) return;

    const plan = run.planSnapshot || plans.find(p => p.id === run.planId);
    if (!plan) {
      run.status = "failed";
      run.output = "Run failed because the plan snapshot could not be resolved.";
      persistState();
      addEvent("RUN_FAILED", `Execution run ${runId} failed because the plan snapshot is missing`, { runId });
      broadcast({ type: "run_update", data: run });
      return;
    }
    
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
      persistState();
      addEvent('RUN_UPDATE', `Run ${runId}: ${step.step}`, { runId, progress: step.progress });
      broadcast({ type: 'run_update', data: run });
    }

    // Compile the completed run into a durable artifact
    try {
      const artifactResult = await generateRunArtifact(plan, run);
      run.artifact = artifactResult.artifact;
      run.output = artifactResult.artifact.finalReport;
    } catch (e) {
      console.error("Artifact error:", e);
      const fallbackArtifact = createFallbackArtifact(plan, run);
      run.artifact = fallbackArtifact;
      run.output = fallbackArtifact.finalReport;
    }

    run.status = 'completed';
    run.endTime = new Date().toISOString();
    persistState();
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

  if (getOllamaConfig() && getOllamaAutostartEnabled()) {
    void ensureOllamaReady().catch((error) => {
      console.error("Ollama bootstrap error:", error);
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`UACP Server running on http://localhost:${PORT}`);
    addEvent('SYSTEM_ONLINE', 'Quantum UACP Control Plane Initialized');
  });
}

startServer();
