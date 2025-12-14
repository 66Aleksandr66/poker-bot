import { createTool } from "@mastra/core/tools";
import { z } from "zod";
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
      
      CREATE TABLE IF NOT EXISTS poker_games (
        id SERIAL PRIMARY KEY,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS poker_transactions (
        id SERIAL PRIMARY KEY,
        game_id INTEGER REFERENCES poker_games(id),
        player_id INTEGER REFERENCES poker_players(id),
        type VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_method VARCHAR(50),
        chips_1 INTEGER DEFAULT 0,
        chips_5 INTEGER DEFAULT 0,
        chips_25 INTEGER DEFAULT 0,
        chips_100 INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } finally {
    client.release();
  }
}

initializeDatabase().catch(console.error);

const jokesBigWin = [
  "🎰 Да ты сегодня просто машина! Казино плачет!",
  "💰 Вот это улов! Можно и на Мальдивы слетать!",
  "🔥 Горячая рука! Соперники в шоке!",
  "🏆 Покерфейс уровня: бог!",
  "💎 Сегодня ты — король стола!",
];

const jokesSmallWin = [
  "😊 Неплохо-неплохо, на шаурму хватит!",
  "👍 Маленькая победа — тоже победа!",
  "🙂 В плюсе? Уже хорошо!",
  "📈 Потихоньку растёшь!",
  "🎯 Точно в цель, пусть и небольшую!",
];

const jokesSmallLoss = [
  "😅 Ну бывает, не расстраивайся!",
  "🤷 Подумаешь, минус — зато опыт плюс!",
  "🎲 Дисперсия — такая дисперсия...",
  "💪 Завтра отыграешься!",
  "🍀 Удача просто отошла покурить!",
];

const jokesBigLoss = [
  "😭 Ой-ой-ой... Ну ничего, деньги — дело наживное!",
  "🎭 Сегодня не твой день, но завтра всё изменится!",
  "🐟 Бывает и на старуху проруха, рыбка!",
  "😬 Дисперсия бьёт больно, но ты крепкий!",
  "🔄 Что упало — то отрастёт! Может быть...",
];

function getRandomJoke(result: number): string {
  let jokes: string[];
  if (result >= 100) {
    jokes = jokesBigWin;
  } else if (result > 0) {
    jokes = jokesSmallWin;
  } else if (result >= -50) {
    jokes = jokesSmallLoss;
  } else {
    jokes = jokesBigLoss;
  }
  return jokes[Math.floor(Math.random() * jokes.length)];
}

function getPlayStyle(stats: { totalGames: number; totalResult: number; avgResult: number }): string {
  if (stats.totalGames < 3) {
    return "Недостаточно данных для определения стиля игры (нужно минимум 3 игры)";
  }
  
  const avgResult = stats.avgResult;
  let style: string;
  let description: string;
  
  if (avgResult > 50) {
    style = "Tight Aggressive (TAG)";
    description = "Играешь выборочно, но агрессивно. Отличный стиль!";
  } else if (avgResult > 0) {
    style = "Tight Passive";
    description = "Осторожный игрок, стабильный плюс.";
  } else if (avgResult > -30) {
    style = "Loose Passive";
    description = "Играешь много рук, но не слишком агрессивно.";
  } else {
    style = "Loose Aggressive (LAG)";
    description = "Много рук, много действий — иногда это работает!";
  }
  
  return `${style}\n${description}`;
}

export const pokerTool = createTool({
  id: "poker-tool",
  description: `Инструмент для управления покерным столом. Используй для:
- Регистрации игроков
- Создания и завершения игр
- Учёта бай-инов и ребаев
- Фиксации кэшаута с подсчётом фишек
- Получения статистики игроков
- Административных функций`,

  inputSchema: z.object({
    action: z.enum([
      "register_player",
      "start_game",
      "end_game",
      "add_buyin",
      "add_rebuy",
      "cashout",
      "player_stats",
      "game_report",
      "set_admin",
      "list_players",
      "active_game_status"
    ]).describe("Действие для выполнения"),
    telegramId: z.string().optional().describe("Telegram ID игрока"),
    playerName: z.string().optional().describe("Имя игрока"),
    amount: z.number().optional().describe("Сумма в долларах"),
    paymentMethod: z.enum(["cash", "zelle"]).optional().describe("Способ оплаты: cash или zelle"),
    chips1: z.number().optional().describe("Количество фишек номиналом $1"),
    chips5: z.number().optional().describe("Количество фишек номиналом $5"),
    chips25: z.number().optional().describe("Количество фишек номиналом $25"),
    chips100: z.number().optional().describe("Количество фишек номиналом $100"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.any().optional(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    const { action, telegramId, playerName, amount, paymentMethod, chips1, chips5, chips25, chips100 } = context;
    
    logger?.info(`🎲 [pokerTool] Выполняю действие: ${action}`, context);
    
    const client = await pool.connect();
    try {
      switch (action) {
        case "register_player": {
          if (!telegramId || !playerName) {
            return { success: false, message: "Укажи Telegram ID и имя игрока" };
          }
          
          const existing = await client.query(
            "SELECT * FROM poker_players WHERE telegram_id = $1",
            [telegramId]
          );
          
          if (existing.rows.length > 0) {
            return { 
              success: false, 
              message: `Игрок ${existing.rows[0].name} уже зарегистрирован!` 
            };
          }
          
          await client.query(
            "INSERT INTO poker_players (telegram_id, name) VALUES ($1, $2)",
            [telegramId, playerName]
          );
          
          logger?.info(`✅ [pokerTool] Игрок ${playerName} зарегистрирован`);
          return { 
            success: true, 
            message: `🎉 Добро пожаловать, ${playerName}! Ты успешно зарегистрирован в Poker Ботя!` 
          };
        }
        
        case "start_game": {
          const activeGame = await client.query(
            "SELECT * FROM poker_games WHERE status = 'active'"
          );
          
          if (activeGame.rows.length > 0) {
            return { 
              success: false, 
              message: "⚠️ Уже есть активная игра! Сначала заверши её." 
            };
          }
          
          const result = await client.query(
            "INSERT INTO poker_games (status) VALUES ('active') RETURNING id, created_at"
          );
          
          const gameId = result.rows[0].id;
          const createdAt = new Date(result.rows[0].created_at).toLocaleString('ru-RU');
          
          logger?.info(`✅ [pokerTool] Игра #${gameId} создана`);
          return { 
            success: true, 
            message: `🃏 Игра #${gameId} началась!\n📅 Время: ${createdAt}\n\nИгроки могут делать бай-ины!`,
            data: { gameId }
          };
        }
        
        case "end_game": {
          const game = await client.query(
            "SELECT * FROM poker_games WHERE status = 'active'"
          );
          
          if (game.rows.length === 0) {
            return { success: false, message: "❌ Нет активной игры!" };
          }
          
          const gameId = game.rows[0].id;
          
          const transactions = await client.query(`
            SELECT p.name, 
              SUM(CASE WHEN t.type IN ('buyin', 'rebuy') THEN t.amount ELSE 0 END) as total_in,
              SUM(CASE WHEN t.type = 'cashout' THEN t.amount ELSE 0 END) as total_out
            FROM poker_transactions t
            JOIN poker_players p ON t.player_id = p.id
            WHERE t.game_id = $1
            GROUP BY p.id, p.name
          `, [gameId]);
          
          let report = `🏁 ИГРА #${gameId} ЗАВЕРШЕНА!\n\n📊 РЕЗУЛЬТАТЫ:\n━━━━━━━━━━━━━━━━━━━━━\n`;
          let totalBank = 0;
          
          const results: { name: string; result: number }[] = [];
          
          for (const row of transactions.rows) {
            const totalIn = parseFloat(row.total_in) || 0;
            const totalOut = parseFloat(row.total_out) || 0;
            const result = totalOut - totalIn;
            totalBank += totalIn;
            results.push({ name: row.name, result });
          }
          
          results.sort((a, b) => b.result - a.result);
          
          for (const r of results) {
            const sign = r.result >= 0 ? "+" : "";
            const emoji = r.result >= 0 ? "🟢" : "🔴";
            report += `${emoji} ${r.name}: ${sign}$${r.result.toFixed(2)}\n`;
          }
          
          report += `━━━━━━━━━━━━━━━━━━━━━\n💰 Общий банк: $${totalBank.toFixed(2)}`;
          
          await client.query(
            "UPDATE poker_games SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE id = $1",
            [gameId]
          );
          
          logger?.info(`✅ [pokerTool] Игра #${gameId} завершена`);
          return { success: true, message: report, data: { gameId, results } };
        }
        
        case "add_buyin":
        case "add_rebuy": {
          if (!telegramId || !amount) {
            return { success: false, message: "Укажи Telegram ID и сумму" };
          }
          
          const player = await client.query(
            "SELECT * FROM poker_players WHERE telegram_id = $1",
            [telegramId]
          );
          
          if (player.rows.length === 0) {
            return { success: false, message: "❌ Игрок не зарегистрирован!" };
          }
          
          const activeGame = await client.query(
            "SELECT * FROM poker_games WHERE status = 'active'"
          );
          
          if (activeGame.rows.length === 0) {
            return { success: false, message: "❌ Нет активной игры!" };
          }
          
          const type = action === "add_buyin" ? "buyin" : "rebuy";
          const method = paymentMethod || "cash";
          
          await client.query(
            `INSERT INTO poker_transactions (game_id, player_id, type, amount, payment_method)
             VALUES ($1, $2, $3, $4, $5)`,
            [activeGame.rows[0].id, player.rows[0].id, type, amount, method]
          );
          
          const actionName = type === "buyin" ? "Бай-ин" : "Ребай";
          logger?.info(`✅ [pokerTool] ${actionName} $${amount} для ${player.rows[0].name}`);
          return { 
            success: true, 
            message: `💵 ${actionName} $${amount} (${method}) для ${player.rows[0].name} записан! Удачи за столом! 🍀` 
          };
        }
        
        case "cashout": {
          if (!telegramId) {
            return { success: false, message: "Укажи Telegram ID" };
          }
          
          const player = await client.query(
            "SELECT * FROM poker_players WHERE telegram_id = $1",
            [telegramId]
          );
          
          if (player.rows.length === 0) {
            return { success: false, message: "❌ Игрок не зарегистрирован!" };
          }
          
          const activeGame = await client.query(
            "SELECT * FROM poker_games WHERE status = 'active'"
          );
          
          if (activeGame.rows.length === 0) {
            return { success: false, message: "❌ Нет активной игры!" };
          }
          
          const c1 = chips1 || 0;
          const c5 = chips5 || 0;
          const c25 = chips25 || 0;
          const c100 = chips100 || 0;
          const totalChips = c1 * 1 + c5 * 5 + c25 * 25 + c100 * 100;
          
          const buyins = await client.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM poker_transactions
            WHERE game_id = $1 AND player_id = $2 AND type IN ('buyin', 'rebuy')
          `, [activeGame.rows[0].id, player.rows[0].id]);
          
          const totalIn = parseFloat(buyins.rows[0].total) || 0;
          const result = totalChips - totalIn;
          
          await client.query(
            `INSERT INTO poker_transactions (game_id, player_id, type, amount, chips_1, chips_5, chips_25, chips_100)
             VALUES ($1, $2, 'cashout', $3, $4, $5, $6, $7)`,
            [activeGame.rows[0].id, player.rows[0].id, totalChips, c1, c5, c25, c100]
          );
          
          const joke = getRandomJoke(result);
          const sign = result >= 0 ? "+" : "";
          const resultEmoji = result >= 0 ? "📈" : "📉";
          
          let message = `🎰 КЭШАУТ: ${player.rows[0].name}\n`;
          message += `━━━━━━━━━━━━━━━━━━━━━\n`;
          message += `💰 Фишки: $${totalChips}\n`;
          message += `  • $1 × ${c1} = $${c1}\n`;
          message += `  • $5 × ${c5} = $${c5 * 5}\n`;
          message += `  • $25 × ${c25} = $${c25 * 25}\n`;
          message += `  • $100 × ${c100} = $${c100 * 100}\n`;
          message += `━━━━━━━━━━━━━━━━━━━━━\n`;
          message += `📥 Вложено: $${totalIn}\n`;
          message += `${resultEmoji} Результат: ${sign}$${result.toFixed(2)}\n\n`;
          message += joke;
          
          logger?.info(`✅ [pokerTool] Кэшаут $${totalChips} для ${player.rows[0].name}, результат: ${sign}$${result}`);
          return { success: true, message, data: { totalChips, totalIn, result } };
        }
        
        case "player_stats": {
          if (!telegramId) {
            return { success: false, message: "Укажи Telegram ID" };
          }
          
          const player = await client.query(
            "SELECT * FROM poker_players WHERE telegram_id = $1",
            [telegramId]
          );
          
          if (player.rows.length === 0) {
            return { success: false, message: "❌ Игрок не зарегистрирован!" };
          }
          
          const stats = await client.query(`
            SELECT 
              COUNT(DISTINCT t.game_id) as total_games,
              COALESCE(SUM(CASE WHEN t.type IN ('buyin', 'rebuy') THEN t.amount ELSE 0 END), 0) as total_in,
              COALESCE(SUM(CASE WHEN t.type = 'cashout' THEN t.amount ELSE 0 END), 0) as total_out
            FROM poker_transactions t
            WHERE t.player_id = $1
          `, [player.rows[0].id]);
          
          const gameResults = await client.query(`
            SELECT 
              t.game_id,
              SUM(CASE WHEN t.type IN ('buyin', 'rebuy') THEN t.amount ELSE 0 END) as game_in,
              SUM(CASE WHEN t.type = 'cashout' THEN t.amount ELSE 0 END) as game_out
            FROM poker_transactions t
            WHERE t.player_id = $1
            GROUP BY t.game_id
          `, [player.rows[0].id]);
          
          const results = gameResults.rows.map(r => {
            const gameIn = parseFloat(r.game_in) || 0;
            const gameOut = parseFloat(r.game_out) || 0;
            return gameOut - gameIn;
          }).filter(r => !isNaN(r));
          
          const totalGames = parseInt(stats.rows[0].total_games) || 0;
          const totalIn = parseFloat(stats.rows[0].total_in) || 0;
          const totalOut = parseFloat(stats.rows[0].total_out) || 0;
          const totalResult = totalOut - totalIn;
          const avgResult = totalGames > 0 ? totalResult / totalGames : 0;
          
          const bestResult = results.length > 0 ? Math.max(...results) : 0;
          const worstResult = results.length > 0 ? Math.min(...results) : 0;
          
          const playStyle = getPlayStyle({ totalGames, totalResult, avgResult });
          
          const sign = totalResult >= 0 ? "+" : "";
          const resultEmoji = totalResult >= 0 ? "📈" : "📉";
          
          let message = `📊 СТАТИСТИКА: ${player.rows[0].name}\n`;
          message += `━━━━━━━━━━━━━━━━━━━━━\n`;
          message += `🎲 Игр сыграно: ${totalGames}\n`;
          message += `${resultEmoji} Общий результат: ${sign}$${totalResult.toFixed(2)}\n`;
          message += `📉 Средний результат: ${avgResult >= 0 ? "+" : ""}$${avgResult.toFixed(2)}\n`;
          message += `🏆 Лучший результат: +$${bestResult.toFixed(2)}\n`;
          message += `😢 Худший результат: $${worstResult.toFixed(2)}\n`;
          message += `━━━━━━━━━━━━━━━━━━━━━\n`;
          message += `🎭 СТИЛЬ ИГРЫ:\n${playStyle}`;
          
          logger?.info(`✅ [pokerTool] Статистика для ${player.rows[0].name}`);
          return { success: true, message, data: { totalGames, totalResult, avgResult, bestResult, worstResult } };
        }
        
        case "game_report": {
          const lastGame = await client.query(
            "SELECT * FROM poker_games ORDER BY id DESC LIMIT 1"
          );
          
          if (lastGame.rows.length === 0) {
            return { success: false, message: "❌ Игр пока не было!" };
          }
          
          const gameId = lastGame.rows[0].id;
          const gameStatus = lastGame.rows[0].status;
          
          const transactions = await client.query(`
            SELECT p.name, t.type, t.amount, t.payment_method, t.created_at
            FROM poker_transactions t
            JOIN poker_players p ON t.player_id = p.id
            WHERE t.game_id = $1
            ORDER BY t.created_at
          `, [gameId]);
          
          let message = `📋 ОТЧЁТ ПО ИГРЕ #${gameId}\n`;
          message += `Статус: ${gameStatus === 'active' ? '🟢 Активная' : '🔴 Завершена'}\n`;
          message += `━━━━━━━━━━━━━━━━━━━━━\n`;
          
          for (const t of transactions.rows) {
            const time = new Date(t.created_at).toLocaleTimeString('ru-RU');
            const typeEmoji = t.type === 'buyin' ? '💵' : t.type === 'rebuy' ? '🔄' : '💰';
            const typeName = t.type === 'buyin' ? 'Бай-ин' : t.type === 'rebuy' ? 'Ребай' : 'Кэшаут';
            message += `${time} ${typeEmoji} ${t.name}: ${typeName} $${parseFloat(t.amount).toFixed(2)}`;
            if (t.payment_method) {
              message += ` (${t.payment_method})`;
            }
            message += `\n`;
          }
          
          logger?.info(`✅ [pokerTool] Отчёт по игре #${gameId}`);
          return { success: true, message };
        }
        
        case "set_admin": {
          if (!telegramId) {
            return { success: false, message: "Укажи Telegram ID" };
          }
          
          await client.query(
            "UPDATE poker_players SET is_admin = TRUE WHERE telegram_id = $1",
            [telegramId]
          );
          
          logger?.info(`✅ [pokerTool] Установлен админ: ${telegramId}`);
          return { success: true, message: "👑 Права администратора выданы!" };
        }
        
        case "list_players": {
          const players = await client.query(
            "SELECT name, telegram_id, is_admin, created_at FROM poker_players ORDER BY name"
          );
          
          if (players.rows.length === 0) {
            return { success: true, message: "📋 Пока нет зарегистрированных игроков." };
          }
          
          let message = "📋 СПИСОК ИГРОКОВ:\n━━━━━━━━━━━━━━━━━━━━━\n";
          for (const p of players.rows) {
            const adminBadge = p.is_admin ? " 👑" : "";
            message += `• ${p.name}${adminBadge}\n`;
          }
          
          logger?.info(`✅ [pokerTool] Список игроков`);
          return { success: true, message, data: players.rows };
        }
        
        case "active_game_status": {
          const activeGame = await client.query(
            "SELECT * FROM poker_games WHERE status = 'active'"
          );
          
          if (activeGame.rows.length === 0) {
            return { success: true, message: "🔴 Сейчас нет активной игры.\n\nЧтобы начать новую игру, админ должен дать команду." };
          }
          
          const gameId = activeGame.rows[0].id;
          const createdAt = new Date(activeGame.rows[0].created_at).toLocaleString('ru-RU');
          
          const players = await client.query(`
            SELECT DISTINCT p.name,
              SUM(CASE WHEN t.type IN ('buyin', 'rebuy') THEN t.amount ELSE 0 END) as total_in
            FROM poker_transactions t
            JOIN poker_players p ON t.player_id = p.id
            WHERE t.game_id = $1
            GROUP BY p.id, p.name
          `, [gameId]);
          
          let message = `🟢 АКТИВНАЯ ИГРА #${gameId}\n`;
          message += `📅 Начало: ${createdAt}\n`;
          message += `━━━━━━━━━━━━━━━━━━━━━\n`;
          message += `👥 Игроки за столом:\n`;
          
          let totalBank = 0;
          for (const p of players.rows) {
            const amount = parseFloat(p.total_in) || 0;
            totalBank += amount;
            message += `• ${p.name}: $${amount.toFixed(2)}\n`;
          }
          
          message += `━━━━━━━━━━━━━━━━━━━━━\n`;
          message += `💰 Общий банк: $${totalBank.toFixed(2)}`;
          
          logger?.info(`✅ [pokerTool] Статус активной игры #${gameId}`);
          return { success: true, message, data: { gameId, players: players.rows, totalBank } };
        }
        
        default:
          return { success: false, message: "❌ Неизвестное действие" };
      }
    } catch (error) {
      logger?.error(`❌ [pokerTool] Ошибка:`, error);
      return { 
        success: false, 
        message: `❌ Ошибка: ${error instanceof Error ? error.message : String(error)}` 
      };
    } finally {
      client.release();
    }
  },
});
