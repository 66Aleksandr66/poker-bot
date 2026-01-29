# Poker Bot Setup

This repository contains a Telegram poker registration bot ("Poker Ботя").
The steps below prepare everything so you only need to add your Telegram token and launch.

## Prerequisites

- Node.js 20+ (or Docker)
- PostgreSQL (local or hosted)

## Quick start (local)

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create your environment file**

   ```bash
   cp .env.example .env
   ```

   Fill in:

   - `TELEGRAM_BOT_TOKEN` — your bot token
   - `DATABASE_URL` — connection string to your existing database

   Example:

   ```
   TELEGRAM_BOT_TOKEN=123456:ABCDEF
   DATABASE_URL=postgresql://user:pass@localhost:5432/poker_bot
   PORT=5000
   ```

3. **Run the bot**

   ```bash
   npm run dev
   ```

4. **Set the Telegram webhook**

   Replace `<your-domain>` with the public HTTPS domain pointing to your running server:

   ```bash
   https://<your-domain>/webhooks/telegram/action
   ```

## Quick start (Docker + Postgres)

1. **Create your environment file**

   ```bash
   cp .env.example .env
   ```

   Add your `TELEGRAM_BOT_TOKEN`. For a brand‑new local DB, you can use the default
   `DATABASE_URL` in `.env.example`.

2. **Start everything**

   ```bash
   docker compose up --build
   ```

3. **Set the webhook** (same as above).

## Docker Hub (build on the Docker website)

If you want to build and publish the image directly on Docker Hub, follow this UI flow:

1. **Sign in to Docker Hub** and create a new repository.
2. **Connect your GitHub/GitLab account** when prompted (OAuth).
3. In the repository settings, **enable “Automated Builds”**.
4. **Choose the branch** (for example `main` or `master`) and set the build context to the repo root.
5. Save the build settings and click **“Build”** to run the first build.
6. After the image is published, run it on your server:

   ```bash
   docker run -p 5000:5000 \
     -e TELEGRAM_BOT_TOKEN="<your-token>" \
     -e DATABASE_URL="<your-postgres-url>" \
     <your-dockerhub-username>/<repo>:latest
   ```

7. **Set the webhook** (same as above).

## Keeping your existing database

This project initializes tables using `CREATE TABLE IF NOT EXISTS`, so it will not
overwrite existing data. To keep your current poker history:

- Point `DATABASE_URL` to your existing PostgreSQL instance.
- If you're migrating from another server, restore your PostgreSQL dump into the new
  database **before** starting the app.

## Scripts

- `npm run dev` — run the bot in dev mode
- `npm run build` — build the Mastra bundle
- `npm run check` — TypeScript type check
