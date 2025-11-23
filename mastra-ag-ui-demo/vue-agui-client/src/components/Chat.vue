<template>
  <div class="chat-container">
    <!-- ✅ Thinking history (всегда сверху, накапливается) -->
    <div v-if="thinkingHistory.length" class="history-box">
      <div class="history-title">Thinking history</div>

      <div
        v-for="h in thinkingHistory"
        :key="h.runId"
        class="history-run"
      >
        <div class="history-run-title">
          Run {{ h.runId }}
        </div>
        <ul class="history-list">
          <li
            v-for="(s, i) in h.steps"
            :key="s.stepId"
            class="history-item finished"
          >
            <span class="dot" />
            <span class="history-text">{{ i + 1 }}. {{ s.title }}</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- ✅ Active thinking steps (только пока идёт run) -->
    <div v-if="thinkingSteps.length" class="thinking-box">
      <div class="thinking-title">Assistant is thinking…</div>
      <ul class="thinking-list">
        <li
          v-for="s in thinkingSteps"
          :key="s.stepId"
          class="thinking-item"
          :class="s.status"
        >
          <span class="dot" />
          <span class="thinking-text">{{ s.title }}</span>

          <!-- маленький спиннер только у текущего шага -->
          <span v-if="s.status === 'running'" class="spinner" />
        </li>
      </ul>
    </div>

    <!-- ✅ Messages -->
    <div class="messages">
      <div
        v-for="m in messages"
        :key="m.id"
        class="message"
        :class="m.role"
      >
        <div class="message-text">
          <strong>{{ m.role }}:</strong> {{ m.content }}
        </div>

        <!-- ✅ UI blocks под сообщением ассистента -->
        <div v-if="m.ui?.length" class="ui-blocks">
          <div v-for="(b, i) in m.ui" :key="b.id ?? i">
            <WeatherCard
              v-if="b.component === 'weather-card'"
              v-bind="b.props"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ✅ Input -->
    <form class="input-row" @submit.prevent="send">
      <input
        v-model="userInput"
        type="text"
        placeholder="Ask about weather..."
      />
      <button type="submit">Send</button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import WeatherCard from "./WeatherCard.vue";

type Role = "user" | "assistant" | "system";

type UiBlock = {
  id?: string;
  component: string;
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
  ui?: UiBlock[];
}

const messages = ref<ChatMessage[]>([]);
const userInput = ref("");

const threadId = "demo-thread";
let runCounter = 0;

// ✅ активные шаги (только текущий run)
const thinkingSteps = ref<ThinkingStep[]>([]);

// ✅ история шагов сверху (накапливается по run)
const thinkingHistory = ref<ThinkingRunHistory[]>([]);

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

// ✅ переносим активные steps в историю сверху и очищаем активные
function persistStepsToTopHistory(runId: string) {
  if (!thinkingSteps.value.length) return;

  // гарантируем что все стали finished
  const finishedSteps = thinkingSteps.value.map((s) => ({
    ...s,
    status: "finished" as const,
  }));

  thinkingHistory.value.unshift({
    runId,
    steps: finishedSteps,
  });

  thinkingSteps.value = [];
}

async function send() {
  if (!userInput.value.trim()) return;

  // сбрасываем steps для нового run
  thinkingSteps.value = [];

  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: userInput.value,
  };

  messages.value.push(userMessage);

  const runId = `run-${++runCounter}`;

  const payload = {
    threadId,
    runId,
    messages: messages.value.map(({ id, role, content }) => ({ id, role, content })),
    tools: [],
    context: [],
    forwardedProps: {},
    state: {},
  };

  userInput.value = "";

  const response = await fetch("http://localhost:8000/mastra-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    console.error("Bad response from mastra-agent");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    console.log("RAW SSE chunk:", chunk);

    const lines = chunk.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;

      const jsonStr = line.slice("data:".length).trim();
      if (!jsonStr) continue;

      try {
        const event = JSON.parse(jsonStr);

        // ✅ THINKING STEPS
        if (event.type === "STEP_STARTED") {
          upsertStep(
            event.stepId as string,
            (event.title as string) || "Thinking…",
            "running",
          );
        }

        if (event.type === "STEP_FINISHED") {
          finishStep(event.stepId as string);
        }

        // ✅ RUN закончился -> переносим steps в историю сверху
        if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
          persistStepsToTopHistory(runId);
        }

        // ✅ TEXT
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

          if (target) {
            target.content += event.delta;
          } else {
            messages.value.push({
              id: crypto.randomUUID(),
              role: "assistant",
              content: event.delta,
              messageId: msgId,
              ui: [],
            });
          }
        }

        // ✅ UI component
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
      } catch (e) {
        console.warn("Failed to parse SSE event json:", jsonStr, e);
      }
    }
  }
}
</script>

<style scoped>
.chat-container {
  max-width: 600px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ===== Thinking history ===== */
.history-box {
  border: 1px dashed #555;
  border-radius: 10px;
  padding: 10px 12px;
  background: rgba(90, 90, 90, 0.08);
}
.history-title {
  font-size: 13px;
  font-weight: 700;
  opacity: 0.9;
  margin-bottom: 6px;
}
.history-run {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255,255,255,0.12);
}
.history-run-title {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.8;
  margin-bottom: 4px;
}
.history-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 6px;
}
.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.history-item.finished {
  opacity: 0.55;
  text-decoration: line-through;
}
.history-item .dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #aaa;
  display: inline-block;
}
.history-text {
  white-space: pre-wrap;
}

/* ===== Active thinking ===== */
.thinking-box {
  border: 1px dashed #666;
  border-radius: 10px;
  padding: 10px 12px;
  background: rgba(120, 120, 120, 0.08);
}
.thinking-title {
  font-size: 13px;
  opacity: 0.9;
  margin-bottom: 6px;
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
  opacity: 1;
  font-weight: 600;
}
.thinking-item.running .dot {
  animation: pulse 1s infinite ease-in-out;
}
.thinking-item.finished {
  opacity: 0.55;
  text-decoration: line-through;
}
.spinner {
  margin-left: 4px;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(255,255,255,0.35);
  border-top-color: rgba(255,255,255,0.9);
  border-radius: 999px;
  animation: spin 0.8s linear infinite;
}

@keyframes pulse {
  0% { transform: scale(0.9); opacity: 0.4; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.4; }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ===== Chat ===== */
.messages {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 12px;
  min-height: 200px;
}
.message {
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.message.user {
  text-align: right;
}
.message-text {
  white-space: pre-wrap;
}
.ui-blocks {
  margin-left: 8px;
}

/* ===== Input ===== */
.input-row {
  display: flex;
  gap: 8px;
}
input {
  flex: 1;
  padding: 8px;
}
button {
  padding: 8px 12px;
}
</style>
