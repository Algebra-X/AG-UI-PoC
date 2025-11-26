<template>
  <div class="chat-container">
    <!-- ✅ Unified Thinking Panel -->
    <div v-if="hasAnyThinking" class="thinking-panel">
      <div class="thinking-panel-title">
        🧠 Thinking
        <span v-if="activeRunId" class="badge">active: {{ activeRunId }}</span>
      </div>

      <!-- Active steps -->
      <div v-if="thinkingSteps.length" class="active-steps">
        <div class="section-title">Now doing</div>
        <ul class="thinking-list">
          <li
            v-for="(s, i) in thinkingSteps"
            :key="s.stepId"
            class="thinking-item"
            :class="s.status"
          >
            <span class="dot" />
            <span class="thinking-text">{{ i + 1 }}. {{ prettyStepTitle(s.title) }}</span>
            <span v-if="s.status === 'running'" class="spinner" />
          </li>
        </ul>
      </div>

      <!-- History -->
      <div v-if="thinkingHistory.length" class="history-steps">
        <div class="section-title">Thinking history</div>

        <div
          v-for="h in thinkingHistory"
          :key="h.runId"
          class="history-run"
        >
          <button class="history-run-header" @click="toggleRun(h.runId)">
            <span class="run-title">
              {{ prettyRunTitle(h) }}
              <span class="run-id">({{ h.runId }})</span>
            </span>

            <span class="muted">{{ h.steps.length }} steps</span>
            <span class="chev">{{ expandedRuns.has(h.runId) ? "▾" : "▸" }}</span>
          </button>

          <ul
            v-if="expandedRuns.has(h.runId)"
            class="thinking-list history-list"
          >
            <li
              v-for="(s, i) in h.steps"
              :key="s.stepId"
              class="thinking-item finished"
            >
              <span class="dot" />
              <span class="thinking-text">{{ i + 1 }}. {{ prettyStepTitle(s.title) }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- ✅ Messages -->
    <div class="messages">
      <div v-for="m in messages" :key="m.id" class="message" :class="m.role">
        <div class="message-text">
          <strong>{{ m.role }}:</strong> {{ m.content }}
        </div>

        <div v-if="m.ui?.length" class="ui-blocks">
          <div v-for="(b, i) in m.ui" :key="b.id ?? i">
            <WeatherCard
              v-if="b.component === 'weather-card'"
              v-bind="getWeatherProps(b)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ✅ Input -->
    <form class="input-row" @submit.prevent="sendUser">
      <input
        v-model="userInput"
        type="text"
        placeholder="Ask about weather or time..."
      />
      <button type="submit">Send</button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import WeatherCard from "./WeatherCard.vue";

type Role = "user" | "assistant" | "system" | "tool";

type WeatherCardProps = {
  location: string;
  temperature: string;
  status: string;
  humidity?: string;
  wind?: string;
};

type UiBlock =
  | {
      id?: string;
      component: "weather-card";
      props: WeatherCardProps;
    }
  | {
      id?: string;
      component: string;      // другие компоненты
      props: Record<string, any>;
    };

type StepStatus = "running" | "finished";
type ThinkingStep = {
  stepId: string;
  title: string;
  status: StepStatus;
};

type ThinkingRunHistory = {
  runId: string;
  steps: ThinkingStep[];
};

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  messageId?: string;
  toolCallId?: string;
  name?: string; // tool name
  ui?: UiBlock[];
}

const messages = ref<ChatMessage[]>([]);
const userInput = ref("");

const threadId = "demo-thread";
let runCounter = 0;

// active + history steps
const thinkingSteps = ref<ThinkingStep[]>([]);
const thinkingHistory = ref<ThinkingRunHistory[]>([]);

// UI state: which history runs expanded
const expandedRuns = ref<Set<string>>(new Set());

// derived
const activeRunId = ref<string | null>(null);

const hasAnyThinking = computed(
  () => thinkingSteps.value.length > 0 || thinkingHistory.value.length > 0
);

function toggleRun(runId: string) {
  const set = expandedRuns.value;
  if (set.has(runId)) set.delete(runId);
  else set.add(runId);
  expandedRuns.value = new Set(set);
}

/** Хелпер, чтобы TS точно знал тип пропсов WeatherCard */
function getWeatherProps(block: UiBlock): WeatherCardProps {
  return block.props as WeatherCardProps;
}

function prettyStepTitle(title: string) {
  return title.trim();
}


function prettyRunTitle(h: ThinkingRunHistory) {
  const titles = h.steps.map(s => s.title.toLowerCase());

  const isTimeFlow =
    titles.some(t => t.includes("time")) ||
    titles.some(t => t.includes("local time")) ||
    titles.some(t => t.includes("browser time")) ||
    titles.some(t => t.includes("frontend time"));

  if (isTimeFlow) {
    const isToolRequestRun =
      titles.some(t => t.includes("requesting local time"));

    const isToolResultRun =
      titles.some(t => t.includes("reading the time returned")) ||
      titles.some(t => t.includes("replying with the user's local time")) ||
      titles.some(t => t.includes("composing the final time answer")) ||
      titles.some(t => t.includes("formatting final answer"));

    if (isToolRequestRun) return "🕒 Time — запрос времени у браузера";
    if (isToolResultRun) return "🕒 Time — ответ по результату тулзы";
    return "🕒 Time";
  }

  return "⛅ Weather";
}

/** =========================================================
 *  Steps helpers
 *  ========================================================= */
function findAssistantByMessageId(messageId: string) {
  return messages.value.find(
    (m) => m.role === "assistant" && m.messageId === messageId,
  );
}

function upsertStep(stepId: string, title: string, status: StepStatus) {
  const existing = thinkingSteps.value.find((s) => s.stepId === stepId);
  if (existing) {
    existing.title = title ?? existing.title;
    existing.status = status;
  } else {
    thinkingSteps.value.push({ stepId, title, status });
  }
}
function finishStep(stepId: string) {
  const s = thinkingSteps.value.find((x) => x.stepId === stepId);
  if (s) s.status = "finished";
}
function persistStepsToTopHistory(runId: string) {
  if (!thinkingSteps.value.length) return;

  const finishedSteps = thinkingSteps.value.map((s) => ({
    ...s,
    status: "finished" as const,
  }));

  thinkingHistory.value.unshift({ runId, steps: finishedSteps });
  expandedRuns.value.add(runId);
  expandedRuns.value = new Set(expandedRuns.value);

  thinkingSteps.value = [];
  activeRunId.value = null;
}

/** =========================================================
 *  CLIENT TOOLS
 *  ========================================================= */
const clientTools: Record<string, (args: any) => Promise<string>> = {
  async getClientTime(args: any) {
    const now = new Date();
    if (args?.format === "iso") return now.toISOString();
    return now.toLocaleString();
  },
};

type PendingToolCall = {
  toolCallId: string;
  toolCallName: string;
  args: any;
};
let pendingToolCall: PendingToolCall | null = null;

const toolArgsById = new Map<string, string>();

function hasToolResult(toolCallId: string) {
  return messages.value.some(
    (m) => m.role === "tool" && m.toolCallId === toolCallId,
  );
}

async function runAgent(runId: string) {
  activeRunId.value = runId;

  const payload = {
    threadId,
    runId,
    messages: messages.value.map(({ id, role, content, toolCallId, name }) => ({
      id, role, content, toolCallId, name
    })),
    tools: [
      {
        name: "getClientTime",
        description: "Returns the user's local time from the browser.",
        parameters: {
          type: "object",
          properties: { format: { type: "string" } },
        },
      },
    ],
    context: [],
    forwardedProps: {},
    state: {},
  };

  const response = await fetch("http://localhost:8000/mastra-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    console.error("Bad response from mastra-agent");
    activeRunId.value = null;
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.slice("data:".length).trim();
      if (!jsonStr) continue;

      try {
        const event = JSON.parse(jsonStr);

        // Thinking steps
        if (event.type === "STEP_STARTED") {
          upsertStep(event.stepId, event.title || "Thinking…", "running");
        }
        if (event.type === "STEP_FINISHED") {
          finishStep(event.stepId);
        }

        // Tool calls (frontend)
        if (event.type === "TOOL_CALL_START") {
          toolArgsById.set(event.toolCallId, "");
          pendingToolCall = {
            toolCallId: event.toolCallId,
            toolCallName: event.toolCallName,
            args: {},
          };
        }

        if (event.type === "TOOL_CALL_ARGS") {
          const prev = toolArgsById.get(event.toolCallId) || "";
          toolArgsById.set(event.toolCallId, prev + (event.delta || ""));
        }

        if (event.type === "TOOL_CALL_END") {
          const rawArgs = toolArgsById.get(event.toolCallId) || "{}";
          let argsObj: any = {};
          try { argsObj = JSON.parse(rawArgs); } catch {}
          if (pendingToolCall && pendingToolCall.toolCallId === event.toolCallId) {
            pendingToolCall.args = argsObj;
          }
        }

        // Text
        if (event.type === "TEXT_MESSAGE_START") {
          const msgId = event.messageId as string;
          if (!findAssistantByMessageId(msgId)) {
            messages.value.push({
              id: crypto.randomUUID(),
              role: "assistant",
              content: "",
              messageId: msgId,
              ui: [],
            });
          }
        }

        if (event.type === "TEXT_MESSAGE_CONTENT" && typeof event.delta === "string") {
          const msgId = event.messageId as string;
          const target = findAssistantByMessageId(msgId);
          if (target) target.content += event.delta;
          else {
            messages.value.push({
              id: crypto.randomUUID(),
              role: "assistant",
              content: event.delta,
              messageId: msgId,
              ui: [],
            });
          }
        }

        // UI blocks
        if (event.type === "UI_COMPONENT") {
          const msgId = event.messageId as string;
          const target = findAssistantByMessageId(msgId);

          const block: UiBlock = {
            id: crypto.randomUUID(),
            component: event.component,
            props: event.props ?? {},
          };

          if (target) {
            target.ui ??= [];
            target.ui.push(block);
          } else {
            messages.value.push({
              id: crypto.randomUUID(),
              role: "assistant",
              content: "",
              messageId: msgId,
              ui: [block],
            });
          }
        }

        // Run end
        if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
          persistStepsToTopHistory(runId);

          if (event.pendingToolCall) {
            pendingToolCall = event.pendingToolCall as PendingToolCall;
          }

          // We execute the tool only if there is no result yet.
          if (pendingToolCall && !hasToolResult(pendingToolCall.toolCallId)) {
            const toolFn = clientTools[pendingToolCall.toolCallName];
            if (toolFn) {
              const resultText = await toolFn(pendingToolCall.args);

              messages.value.push({
                id: crypto.randomUUID(),
                role: "tool",
                name: pendingToolCall.toolCallName,
                toolCallId: pendingToolCall.toolCallId,
                content: resultText,
              });

              const followUpRunId = `run-${++runCounter}`;
              pendingToolCall = null; 
              await runAgent(followUpRunId);
            } else {
              console.warn("No client tool handler for", pendingToolCall.toolCallName);
              pendingToolCall = null;
            }
          } else {
            pendingToolCall = null;
          }
        }
      } catch (e) {
        console.warn("Failed to parse SSE event json:", jsonStr, e);
      }
    }
  }
}

async function sendUser() {
  if (!userInput.value.trim()) return;

  thinkingSteps.value = [];

  messages.value.push({
    id: crypto.randomUUID(),
    role: "user",
    content: userInput.value,
  });

  const runId = `run-${++runCounter}`;
  userInput.value = "";

  await runAgent(runId);
}
</script>

<style scoped>
.chat-container {
  max-width: 640px;
  margin: 0 auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ===== Unified Thinking Panel ===== */
.thinking-panel {
  border: 1px dashed rgba(255,255,255,0.25);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(120,120,120,0.08);
  display: grid;
  gap: 10px;
}
.thinking-panel-title {
  font-size: 13px;
  font-weight: 700;
  opacity: 0.95;
  display: flex;
  align-items: center;
  gap: 8px;
}
.badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255,255,255,0.08);
  opacity: 0.9;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.8;
  margin-bottom: 4px;
}

.thinking-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 6px;
}

.thinking-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.thinking-item .dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #aaa;
  display: inline-block;
}

.thinking-item.running {
  font-weight: 600;
  opacity: 1;
}
.thinking-item.running .dot {
  animation: pulse 1s infinite ease-in-out;
}

.thinking-item.finished {
  opacity: 0.55;
  text-decoration: line-through;
}

/* spinner */
.spinner {
  margin-left: 4px;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(255,255,255,0.35);
  border-top-color: rgba(255,255,255,0.9);
  border-radius: 999px;
  animation: spin 0.8s linear infinite;
}

/* history run accordion */
.history-run {
  border-top: 1px dashed rgba(255,255,255,0.12);
  padding-top: 8px;
  margin-top: 6px;
}
.history-run-header {
  width: 100%;
  background: transparent;
  border: none;
  color: inherit;
  padding: 4px 0;
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  opacity: 0.9;
}
.history-run-header:hover { opacity: 1; }
.muted { opacity: 0.6; font-weight: 400; }
.chev { opacity: 0.8; }

.run-title { display: inline-flex; align-items: center; gap: 6px; }
.run-id {
  font-size: 11px;
  opacity: 0.55;
  font-weight: 400;
}

@keyframes pulse {
  0% { transform: scale(0.9); opacity: 0.4; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.4; }
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ===== Chat ===== */
.messages {
  border: 1px solid #ddd;
  border-radius: 10px;
  padding: 12px;
  min-height: 220px;
}
.message {
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.message.user { text-align: right; }
.message-text { white-space: pre-wrap; }
.ui-blocks { margin-left: 8px; }

/* ===== Input ===== */
.input-row {
  display: flex;
  gap: 8px;
}
input { flex: 1; padding: 8px; }
button { padding: 8px 12px; }
</style>
