import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS poker_players (
        id SERIAL PRIMARY KEY,
        telegram_id VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_players_telegram_id ON poker_players(telegram_id);
      
      CREATE TABLE IF NOT EXISTS poker_games (
        id SERIAL PRIMARY KEY,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_games_status ON poker_games(status);
      
      CREATE TABLE IF NOT EXISTS poker_transactions (
        id SERIAL PRIMARY KEY,
        game_id INTEGER REFERENCES poker_games(id),
        player_id INTEGER REFERENCES poker_players(id),
        type VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        net_result DECIMAL(10,2),
        payment_method VARCHAR(50),
        chips_1 INTEGER DEFAULT 0,
        chips_5 INTEGER DEFAULT 0,
        chips_25 INTEGER DEFAULT 0,
        chips_100 INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_transactions_game_id ON poker_transactions(game_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_player_id ON poker_transactions(player_id);
    `);
  } finally {
    client.release();
  }
}

initializeDatabase().catch(console.error);

const phrasesBigWin = [
  "Сегодня стол работал на тебя. Банк плачет, а ты улыбаешься 😎",
  "Ты не играл в покер — ты преподавал мастер-класс",
  "Карты тебя слушались. Даже дилер был в шоке",
  "Сегодня ты — причина, по которой остальные задумались о смене хобби",
  "Банк ушёл к тебе. Добровольно. Без сопротивления",
];

const phrasesSmallWin = [
  "Без фейерверков, но с прибылью — солидно",
  "Чуть-чуть, но в плюс. Покер — игра терпеливых",
  "Не разнёс стол, но вышел победителем",
  "Спокойно, аккуратно и с деньгами в кармане",
  "Сегодня ты играл умнее, чем рискованнее",
];

const phrasesSmallLoss = [
  "Карты были против, но ты держался достойно",
  "Сегодня не твой день, но и не катастрофа",
  "Минус есть, но опыт дороже",
  "Почти получилось. В следующий раз зайдёт",
  "Ты проиграл немного — считай, оплатил обучение",
];

const phrasesBigLoss = [
  "Сегодня банк решил остаться не у тебя",
  "Карты видели всё… и были беспощадны",
  "Иногда лучший ход — встать из-за стола. Сегодня это был он",
  "Покер напомнил, кто тут главный",
  "Зато атмосфера за столом была отличная — благодаря тебе",
];

const phrasesSpecial = [
  "Играл красиво. Результат — это уже детали",
  "Сегодня ты был опасен… в теории",
  "Стратегия была. Карты — нет",
  "Ты заставил стол нервничать. Иногда даже себя",
  "Не каждый день заканчивается в плюс — но каждый день даёт историю",
];

function getRandomPhrase(result: number): string {
  let phrases: string[];
  if (result >= 100) {
    phrases = phrasesBigWin;
  } else if (result > 0) {
    phrases = phrasesSmallWin;
  } else if (result >= -50) {
    phrases = phrasesSmallLoss;
  } else {
    phrases = phrasesBigLoss;
  }
  return phrases[Math.floor(Math.random() * phrases.length)];
}

const HELP_MESSAGE = `🃏 *POKER БОТЯ* — Команды:

📝 *РЕГИСТРАЦИЯ:*
\`/reg Имя\` — зарегистрироваться
Пример: \`/reg Андрей\`

🎮 *ИГРА (только админ):*
\`/start_game\` — начать игру
\`/end_game\` — завершить игру

💰 *ДЕНЬГИ:*
\`/buyin сумма способ\` — бай-ин
\`/rebuy сумма способ\` — ребай
Способ: cash или zelle (по умолчанию cash)
Примеры:
  \`/buyin 100\`
  \`/buyin 50 zelle\`
  \`/rebuy 100 cash\`

🎰 *КЭШАУТ:*
\`/cashout $1 $5 $25 $100\`
Введи количество фишек каждого номинала
Пример: \`/cashout 10 6 2 1\`
(= 10×$1 + 6×$5 + 2×$25 + 1×$100)

📊 *ИНФОРМАЦИЯ:*
\`/stats\` — твоя статистика
\`/status\` — статус текущей игры
\`/players\` — список игроков
\`/help\` — эта справка`;

async function isPlayerAdmin(client: pg.PoolClient, telegramId: string): Promise<boolean> {
  const result = await client.query(
    "SELECT is_admin FROM poker_players WHERE telegram_id = $1",
    [telegramId]
  );
  return result.rows.length > 0 && result.rows[0].is_admin === true;
}

async function getPlayerCount(client: pg.PoolClient): Promise<number> {
  const result = await client.query("SELECT COUNT(*) as count FROM poker_players");
  return parseInt(result.rows[0].count) || 0;
}

export async function handleCommand(telegramId: string, message: string): Promise<string> {
  const text = message.trim();
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase();
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    if (command === "/start" || command === "/help") {
      await client.query('COMMIT');
      return HELP_MESSAGE;
    }
    
    if (command === "/reg") {
      const name = parts.slice(1).join(" ");
      if (!name) {
        await client.query('ROLLBACK');
        return "❌ Укажи имя!\nПример: `/reg Андрей`";
      }
      
      const existing = await client.query(
        "SELECT * FROM poker_players WHERE telegram_id = $1",
        [telegramId]
      );
      
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return `⚠️ Ты уже зарегистрирован как ${existing.rows[0].name}!`;
      }
      
      const playerCount = await getPlayerCount(client);
      const isFirstPlayer = playerCount === 0;
      
      await client.query(
        "INSERT INTO poker_players (telegram_id, name, is_admin) VALUES ($1, $2, $3)",
        [telegramId, name, isFirstPlayer]
      );
      
      await client.query('COMMIT');
      
      const adminNote = isFirstPlayer ? "\n👑 Ты первый игрок — теперь ты админ!" : "";
      return `🎉 Добро пожаловать, ${name}!${adminNote}\n\nНапиши /help для списка команд.`;
    }
    
    if (command === "/start_game") {
      const isAdmin = await isPlayerAdmin(client, telegramId);
      if (!isAdmin) {
        await client.query('ROLLBACK');
        return "⛔ Только админ может начать игру!";
      }
      
      const activeGame = await client.query(
        "SELECT * FROM poker_games WHERE status = 'active'"
      );
      
      if (activeGame.rows.length > 0) {
        await client.query('ROLLBACK');
        return "⚠️ Игра уже идёт! Сначала заверши её командой /end_game";
      }
      
      const result = await client.query(
        "INSERT INTO poker_games (status) VALUES ('active') RETURNING id"
      );
      
      await client.query('COMMIT');
      
      const gameId = result.rows[0].id;
      return `🃏 *ИГРА #${gameId} НАЧАЛАСЬ!*\n\nИгроки, делайте бай-ины!\nКоманда: \`/buyin сумма\``;
    }
    
    if (command === "/end_game") {
      const isAdmin = await isPlayerAdmin(client, telegramId);
      if (!isAdmin) {
        await client.query('ROLLBACK');
        return "⛔ Только админ может завершить игру!";
      }
      
      const game = await client.query(
        "SELECT * FROM poker_games WHERE status = 'active'"
      );
      
      if (game.rows.length === 0) {
        await client.query('ROLLBACK');
        return "❌ Нет активной игры!";
      }
      
      const gameId = game.rows[0].id;
      
      const transactions = await client.query(`
        SELECT p.name, p.telegram_id,
          SUM(CASE WHEN t.type IN ('buyin', 'rebuy') THEN t.amount ELSE 0 END) as total_in,
          SUM(CASE WHEN t.type = 'cashout' THEN t.amount ELSE 0 END) as total_out,
          SUM(CASE WHEN t.type = 'cashout' THEN t.net_result ELSE 0 END) as net_result
        FROM poker_transactions t
        JOIN poker_players p ON t.player_id = p.id
        WHERE t.game_id = $1
        GROUP BY p.id, p.name, p.telegram_id
      `, [gameId]);
      
      let report = `🏁 *ИГРА #${gameId} ЗАВЕРШЕНА!*\n\n📊 РЕЗУЛЬТАТЫ:\n━━━━━━━━━━━━━━━━━━━━━\n`;
      let totalBank = 0;
      
      const results: { name: string; result: number }[] = [];
      
      for (const row of transactions.rows) {
        const totalIn = parseFloat(row.total_in) || 0;
        const netResult = parseFloat(row.net_result) || 0;
        totalBank += totalIn;
        results.push({ name: row.name, result: netResult });
      }
      
      results.sort((a, b) => b.result - a.result);
      
      for (const r of results) {
        const sign = r.result >= 0 ? "+" : "";
        const emoji = r.result >= 0 ? "🟢" : "🔴";
        report += `${emoji} ${r.name}: ${sign}$${r.result.toFixed(0)}\n`;
        
        const phrase = getRandomPhrase(r.result);
        report += `   _${phrase}_\n\n`;
      }
      
      report += `━━━━━━━━━━━━━━━━━━━━━\n💰 Общий банк: $${totalBank.toFixed(0)}`;
      
      await client.query(
        "UPDATE poker_games SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE id = $1",
        [gameId]
      );
      
      await client.query('COMMIT');
      
      return report;
    }
    
    if (command === "/buyin" || command === "/rebuy") {
      const player = await client.query(
        "SELECT * FROM poker_players WHERE telegram_id = $1",
        [telegramId]
      );
      
      if (player.rows.length === 0) {
        await client.query('ROLLBACK');
        return "❌ Сначала зарегистрируйся!\nКоманда: `/reg Имя`";
      }
      
      const activeGame = await client.query(
        "SELECT * FROM poker_games WHERE status = 'active'"
      );
      
      if (activeGame.rows.length === 0) {
        await client.query('ROLLBACK');
        return "❌ Нет активной игры! Попроси админа начать игру.";
      }
      
      const amount = parseInt(parts[1]);
      if (!amount || amount <= 0) {
        await client.query('ROLLBACK');
        return `❌ Укажи сумму!\nПример: \`${command} 100\` или \`${command} 50 zelle\``;
      }
      
      const paymentMethod = parts[2]?.toLowerCase() === "zelle" ? "zelle" : "cash";
      const type = command === "/buyin" ? "buyin" : "rebuy";
      
      await client.query(
        `INSERT INTO poker_transactions (game_id, player_id, type, amount, payment_method)
         VALUES ($1, $2, $3, $4, $5)`,
        [activeGame.rows[0].id, player.rows[0].id, type, amount, paymentMethod]
      );
      
      await client.query('COMMIT');
      
      const actionName = type === "buyin" ? "Бай-ин" : "Ребай";
      return `💵 ${actionName} *$${amount}* (${paymentMethod}) записан!\n\n${player.rows[0].name}, удачи за столом! 🍀`;
    }
    
    if (command === "/cashout") {
      const player = await client.query(
        "SELECT * FROM poker_players WHERE telegram_id = $1",
        [telegramId]
      );
      
      if (player.rows.length === 0) {
        await client.query('ROLLBACK');
        return "❌ Ты не зарегистрирован!";
      }
      
      const activeGame = await client.query(
        "SELECT * FROM poker_games WHERE status = 'active'"
      );
      
      if (activeGame.rows.length === 0) {
        await client.query('ROLLBACK');
        return "❌ Нет активной игры!";
      }
      
      if (parts.length < 5) {
        await client.query('ROLLBACK');
        return `❌ Укажи количество фишек каждого номинала!

Формат: \`/cashout $1 $5 $25 $100\`

Пример: \`/cashout 10 6 2 1\`
= 10×$1 + 6×$5 + 2×$25 + 1×$100 = *$190*`;
      }
      
      const c1 = parseInt(parts[1]) || 0;
      const c5 = parseInt(parts[2]) || 0;
      const c25 = parseInt(parts[3]) || 0;
      const c100 = parseInt(parts[4]) || 0;
      const totalChips = c1 * 1 + c5 * 5 + c25 * 25 + c100 * 100;
      
      const buyins = await client.query(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM poker_transactions
        WHERE game_id = $1 AND player_id = $2 AND type IN ('buyin', 'rebuy')
      `, [activeGame.rows[0].id, player.rows[0].id]);
      
      const totalIn = parseFloat(buyins.rows[0].total) || 0;
      const netResult = totalChips - totalIn;
      
      await client.query(
        `INSERT INTO poker_transactions (game_id, player_id, type, amount, net_result, chips_1, chips_5, chips_25, chips_100)
         VALUES ($1, $2, 'cashout', $3, $4, $5, $6, $7, $8)`,
        [activeGame.rows[0].id, player.rows[0].id, totalChips, netResult, c1, c5, c25, c100]
      );
      
      await client.query('COMMIT');
      
      const phrase = getRandomPhrase(netResult);
      const sign = netResult >= 0 ? "+" : "";
      const resultEmoji = netResult >= 0 ? "📈" : "📉";
      
      let message = `🎰 *КЭШАУТ: ${player.rows[0].name}*\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━\n`;
      message += `💰 Фишки: *$${totalChips}*\n`;
      message += `  • $1 × ${c1} = $${c1}\n`;
      message += `  • $5 × ${c5} = $${c5 * 5}\n`;
      message += `  • $25 × ${c25} = $${c25 * 25}\n`;
      message += `  • $100 × ${c100} = $${c100 * 100}\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━\n`;
      message += `📥 Вложено: $${totalIn}\n`;
      message += `${resultEmoji} Результат: *${sign}$${netResult.toFixed(0)}*\n\n`;
      message += `_${phrase}_`;
      
      return message;
    }
    
    if (command === "/stats") {
      const player = await client.query(
        "SELECT * FROM poker_players WHERE telegram_id = $1",
        [telegramId]
      );
      
      if (player.rows.length === 0) {
        await client.query('ROLLBACK');
        return "❌ Ты не зарегистрирован!\nКоманда: `/reg Имя`";
      }
      
      const gameResults = await client.query(`
        SELECT 
          t.game_id,
          SUM(CASE WHEN t.type = 'cashout' THEN t.net_result ELSE 0 END) as game_result
        FROM poker_transactions t
        WHERE t.player_id = $1 AND t.type = 'cashout'
        GROUP BY t.game_id
      `, [player.rows[0].id]);
      
      const results = gameResults.rows.map(r => parseFloat(r.game_result) || 0);
      const totalGames = results.length;
      const totalResult = results.reduce((a, b) => a + b, 0);
      const avgResult = totalGames > 0 ? totalResult / totalGames : 0;
      const bestResult = results.length > 0 ? Math.max(...results) : 0;
      const worstResult = results.length > 0 ? Math.min(...results) : 0;
      
      await client.query('COMMIT');
      
      const sign = totalResult >= 0 ? "+" : "";
      const resultEmoji = totalResult >= 0 ? "📈" : "📉";
      
      let message = `📊 *СТАТИСТИКА: ${player.rows[0].name}*\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━\n`;
      message += `🎲 Игр сыграно: ${totalGames}\n`;
      message += `${resultEmoji} Общий результат: *${sign}$${totalResult.toFixed(0)}*\n`;
      
      if (totalGames > 0) {
        message += `📉 Средний результат: ${avgResult >= 0 ? "+" : ""}$${avgResult.toFixed(0)}\n`;
        message += `🏆 Лучший результат: +$${bestResult.toFixed(0)}\n`;
        message += `😢 Худший результат: $${worstResult.toFixed(0)}\n`;
      }
      
      return message;
    }
    
    if (command === "/status") {
      const activeGame = await client.query(
        "SELECT * FROM poker_games WHERE status = 'active'"
      );
      
      if (activeGame.rows.length === 0) {
        await client.query('COMMIT');
        return "🔴 Сейчас нет активной игры.\n\nАдмин может начать игру командой /start_game";
      }
      
      const gameId = activeGame.rows[0].id;
      
      const transactions = await client.query(`
        SELECT p.name,
          SUM(CASE WHEN t.type IN ('buyin', 'rebuy') THEN t.amount ELSE 0 END) as total_in,
          MAX(CASE WHEN t.type = 'cashout' THEN 1 ELSE 0 END) as cashed_out
        FROM poker_transactions t
        JOIN poker_players p ON t.player_id = p.id
        WHERE t.game_id = $1
        GROUP BY p.id, p.name
      `, [gameId]);
      
      await client.query('COMMIT');
      
      let totalBank = 0;
      let message = `🟢 *ИГРА #${gameId} — ИДЁТ*\n━━━━━━━━━━━━━━━━━━━━━\n`;
      
      for (const row of transactions.rows) {
        const totalIn = parseFloat(row.total_in) || 0;
        const status = row.cashed_out ? "✅" : "🎲";
        message += `${status} ${row.name}: $${totalIn.toFixed(0)}\n`;
        totalBank += totalIn;
      }
      
      message += `━━━━━━━━━━━━━━━━━━━━━\n💰 В банке: *$${totalBank.toFixed(0)}*`;
      
      return message;
    }
    
    if (command === "/players") {
      const players = await client.query(
        "SELECT name, is_admin FROM poker_players ORDER BY created_at"
      );
      
      await client.query('COMMIT');
      
      if (players.rows.length === 0) {
        return "📋 Пока нет зарегистрированных игроков.\n\nРегистрация: `/reg Имя`";
      }
      
      let message = "📋 *ИГРОКИ:*\n━━━━━━━━━━━━━━━━━━━━━\n";
      for (const p of players.rows) {
        const admin = p.is_admin ? " 👑" : "";
        message += `• ${p.name}${admin}\n`;
      }
      
      return message;
    }
    
    await client.query('COMMIT');
    return `❓ Неизвестная команда.\n\nНапиши /help для списка команд.`;
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Command error:", error);
    return "❌ Произошла ошибка. Попробуй ещё раз.";
  } finally {
    client.release();
  }
}
