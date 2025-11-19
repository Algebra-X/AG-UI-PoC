<template>
  <div class="chat-container">
    <div class="messages">
      <div
        v-for="m in messages"
        :key="m.id"
        class="message"
        :class="m.role"
      >
        <strong>{{ m.role }}:</strong> {{ m.content }}
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

type Role = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
}

const messages = ref<ChatMessage[]>([]);
const userInput = ref("");

const threadId = "demo-thread";
let runCounter = 0;

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
    messages: messages.value,
    tools: [],
    context: [],
    forwardedProps: {},
    state: {},
  };

  userInput.value = "";

  const response = await fetch("http://localhost:8000/mastra-agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    console.error("Bad response from mastra-agent");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let assistantText = "";

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

        if (event.type === "TEXT_MESSAGE_CONTENT" && typeof event.delta === "string") {
          assistantText += event.delta;
        }
      } catch (e) {
        console.warn("Failed to parse SSE event json:", jsonStr, e);
      }
    }
  }

  if (assistantText) {
    messages.value.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: assistantText,
    });
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
  margin-bottom: 8px;
}

.message.user {
  text-align: right;
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
