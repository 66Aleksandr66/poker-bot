# Replit.md

## Overview

**Poker Ботя** — Russian-language Telegram bot for tracking poker cash games. Uses button-based interface (no AI required).

## User Preferences

- Bot name: **Poker Ботя**
- Language: **Russian only**
- No AI — simple button-based interface
- Fun phrases at game end based on results
- Fixed amounts: $20 buy-in/rebuy (200 chips = $20)

## Bot Interface

### Button-Based Flow
1. `/start` — Prompts "Введите ваше имя:" for new users
2. User types name (no command needed)
3. `/menu` or `/start` — Show main menu with buttons
4. All other actions via inline buttons

### Main Menu Buttons
| Button | Description |
|--------|-------------|
| 🎮 Вступить в игру ($20) | Join game (shows payment selection) |
| 💰 Rebuy +$20 | Buy more chips (shows payment selection) |
| 🎰 Кэшаут | Enter total chips remaining |
| 📊 Статус игры | Current game status |
| 📈 Моя статистика | Player statistics |
| 👥 Игроки | List all players |
| 🎲 Начать игру | Start new game (admin only) |
| 🏁 Завершить игру | End game (admin only) |
| 🗑️ Обнулить статистику | Reset all stats (admin only, with confirmation) |

### Payment Selection
After "Join" or "Rebuy":
- 💵 Cash
- 💳 Zelle

### Cashout Flow
1. Player clicks "Кэшаут"
2. Bot asks for total chip count
3. Player sends number (e.g., 250)
4. Bot calculates result (200 chips = $20)

## System Architecture

### Files
- `src/mastra/handlers/pokerCommandHandler.ts` — Command/callback handler and database operations
- `src/triggers/telegramTriggers.ts` — Telegram webhook handler (messages + callbacks)
- `src/mastra/index.ts` — Mastra server configuration

### Database Tables
- `poker_players` — Player registry (telegram_id, name, is_admin)
- `poker_games` — Game sessions (status: active/ended)
- `poker_transactions` — Buy-ins, rebuys, cashouts with chip totals
- `poker_pending_actions` — Tracks pending user inputs (e.g., awaiting chip count)

### Key Constants
- `BUYIN_AMOUNT = 20` — Fixed $20 per buy-in/rebuy
- `CHIPS_PER_BUYIN = 200` — 200 chips = $20

### Features
- First registered player becomes admin automatically
- Admin-only game start/end
- Payment method tracking (cash/zelle) via buttons
- Simple chip counting (total chips, not denominations)
- Fun phrases based on win/loss amount

## Environment Variables Required

- `DATABASE_URL`: PostgreSQL connection string
- `TELEGRAM_BOT_TOKEN`: Telegram bot token

## Deployment

1. Set TELEGRAM_BOT_TOKEN secret
2. Deploy the app
3. Set webhook: `https://your-app.replit.app/webhooks/telegram/action`
