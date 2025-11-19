📘 Mastra AG-UI POC

A minimal proof of concept for integrating AG-UI with Mastra and a Vue 3 + Vite frontend.
The goal is to demonstrate AG-UI’s basic capabilities on top of a simple Mastra weather agent.

📁 Project Structure


    mastra-ag-ui-demo/
    ├── src/
    │ ├── mastra/
    │ ├── ag-ui-mastra.ts
    │
    ├── vue-agui-client/
    │ ├── src/
    │ ├── index.html
    │ └── ...
    │
    ├── package.json
    └── README.md


✅ What’s Already Implemented

Backend (src/ag-ui-mastra.ts)

— Express server with endpoint:
POST http://localhost:8000/mastra-agent/

— Accepts AG-UI payload:
threadId, runId, messages[], tools, context, forwardedProps, state.

— Input validation via zod.

— Streams AG-UI events via SSE:
RUN_STARTED → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT → TEXT_MESSAGE_END → RUN_FINISHED

— Uses a dummy agent that returns:
“Pseudo-agent response to: <message>”
and streams it in chunks.

Frontend (vue-agui-client)

— Vue 3 + TypeScript + Vite
— Chat.vue component:

• sends requests in AG-UI format
• reads SSE stream via getReader()
• parses events data:{...}
• assembles deltas from TEXT_MESSAGE_CONTENT
• displays assistant messages in the UI

🚀 How to Run

1. Backend (AG-UI server)
```
cd mastra-ag-ui-demo
npm install
npm run agui:dev
```


Server: http://localhost:8000/mastra-agent

2. Frontend (Vue) 

```
cd mastra-ag-ui-demo/vue-agui-client
npm install
npm run dev
```

Open at: http://localhost:5173

📋 Ticket Requirements — Current Status

Already done:

```
✔ AG-UI endpoint
✔ SSE streaming
✔ correct event format
✔ frontend client
✔ text chat
✔ RUN_* and TEXT_* events
```
Not yet implemented:
```
⏳ THINKING_STEP
⏳ UI_COMPONENT
⏳ Frontend tool calls
⏳ Interrupts / human-in-the-loop
⏳ Backend side-effects
⏳ Shared state
⏳ Connecting the real weatherAgent
```
🔧 Next Steps

Connect real weatherAgent

Add THINKING_STEP

Add UI component events

Implement frontend tool calls

Implement shared state

Implement interrupts and side effects

📝 Requirements

— Node.js ≥ 20.9.0
— npm
— Internet connection (for real LLM usage via Mastra)
