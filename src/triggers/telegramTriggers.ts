/**
 * Telegram Trigger - Command-based handler without AI
 */

import type { ContentfulStatusCode } from "hono/utils/http-status";
import { registerApiRoute } from "../mastra/inngest";
import { Mastra } from "@mastra/core";
import { handleCommand } from "../mastra/handlers/pokerCommandHandler";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.warn(
    "Trying to initialize Telegram triggers without TELEGRAM_BOT_TOKEN. Can you confirm that the Telegram integration is configured correctly?",
  );
}

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error("Cannot send message: TELEGRAM_BOT_TOKEN not set");
    return;
  }
  
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: "Markdown",
        }),
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      console.error("Telegram API error:", error);
    }
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
  }
}

export function registerTelegramCommandHandler() {
  return [
    registerApiRoute("/webhooks/telegram/action", {
      method: "POST",
      handler: async (c) => {
        const mastra = c.get("mastra");
        const logger = mastra.getLogger();
        
        try {
          const payload = await c.req.json();
          logger?.info("📝 [Telegram] Получен запрос", payload);
          
          const message = payload.message?.text || "";
          const telegramId = String(payload.message?.from?.id || "");
          const chatId = String(payload.message?.chat?.id || "");
          const userName = payload.message?.from?.username || "Unknown";
          
          if (!message || !telegramId || !chatId) {
            logger?.warn("📝 [Telegram] Пустое сообщение или нет ID");
            return c.text("OK", 200);
          }
          
          logger?.info(`🎲 [Poker Bot] Команда от ${userName} (${telegramId}): ${message}`);
          
          const response = await handleCommand(telegramId, message);
          
          logger?.info(`📤 [Poker Bot] Ответ: ${response.substring(0, 100)}...`);
          
          await sendTelegramMessage(chatId, response);
          
          return c.text("OK", 200);
        } catch (error) {
          logger?.error("Error handling Telegram webhook:", error);
          return c.text("Internal Server Error", 500);
        }
      },
    }),
  ];
}

export type TriggerInfoTelegramOnNewMessage = {
  type: "telegram/message";
  params: {
    userName: string;
    message: string;
  };
  payload: any;
};

export function registerTelegramTrigger({
  triggerType,
  handler,
}: {
  triggerType: string;
  handler: (
    mastra: Mastra,
    triggerInfo: TriggerInfoTelegramOnNewMessage,
  ) => Promise<void>;
}) {
  return [
    registerApiRoute("/webhooks/telegram/action", {
      method: "POST",
      handler: async (c) => {
        const mastra = c.get("mastra");
        const logger = mastra.getLogger();
        try {
          const payload = await c.req.json();

          logger?.info("📝 [Telegram] payload", payload);

          await handler(mastra, {
            type: triggerType,
            params: {
              userName: payload.message.from.username,
              message: payload.message.text,
            },
            payload,
          } as TriggerInfoTelegramOnNewMessage);

          return c.text("OK", 200);
        } catch (error) {
          logger?.error("Error handling Telegram webhook:", error);
          return c.text("Internal Server Error", 500);
        }
      },
    }),
  ];
}
