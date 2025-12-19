/**
 * Telegram Trigger - Button-based handler without AI
 */

import type { ContentfulStatusCode } from "hono/utils/http-status";
import { registerApiRoute } from "../mastra/inngest";
import { Mastra } from "@mastra/core";
import { handleCommand, handleCallbackQuery, TelegramResponse } from "../mastra/handlers/pokerCommandHandler";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.warn(
    "Trying to initialize Telegram triggers without TELEGRAM_BOT_TOKEN. Can you confirm that the Telegram integration is configured correctly?",
  );
}

async function sendTelegramMessage(chatId: string, response: TelegramResponse): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error("Cannot send message: TELEGRAM_BOT_TOKEN not set");
    return;
  }
  
  try {
    const body: any = {
      chat_id: chatId,
      text: response.text,
      parse_mode: "Markdown",
    };
    
    if (response.reply_markup) {
      body.reply_markup = response.reply_markup;
    }
    
    const apiResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    
    if (!apiResponse.ok) {
      const error = await apiResponse.text();
      console.error("Telegram API error:", error);
    }
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
  }
}

async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  
  try {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
        }),
      }
    );
  } catch (error) {
    console.error("Failed to answer callback query:", error);
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
          
          if (payload.callback_query) {
            const callbackQuery = payload.callback_query;
            const telegramId = String(callbackQuery.from?.id || "");
            const chatId = String(callbackQuery.message?.chat?.id || "");
            const callbackData = callbackQuery.data || "";
            const callbackQueryId = callbackQuery.id;
            const userName = callbackQuery.from?.username || "Unknown";
            
            logger?.info(`🔘 [Poker Bot] Кнопка от ${userName} (${telegramId}): ${callbackData}`);
            
            await answerCallbackQuery(callbackQueryId);
            
            const response = await handleCallbackQuery(telegramId, callbackData);
            
            logger?.info(`📤 [Poker Bot] Ответ: ${response.text.substring(0, 100)}...`);
            
            await sendTelegramMessage(chatId, response);
            
            return c.text("OK", 200);
          }
          
          if (payload.message) {
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
            
            logger?.info(`📤 [Poker Bot] Ответ: ${response.text.substring(0, 100)}...`);
            
            await sendTelegramMessage(chatId, response);
            
            return c.text("OK", 200);
          }
          
          logger?.warn("📝 [Telegram] Неизвестный тип запроса");
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
