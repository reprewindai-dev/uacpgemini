# Quantum UACP v0

Quantum UACP is a runnable full-stack prototype for hybrid quantum/classical workflow orchestration with three locked user-facing surfaces and six backend object families.

## Features
- **Intent Console**: Convert natural language commands into deterministic plans using Gemini 3 Flash.
- **Execution Graph**: Visualize the hybrid logic sequences.
- **Ops / Control Plane**: Monitor real-time runs, event logs, and observability signals.
- **Deterministic Orchestration**: Built on the philosophy that "God does not play dice with the Control Plane."

## Technical Stack
- **Frontend**: React 19, Tailwind CSS 4, Motion, Lucide Icons.
- **Backend**: Express 4, Node.js, WebSockets (`ws`).
- **AI**: Google Gemini API (via `@google/genai`).

## Data Structure
- **Plans**: ID, Intent, Revision, Graph (Nodes/Edges), Status.
- **Runs**: ID, PlanID, Status (Pending, Executing, Completed), Progress, Steps.
- **Events**: Append-only log of system actions.
- **Signals**: Real-time observability (Coherence, Latency, Policy Alignment).

## Research Context
This prototype implements patterns for Universal Agency and Control Prototypes (UACP) as described in emerging quantum systems research (SSRN-adjacent signals). It ensures that while the quantum layer is probabilistic, the orchestration layer remains rigorous and policy-aligned.
