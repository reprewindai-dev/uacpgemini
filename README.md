# UACP Gemini V2

UACP Gemini V2 is a governed execution control plane for turning raw operator intent into structured plans, tracked runs, auditable artifacts, and replayable evidence.

It is not a generic chat app. It is a controlled orchestration surface that accepts a directive, compiles it into a governed plan, executes a tracked run against that plan, and preserves the resulting artifact, event trail, archive record, and replay chain.

## What This Is

UACP Gemini V2 is a single-application control plane with four core responsibilities:

1. Accept a natural-language directive from an operator.
2. Convert that directive into a structured plan with nodes, edges, policy tags, and research context.
3. Execute the resulting plan as a tracked run with live observability.
4. Preserve the output as a durable, inspectable audit object with archive and replay support.

In practical terms, this repo is a governed compiler and execution theater for operational intent.

## What It Does

UACP Gemini V2 provides:

- **Intent compilation**
  - Converts long-form text into a structured plan.
  - Produces graph nodes, edges, policy coverage, and a compiled reference.

- **Research-backed planning**
  - Builds a research dossier around the directive.
  - Persists topics, synthesis, evidence lines, and source signals alongside the plan.

- **Tracked run execution**
  - Starts a governed run from a compiled plan.
  - Emits event updates, progress, phase transitions, and live observability signals.

- **Artifact generation**
  - Produces a compiled artifact with status model, run contract, phase outputs, risks, archives, signals, and next action.

- **Archive and replay**
  - Writes archive records.
  - Exposes replay checkpoints across the plan, run, event, archive, and replay chain.

- **Governed observability**
  - Surfaces pressure, prime readiness, certainty index, latency, and signal state.
  - Keeps the execution surface "hot" after a verified run instead of collapsing to zero.

- **Protected operator access**
  - Supports operator passcode authentication.
  - Supports durable Postgres-backed persistence for production use.

## Who It Is For

UACP Gemini V2 is for teams that need controlled execution instead of free-form prompting.

Typical users:

- AI platform operators
- internal tooling teams
- applied AI product teams
- governance / compliance-driven engineering teams
- founders or operators running sensitive AI workflows

It is a fit when a team needs:

- a controlled plan compiler
- clear execution states
- replayable evidence
- traceable archives
- governed routing across model providers
- a black-box buyer/demo surface without exposing the full operator console

It is not aimed at casual consumer chat usage.

## Primary Use Case

The clearest use case is a governed AI workflow that cannot go straight from prompt to production.

Example:

An operator needs to turn a regulated support workflow into a controlled AI execution path. The workflow must:

- classify the incoming request
- route to the correct model/provider path
- apply policy and redaction gates
- require evidence before risky outputs are accepted
- preserve an audit trail
- produce a final artifact that can be reviewed, exported, and replayed

In UACP Gemini V2, that looks like:

1. The operator enters the directive.
2. The system compiles a plan from the directive.
3. The system creates a research-backed dossier for context.
4. The operator starts a governed run.
5. The run executes through tracked steps.
6. The system generates an artifact with explicit status boundaries.
7. The archive and replay chain are preserved for later review.

This allows a team to prove what happened, what was compiled, what was executed, and what evidence exists.

## Product Model

UACP Gemini V2 acts as a governed plan compiler and execution surface.

Core flow:

`Intent -> Plan -> Run -> Artifact -> Archive -> Replay`

The product is strongest when used as:

- an internal operator console
- a buyer/demo black-box surface
- a governed planning gateway sitting in front of model execution

## Key Capabilities

### Intent Console

The main entry point for raw directives. Operators can submit long-form orchestration intent and compile a governed plan from it.

### Probability Matrix

The plan view. This shows node structure, execution graph, policy tagging, and schema export.

### Deterministic Ops

The run theater. This shows run progress, artifact controls, replay access, and operational telemetry.

### Research Dossier

Each plan can carry a persisted dossier that includes:

- query
- topic set
- synthesis
- evidence lines
- source signals
- provider used

### Artifact and Replay

Each completed run can generate:

- compiled artifact
- status model
- archive record
- replay chain
- downloadable JSON outputs

## Black-Box Demo Mode

This repo also supports a buyer-safe black-box presentation mode.

In black-box mode:

- the same V2 app is used
- the center execution surface stays visible
- the left and right side panels are hidden
- the user sees the controlled theater, not the full operator console

This is intended for demo and wrapper use without changing the core application model.

## Technical Stack

- **Frontend**: React 19, Tailwind CSS 4, Motion, Lucide Icons
- **Backend**: Express 4, Node.js, WebSockets (`ws`)
- **Persistence**: Postgres when `DATABASE_URL` is set, file fallback otherwise
- **AI providers**: Groq, Hugging Face, Ollama, Gemini, deterministic fallback
- **Research input**: live arXiv feed plus multi-step synthesis

## Data Model

### Plans

- ID
- name
- intent
- revision
- graph nodes
- graph edges
- status
- research dossier

### Runs

- ID
- plan reference
- status
- progress
- current step
- output
- artifact

### Events

- append-only event log
- event type
- timestamp
- hash chain metadata

### Archive Records

- record ID
- run ID
- plan ID
- summary
- evidence entries
- hash chain metadata

### Replay Records

- replay ID
- archive linkage
- checkpoints across plan, run, event, archive, replay

## Environment Variables

### Runtime and providers

- `AI_PROVIDER`
- `LLM_PROVIDER`
- `AI_FALLBACK_PROVIDER`
- `RESEARCH_TOPIC_COUNT`
- `LLM_REQUEST_TIMEOUT_MS`
- `MAX_INTENT_CHARS`

### Auth

- `OPERATOR_PASSCODE`
- `AUTH_SESSION_SECRET`

### Persistence

- `DATABASE_URL`
- `DATABASE_SSL`

### Optional Ollama local runtime

- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `OLLAMA_AUTOSTART`
- `OLLAMA_PULL_ON_BOOT`
- `OLLAMA_STARTUP_TIMEOUT_MS`

## Operational Notes

- For production, Postgres-backed persistence should be used.
- Operator auth should be enabled in production.
- The research feed currently uses arXiv-based inputs unless expanded further.
- Black-box mode is presentation logic on the same app, not a separate product.

## License

This repository is **not open source**.

Use, copying, modification, distribution, deployment, sublicensing, or commercial use requires prior written permission from the rights holder.

See [LICENSE](C:\Users\antho\Documents\Codex\2026-05-08\https-github-com-reprewindai-dev-uacpgemini\LICENSE) for the full terms.

