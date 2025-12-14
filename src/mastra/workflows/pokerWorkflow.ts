import { createStep, createWorkflow, inngest } from "../inngest";
import { z } from "zod";
import { pokerAgent } from "../agents/pokerAgent";

const processWithAgent = createStep({
  id: "process-with-agent",
  description: "Обрабатывает сообщение от Telegram через агента Poker Ботя",

  inputSchema: z.object({
    message: z.string().describe("Сообщение от пользователя"),
    telegramId: z.string().describe("Telegram ID пользователя"),
    userName: z.string().describe("Имя пользователя в Telegram"),
    chatId: z.string().describe("ID чата для ответа"),
  }),

  outputSchema: z.object({
    agentResponse: z.string(),
    chatId: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🎲 [Poker Workflow] Обработка сообщения...", inputData);

    const prompt = `Telegram ID пользователя: ${inputData.telegramId}
Имя в Telegram: ${inputData.userName}

Сообщение: ${inputData.message}`;

    const response = await pokerAgent.generateLegacy(
      [{ role: "user", content: prompt }],
      {
        resourceId: inputData.telegramId,
        threadId: `poker-${inputData.telegramId}`,
        maxSteps: 5,
      }
    );

    logger?.info("✅ [Poker Workflow] Ответ агента получен");

    return {
      agentResponse: response.text,
      chatId: inputData.chatId,
    };
  },
});

const sendToTelegram = createStep({
  id: "send-to-telegram",
  description: "Отправляет ответ агента в Telegram",

  inputSchema: z.object({
    agentResponse: z.string(),
    chatId: z.string(),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📤 [Poker Workflow] Отправка в Telegram...", { chatId: inputData.chatId });

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      logger?.error("❌ TELEGRAM_BOT_TOKEN не установлен!");
      return { success: false, message: "Telegram токен не найден" };
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: inputData.chatId,
            text: inputData.agentResponse,
            parse_mode: "HTML",
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        logger?.error("❌ Ошибка отправки в Telegram:", error);
        return { success: false, message: `Ошибка Telegram: ${error}` };
      }

      logger?.info("✅ [Poker Workflow] Сообщение отправлено в Telegram");
      return { success: true, message: "Сообщение успешно отправлено" };
    } catch (error) {
      logger?.error("❌ Ошибка отправки:", error);
      return { 
        success: false, 
        message: `Ошибка: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  },
});

export const pokerWorkflow = createWorkflow({
  id: "poker-workflow",

  inputSchema: z.object({
    message: z.string().describe("Сообщение от пользователя"),
    telegramId: z.string().describe("Telegram ID пользователя"),
    userName: z.string().describe("Имя пользователя в Telegram"),
    chatId: z.string().describe("ID чата для ответа"),
  }) as any,

  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
})
  .then(processWithAgent as any)
  .then(sendToTelegram as any)
  .commit();
