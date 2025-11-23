<template>
  <div class="chat-container">
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

        <!-- ✅ UI blocks прямо под сообщением ассистента -->
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

function findAssistantByMessageId(messageId: string) {
  return messages.value.find(
    (m) => m.role === "assistant" && m.messageId === messageId,
  );
}

async function send() {
  if (!userInput.value.trim()) return;

  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: userInput.value,
  };

  messages.value.push(userMessage);

  const payload = {
    threadId,
    runId: `run-${++runCounter}`,
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
