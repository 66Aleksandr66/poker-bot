# Replit.md

## Overview

This is a Mastra-based AI agent automation platform. The project implements **Poker Ботя** — a Russian-language Telegram bot for tracking poker cash games with buy-ins, rebuys, cashouts, player statistics, and fun comments. The system uses Mastra's workflow engine with Inngest for durable execution.

## User Preferences

- Bot name: **Poker Ботя**
- Language: **Russian only**
- No optional features — only core functionality
- Preferred communication style: Simple, everyday language.

## System Architecture

### Core Framework
- **Mastra Framework**: TypeScript-based AI agent framework providing agents, tools, and workflows
- **Inngest Integration**: Durable workflow execution layer that ensures reliability and resumability
- **Event-Driven Architecture**: Webhooks and cron triggers for automation entry points

### Agent System
- Agents use LLMs (OpenAI/OpenRouter) with tools to solve tasks
- Memory system with conversation history, semantic recall, and working memory
- Agents can be composed into networks for complex multi-agent coordination

### Workflow Engine
- Graph-based workflow orchestration with `createWorkflow` and `createStep`
- Supports branching, parallel execution, and human-in-the-loop patterns
- Suspend/resume capabilities for workflows requiring external input
- Step-level retries for handling transient failures

### Trigger System
- **Telegram Triggers** (`src/triggers/telegramTriggers.ts`): Handle incoming Telegram bot messages
- **Slack Triggers** (`src/triggers/slackTriggers.ts`): Process Slack events
- **Cron Triggers** (`src/triggers/cronTriggers.ts`): Time-based scheduled automations
- **Webhook Triggers** (`src/triggers/exampleConnectorTrigger.ts`): Generic webhook handlers for third-party services

### Data Flow
1. External event (webhook/cron) → Trigger handler
2. Trigger validates payload → Creates workflow run
3. Inngest orchestrates workflow execution step-by-step
4. Each step result is memoized for durability
5. Workflow can suspend for human input and resume later

### Key Design Decisions
- **Inngest for Durability**: All workflows run through Inngest to ensure execution survives failures
- **Mastra Playground UI**: Requires `generateLegacy` method for backwards compatibility
- **TypeScript ES Modules**: Uses ES2022 modules with bundler resolution
- **Zod Validation**: All schemas use Zod for runtime type safety

## External Dependencies

### AI/LLM Providers
- **OpenAI** (`@ai-sdk/openai`): Primary LLM provider
- **OpenRouter** (`@openrouter/ai-sdk-provider`): Alternative model routing

### Database & Storage
- **PostgreSQL** (`@mastra/pg`, `pg`): Primary persistent storage with pgvector for semantic search
- **LibSQL** (`@mastra/libsql`): Alternative lightweight storage option

### Workflow Orchestration
- **Inngest** (`inngest`, `@mastra/inngest`, `@inngest/realtime`): Durable workflow execution and real-time updates

### Messaging Integrations
- **Telegram**: Bot integration via webhook triggers (TELEGRAM_BOT_TOKEN required)
- **Slack** (`@slack/web-api`): Slack bot integration

### Search & Retrieval
- **Exa** (`exa-js`): Web search capabilities for agents

### MCP Integration
- **MCP Server** (`@mastra/mcp`): Model Context Protocol for tool/resource sharing

### Environment Variables Required
- `OPENAI_API_KEY`: OpenAI API access
- `DATABASE_URL`: PostgreSQL connection string
- `TELEGRAM_BOT_TOKEN`: Telegram bot authentication
- `INNGEST_SIGNING_KEY`: Inngest authentication (production)