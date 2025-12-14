# Replit.md

## Overview

**Poker Ботя** — Russian-language Telegram bot for tracking poker cash games. Uses strict command structure (no AI required).

## User Preferences

- Bot name: **Poker Ботя**
- Language: **Russian only**
- No AI — simple command-based interface
- Fun phrases at game end based on results

## Bot Commands

| Command | Description |
|---------|-------------|
| `/reg Имя` | Register player |
| `/start_game` | Start new game (admin only) |
| `/end_game` | End game and show results (admin only) |
| `/buyin сумма [способ]` | Buy-in (способ: cash/zelle) |
| `/rebuy сумма [способ]` | Rebuy |
| `/cashout $1 $5 $25 $100` | Cashout with chip counts |
| `/stats` | Player statistics |
| `/status` | Current game status |
| `/players` | List all players |
| `/help` | Show commands |

## System Architecture

### Files
- `src/mastra/handlers/pokerCommandHandler.ts` — Command parser and database operations
- `src/triggers/telegramTriggers.ts` — Telegram webhook handler
- `src/mastra/index.ts` — Mastra server configuration

### Database Tables
- `poker_players` — Player registry (telegram_id, name, is_admin)
- `poker_games` — Game sessions (status: active/ended)
- `poker_transactions` — Buy-ins, rebuys, cashouts with chip counts

### Features
- First registered player becomes admin automatically
- Admin-only game start/end
- Payment method tracking (cash/zelle)
- Chip counting for cashout ($1, $5, $25, $100)
- Fun phrases based on win/loss amount

## Environment Variables Required

- `DATABASE_URL`: PostgreSQL connection string
- `TELEGRAM_BOT_TOKEN`: Telegram bot token

## Deployment

1. Set TELEGRAM_BOT_TOKEN secret
2. Deploy the app
3. Set webhook: `https://your-app.replit.app/webhooks/telegram/action`
