# Quantum UACP v0

Quantum UACP is a runnable full-stack control plane for hybrid workflow orchestration with research-backed plan compilation, durable run artifacts, and live observability.

## Features
- **Intent Console**: Convert natural language commands into deterministic plans using a multi-stage research-backed compile pipeline.
- **Execution Graph**: Visualize the hybrid logic sequences.
- **Ops / Control Plane**: Monitor real-time runs, event logs, and observability signals.
- **Compiled Artifact & Archive**: Download plan schemas and run artifacts with prompt-dependent outputs.
- **Research Dossier**: Every compiled plan can persist a synthesis, topic briefs, evidence lines, and source signals.

## Technical Stack
- **Frontend**: React 19, Tailwind CSS 4, Motion, Lucide Icons.
- **Backend**: Express 4, Node.js, WebSockets (`ws`).
- **AI Providers**: Groq, Hugging Face, Ollama, Gemini, deterministic fallback.
- **Research Inputs**: Live arXiv feed plus multi-step LLM synthesis.

## Data Structure
- **Plans**: ID, Intent, Revision, Graph (Nodes/Edges), Status.
- **Runs**: ID, PlanID, Status (Pending, Executing, Completed), Progress, Steps.
- **Events**: Append-only log of system actions.
- **Signals**: Real-time observability (Coherence, Latency, Policy Alignment).
- **Research Dossier**: Query, topics, synthesis, evidence, source signals, provider.

## Compile Pipeline
1. Generate research topics from the user directive.
2. Research each topic concurrently against the live research feed context.
3. Synthesize the research dossier.
4. Compile the execution graph using the research dossier.
5. Persist the plan with its research dossier so the UI and artifact compiler can inspect it later.

## Environment
- `AI_PROVIDER`, `LLM_PROVIDER`, `AI_FALLBACK_PROVIDER`: provider priority hints.
- `RESEARCH_TOPIC_COUNT`: number of research topics to generate per compile.
- `LLM_REQUEST_TIMEOUT_MS`: provider timeout for compile and artifact generation.
- `OPERATOR_PASSCODE` + `AUTH_SESSION_SECRET`: enable signed operator sessions for the API and websocket surface.
- `DATABASE_URL`: enables Postgres-backed durable state for plans, runs, events, archive records, and observability telemetry.

## Research Context
This control plane compiles plans against live research signals and enforces prompt-dependent outputs so the artifact and archive surfaces expose what was actually generated rather than generic completion text.
