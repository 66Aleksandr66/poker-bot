import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const BUYIN_AMOUNT = 20;
const CHIPS_PER_BUYIN = 200;

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
        chips_total INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_transactions_game_id ON poker_transactions(game_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_player_id ON poker_transactions(player_id);

      CREATE TABLE IF NOT EXISTS poker_pending_actions (
        id SERIAL PRIMARY KEY,
        telegram_id VARCHAR(255) NOT NULL,
        action_type VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await client.query(`
      ALTER TABLE poker_transactions ADD COLUMN IF NOT EXISTS net_result DECIMAL(10,2);
      ALTER TABLE poker_transactions ADD COLUMN IF NOT EXISTS chips_total INTEGER DEFAULT 0;
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

export interface TelegramResponse {
  text: string;
  reply_markup?: {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
}

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

async function getPlayer(client: pg.PoolClient, telegramId: string) {
  const result = await client.query(
    "SELECT * FROM poker_players WHERE telegram_id = $1",
    [telegramId]
  );
  return result.rows[0] || null;
}

async function getActiveGame(client: pg.PoolClient) {
  const result = await client.query(
    "SELECT * FROM poker_games WHERE status = 'active'"
  );
  return result.rows[0] || null;
}

async function isPlayerInGame(client: pg.PoolClient, gameId: number, playerId: number): Promise<boolean> {
  const result = await client.query(
    "SELECT * FROM poker_transactions WHERE game_id = $1 AND player_id = $2",
    [gameId, playerId]
  );
  return result.rows.length > 0;
}

async function hasPlayerCashedOut(client: pg.PoolClient, gameId: number, playerId: number): Promise<boolean> {
  const result = await client.query(
    "SELECT * FROM poker_transactions WHERE game_id = $1 AND player_id = $2 AND type = 'cashout'",
    [gameId, playerId]
  );
  return result.rows.length > 0;
}

async function setPendingAction(client: pg.PoolClient, telegramId: string, actionType: string): Promise<void> {
  await client.query("DELETE FROM poker_pending_actions WHERE telegram_id = $1", [telegramId]);
  await client.query(
    "INSERT INTO poker_pending_actions (telegram_id, action_type) VALUES ($1, $2)",
    [telegramId, actionType]
  );
}

async function getPendingAction(client: pg.PoolClient, telegramId: string): Promise<string | null> {
  const result = await client.query(
    "SELECT action_type FROM poker_pending_actions WHERE telegram_id = $1",
    [telegramId]
  );
  return result.rows[0]?.action_type || null;
}

async function clearPendingAction(client: pg.PoolClient, telegramId: string): Promise<void> {
  await client.query("DELETE FROM poker_pending_actions WHERE telegram_id = $1", [telegramId]);
}

function getMainMenuKeyboard(isAdmin: boolean, isInGame: boolean, hasActiveGame: boolean): TelegramResponse["reply_markup"] {
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  
  if (hasActiveGame) {
    if (!isInGame) {
      keyboard.push([{ text: "🎮 Вступить в игру ($20)", callback_data: "join_game" }]);
    } else {
      keyboard.push([
        { text: "💰 Rebuy +$20", callback_data: "rebuy" },
        { text: "🎰 Кэшаут", callback_data: "cashout_start" }
      ]);
    }
    keyboard.push([{ text: "📊 Статус игры", callback_data: "status" }]);
  }
  
  if (isAdmin) {
    if (!hasActiveGame) {
      keyboard.push([{ text: "🎲 Начать игру", callback_data: "start_game" }]);
    } else {
      keyboard.push([
        { text: "➕ Добавить гостя", callback_data: "add_guest" },
        { text: "🏁 Завершить игру", callback_data: "end_game" }
      ]);
      keyboard.push([
        { text: "💰 Rebuy гостя", callback_data: "guest_rebuy_select" },
        { text: "🎰 Кэшаут гостя", callback_data: "guest_cashout_select" }
      ]);
    }
    keyboard.push([{ text: "✏️ Редактировать игрока", callback_data: "edit_player_select" }]);
    keyboard.push([
      { text: "🗑️ Обнулить всё", callback_data: "reset_stats_confirm" },
      { text: "🗑️ Удалить игру", callback_data: "delete_game_select" }
    ]);
  }
  
  keyboard.push([
    { text: "📈 Моя статистика", callback_data: "stats" },
    { text: "👥 Игроки", callback_data: "players" }
  ]);
  
  return { inline_keyboard: keyboard };
}

function getPaymentMethodKeyboard(actionType: string): TelegramResponse["reply_markup"] {
  return {
    inline_keyboard: [
      [
        { text: "💵 Cash", callback_data: `payment_${actionType}_cash` },
        { text: "💳 Zelle", callback_data: `payment_${actionType}_zelle` }
      ],
      [{ text: "❌ Отмена", callback_data: "cancel" }]
    ]
  };
}

export async function handleCommand(telegramId: string, message: string): Promise<TelegramResponse> {
  const text = message.trim();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const pendingAction = await getPendingAction(client, telegramId);
    
    if (pendingAction === "register_name") {
      const name = text.trim();
      if (!name || name.startsWith("/")) {
        await client.query('COMMIT');
        return {
          text: "❌ Введите ваше имя (без команд):",
          reply_markup: { inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]] }
        };
      }
      
      await clearPendingAction(client, telegramId);
      
      const playerCount = await getPlayerCount(client);
      const isFirstPlayer = playerCount === 0;
      
      await client.query(
        "INSERT INTO poker_players (telegram_id, name, is_admin) VALUES ($1, $2, $3)",
        [telegramId, name, isFirstPlayer]
      );
      
      const activeGame = await getActiveGame(client);
      await client.query('COMMIT');
      
      const adminNote = isFirstPlayer ? "\n👑 Ты первый игрок — теперь ты админ!" : "";
      
      return {
        text: `🎉 Добро пожаловать, ${name}!${adminNote}\n\nНажми кнопку ниже:`,
        reply_markup: getMainMenuKeyboard(isFirstPlayer, false, !!activeGame)
      };
    }
    
    if (pendingAction === "cashout_chips") {
      const totalChips = parseInt(text);
      if (isNaN(totalChips) || totalChips < 0) {
        await client.query('COMMIT');
        return {
          text: "❌ Введи число фишек (например: 250)",
          reply_markup: { inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]] }
        };
      }
      
      await clearPendingAction(client, telegramId);
      await client.query('COMMIT');
      const result = await processCashout(telegramId, totalChips);
      return result;
    }
    
    if (pendingAction === "add_guest_name") {
      const guestName = text.trim();
      if (!guestName || guestName.startsWith("/")) {
        await client.query('COMMIT');
        return {
          text: "❌ Введите имя гостя (без команд):",
          reply_markup: { inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]] }
        };
      }
      
      await clearPendingAction(client, telegramId);
      
      const guestTelegramId = `guest_${Date.now()}`;
      await client.query(
        "INSERT INTO poker_players (telegram_id, name, is_admin) VALUES ($1, $2, false)",
        [guestTelegramId, guestName]
      );
      
      const newGuest = await client.query(
        "SELECT id FROM poker_players WHERE telegram_id = $1",
        [guestTelegramId]
      );
      
      await client.query("DELETE FROM poker_pending_actions WHERE telegram_id = $1", [telegramId]);
      await client.query(
        "INSERT INTO poker_pending_actions (telegram_id, action_type, context) VALUES ($1, $2, $3)",
        [telegramId, "guest_buyin_payment", JSON.stringify({ guestId: newGuest.rows[0].id, guestName })]
      );
      
      await client.query('COMMIT');
      
      return {
        text: `👤 Гость *${guestName}* добавлен!\n\nВыберите способ оплаты для buy-in $${BUYIN_AMOUNT}:`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "💵 Cash", callback_data: "guest_pay_cash" },
              { text: "💳 Zelle", callback_data: "guest_pay_zelle" }
            ],
            [{ text: "❌ Отмена", callback_data: "cancel" }]
          ]
        }
      };
    }
    
    if (pendingAction?.startsWith("guest_cashout_chips:")) {
      const guestId = parseInt(pendingAction.split(":")[1]);
      const totalChips = parseInt(text);
      
      if (isNaN(totalChips) || totalChips < 0) {
        await client.query('COMMIT');
        return {
          text: "❌ Введите число фишек (например: 250)",
          reply_markup: { inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]] }
        };
      }
      
      await clearPendingAction(client, telegramId);
      await client.query('COMMIT');
      const result = await processGuestCashout(guestId, totalChips);
      return result;
    }
    
    if (pendingAction === "edit_player_name") {
      const contextResult = await client.query(
        "SELECT context FROM poker_pending_actions WHERE telegram_id = $1 AND action_type = 'edit_player_name'",
        [telegramId]
      );
      
      if (contextResult.rows.length === 0) {
        await client.query('COMMIT');
        return { text: "❌ Ошибка: действие не найдено." };
      }
      
      const context = JSON.parse(contextResult.rows[0].context);
      const newName = text.trim();
      
      if (!newName || newName.startsWith("/")) {
        await client.query('COMMIT');
        return {
          text: "❌ Введите имя (без команд):",
          reply_markup: { inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]] }
        };
      }
      
      await client.query("UPDATE poker_players SET name = $1 WHERE id = $2", [newName, context.playerId]);
      await clearPendingAction(client, telegramId);
      await client.query('COMMIT');
      
      return {
        text: `✅ Имя изменено!\n\n${context.oldName} → ${newName}`,
        reply_markup: { inline_keyboard: [[{ text: "◀️ Назад к игроку", callback_data: `edit_player_${context.playerId}` }]] }
      };
    }
    
    if (text === "/start" || text === "/help" || text === "/menu") {
      const player = await getPlayer(client, telegramId);
      const activeGame = await getActiveGame(client);
      
      if (!player) {
        await setPendingAction(client, telegramId, "register_name");
        await client.query('COMMIT');
        return {
          text: `🃏 *POKER БОТЯ*\n\nДобро пожаловать!\n\nВведите ваше имя:`,
          reply_markup: { inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]] }
        };
      }
      
      const isAdmin = player.is_admin;
      const isInGame = activeGame ? await isPlayerInGame(client, activeGame.id, player.id) : false;
      const hasCashedOut = activeGame ? await hasPlayerCashedOut(client, activeGame.id, player.id) : false;
      
      await client.query('COMMIT');
      
      let statusText = activeGame 
        ? `🟢 Игра #${activeGame.id} идёт`
        : "🔴 Нет активной игры";
      
      if (isInGame && !hasCashedOut) {
        statusText += "\n🎲 Ты в игре!";
      }
      
      return {
        text: `🃏 *POKER БОТЯ*\n\nПривет, ${player.name}! ${isAdmin ? "👑" : ""}\n\n${statusText}\n\nВыбери действие:`,
        reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
      };
    }
    
    
    const player = await getPlayer(client, telegramId);
    if (!player) {
      await setPendingAction(client, telegramId, "register_name");
      await client.query('COMMIT');
      return { 
        text: "🃏 *POKER БОТЯ*\n\nДобро пожаловать!\n\nВведите ваше имя:",
        reply_markup: { inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]] }
      };
    }
    
    await client.query('COMMIT');
    
    return {
      text: "❓ Не понял команду.\n\nИспользуй /menu для главного меню.",
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Command error:", error);
    return { text: "❌ Произошла ошибка. Попробуй ещё раз." };
  } finally {
    client.release();
  }
}

export async function handleCallbackQuery(telegramId: string, callbackData: string): Promise<TelegramResponse> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const player = await getPlayer(client, telegramId);
    if (!player) {
      if (callbackData === "cancel") {
        await clearPendingAction(client, telegramId);
        await client.query('COMMIT');
        return { text: "❌ Регистрация отменена.\n\nОтправь /start чтобы начать заново." };
      }
      await setPendingAction(client, telegramId, "register_name");
      await client.query('COMMIT');
      return { 
        text: "❌ Сначала зарегистрируйся!\n\nВведите ваше имя:",
        reply_markup: { inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]] }
      };
    }
    
    const activeGame = await getActiveGame(client);
    const isAdmin = player.is_admin;
    const isInGame = activeGame ? await isPlayerInGame(client, activeGame.id, player.id) : false;
    const hasCashedOut = activeGame ? await hasPlayerCashedOut(client, activeGame.id, player.id) : false;
    
    if (callbackData === "cancel") {
      await clearPendingAction(client, telegramId);
      await client.query('COMMIT');
      return {
        text: "❌ Действие отменено.\n\nВыбери новое действие:",
        reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
      };
    }
    
    if (callbackData === "start_game") {
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может начать игру!" };
      }
      
      if (activeGame) {
        await client.query('COMMIT');
        return { text: "⚠️ Игра уже идёт!" };
      }
      
      const result = await client.query(
        "INSERT INTO poker_games (status) VALUES ('active') RETURNING id"
      );
      
      await client.query('COMMIT');
      
      const gameId = result.rows[0].id;
      return {
        text: `🃏 *ИГРА #${gameId} НАЧАЛАСЬ!*\n\nИгроки, присоединяйтесь!\nBuy-in: $${BUYIN_AMOUNT} (${CHIPS_PER_BUYIN} фишек)`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "🎮 Вступить в игру ($20)", callback_data: "join_game" }],
            [{ text: "📊 Статус игры", callback_data: "status" }]
          ]
        }
      };
    }
    
    if (callbackData === "join_game") {
      if (!activeGame) {
        await client.query('COMMIT');
        return { text: "❌ Нет активной игры!" };
      }
      
      if (isInGame) {
        await client.query('COMMIT');
        return { text: "⚠️ Ты уже в игре!" };
      }
      
      await client.query('COMMIT');
      return {
        text: `🎮 *Вступление в игру*\n\nBuy-in: $${BUYIN_AMOUNT} (${CHIPS_PER_BUYIN} фишек)\n\nВыбери способ оплаты:`,
        reply_markup: getPaymentMethodKeyboard("buyin")
      };
    }
    
    if (callbackData === "rebuy") {
      if (!activeGame) {
        await client.query('COMMIT');
        return { text: "❌ Нет активной игры!" };
      }
      
      if (!isInGame) {
        await client.query('COMMIT');
        return { text: "❌ Ты не в игре!" };
      }
      
      if (hasCashedOut) {
        await client.query('COMMIT');
        return { text: "❌ Ты уже сделал кэшаут!" };
      }
      
      await client.query('COMMIT');
      return {
        text: `💰 *Rebuy +$${BUYIN_AMOUNT}*\n\nПолучишь ещё ${CHIPS_PER_BUYIN} фишек.\n\nВыбери способ оплаты:`,
        reply_markup: getPaymentMethodKeyboard("rebuy")
      };
    }
    
    if (callbackData.startsWith("payment_")) {
      const parts = callbackData.split("_");
      const actionType = parts[1];
      const paymentMethod = parts[2];
      
      if (!activeGame) {
        await client.query('COMMIT');
        return { text: "❌ Нет активной игры!" };
      }
      
      if (actionType === "rebuy" && hasCashedOut) {
        await client.query('COMMIT');
        return { text: "❌ Ты уже сделал кэшаут!" };
      }
      
      await client.query(
        `INSERT INTO poker_transactions (game_id, player_id, type, amount, payment_method)
         VALUES ($1, $2, $3, $4, $5)`,
        [activeGame.id, player.id, actionType, BUYIN_AMOUNT, paymentMethod]
      );
      
      await client.query('COMMIT');
      
      const actionName = actionType === "buyin" ? "Buy-in" : "Rebuy";
      const paymentName = paymentMethod === "cash" ? "💵 Cash" : "💳 Zelle";
      
      return {
        text: `✅ *${actionName} записан!*\n\n💰 Сумма: $${BUYIN_AMOUNT}\n🎰 Фишки: ${CHIPS_PER_BUYIN}\n${paymentName}\n\n${player.name}, удачи за столом! 🍀`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "💰 Rebuy +$20", callback_data: "rebuy" },
              { text: "🎰 Кэшаут", callback_data: "cashout_start" }
            ],
            [{ text: "📊 Статус игры", callback_data: "status" }]
          ]
        }
      };
    }
    
    if (callbackData === "cashout_start") {
      if (!activeGame) {
        await client.query('COMMIT');
        return { text: "❌ Нет активной игры!" };
      }
      
      if (!isInGame) {
        await client.query('COMMIT');
        return { text: "❌ Ты не в игре!" };
      }
      
      if (hasCashedOut) {
        await client.query('COMMIT');
        return { text: "❌ Ты уже сделал кэшаут!" };
      }
      
      await setPendingAction(client, telegramId, "cashout_chips");
      await client.query('COMMIT');
      
      return {
        text: `🎰 *Кэшаут*\n\nСколько фишек у тебя осталось?\n\n_Напиши общее количество фишек числом._\n_Например: 250_\n\n(${CHIPS_PER_BUYIN} фишек = $${BUYIN_AMOUNT})`,
        reply_markup: { inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]] }
      };
    }
    
    if (callbackData === "status") {
      if (!activeGame) {
        await client.query('COMMIT');
        return {
          text: "🔴 Сейчас нет активной игры.",
          reply_markup: getMainMenuKeyboard(isAdmin, false, false)
        };
      }
      
      const transactions = await client.query(`
        SELECT p.name,
          SUM(CASE WHEN t.type IN ('buyin', 'rebuy') THEN t.amount ELSE 0 END) as total_in,
          COALESCE(SUM(CASE WHEN t.type IN ('buyin', 'rebuy') AND t.payment_method = 'cash' THEN t.amount ELSE 0 END), 0) as player_cash,
          COALESCE(SUM(CASE WHEN t.type IN ('buyin', 'rebuy') AND t.payment_method = 'zelle' THEN t.amount ELSE 0 END), 0) as player_zelle,
          COUNT(CASE WHEN t.type = 'rebuy' THEN 1 END) as rebuy_count,
          MAX(CASE WHEN t.type = 'cashout' THEN 1 ELSE 0 END) as cashed_out
        FROM poker_transactions t
        JOIN poker_players p ON t.player_id = p.id
        WHERE t.game_id = $1
        GROUP BY p.id, p.name
      `, [activeGame.id]);
      
      const paymentTotals = await client.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END), 0) as total_cash,
          COALESCE(SUM(CASE WHEN payment_method = 'zelle' THEN amount ELSE 0 END), 0) as total_zelle
        FROM poker_transactions
        WHERE game_id = $1 AND type IN ('buyin', 'rebuy')
      `, [activeGame.id]);
      
      await client.query('COMMIT');
      
      let totalBank = 0;
      let message = `🟢 *ИГРА #${activeGame.id} — ИДЁТ*\n━━━━━━━━━━━━━━━━━━━━━\n`;
      
      for (const row of transactions.rows) {
        const totalIn = parseFloat(row.total_in) || 0;
        const playerCash = parseFloat(row.player_cash) || 0;
        const playerZelle = parseFloat(row.player_zelle) || 0;
        const rebuyCount = parseInt(row.rebuy_count) || 0;
        const status = row.cashed_out ? "✅" : "🎲";
        const rebuyText = rebuyCount > 0 ? ` (+${rebuyCount} rebuy)` : "";
        const paymentDetails = [];
        if (playerCash > 0) paymentDetails.push(`💵$${playerCash.toFixed(0)}`);
        if (playerZelle > 0) paymentDetails.push(`💳$${playerZelle.toFixed(0)}`);
        const paymentText = paymentDetails.length > 0 ? ` [${paymentDetails.join(" ")}]` : "";
        message += `${status} ${row.name}: $${totalIn.toFixed(0)}${rebuyText}${paymentText}\n`;
        totalBank += totalIn;
      }
      
      if (transactions.rows.length === 0) {
        message += "_Пока никто не зашёл в игру_\n";
      }
      
      const totalCash = parseFloat(paymentTotals.rows[0]?.total_cash) || 0;
      const totalZelle = parseFloat(paymentTotals.rows[0]?.total_zelle) || 0;
      
      message += `━━━━━━━━━━━━━━━━━━━━━\n`;
      message += `💰 В банке: *$${totalBank.toFixed(0)}*\n`;
      message += `💵 Cash: $${totalCash.toFixed(0)} | 💳 Zelle: $${totalZelle.toFixed(0)}`;
      
      return {
        text: message,
        reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, true)
      };
    }
    
    if (callbackData === "end_game") {
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может завершить игру!" };
      }
      
      if (!activeGame) {
        await client.query('COMMIT');
        return { text: "❌ Нет активной игры!" };
      }
      
      const transactions = await client.query(`
        SELECT p.name, p.telegram_id,
          SUM(CASE WHEN t.type IN ('buyin', 'rebuy') THEN t.amount ELSE 0 END) as total_in,
          SUM(CASE WHEN t.type = 'cashout' THEN t.amount ELSE 0 END) as total_out,
          SUM(CASE WHEN t.type = 'cashout' THEN t.net_result ELSE 0 END) as net_result
        FROM poker_transactions t
        JOIN poker_players p ON t.player_id = p.id
        WHERE t.game_id = $1
        GROUP BY p.id, p.name, p.telegram_id
      `, [activeGame.id]);
      
      let report = `🏁 *ИГРА #${activeGame.id} ЗАВЕРШЕНА!*\n\n📊 РЕЗУЛЬТАТЫ:\n━━━━━━━━━━━━━━━━━━━━━\n`;
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
      
      if (results.length === 0) {
        report += "_Никто не играл_\n\n";
      }
      
      report += `━━━━━━━━━━━━━━━━━━━━━\n💰 Общий банк: $${totalBank.toFixed(0)}`;
      
      await client.query(
        "UPDATE poker_games SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE id = $1",
        [activeGame.id]
      );
      
      await client.query('COMMIT');
      
      return {
        text: report,
        reply_markup: getMainMenuKeyboard(isAdmin, false, false)
      };
    }
    
    if (callbackData === "stats") {
      const gameResults = await client.query(`
        SELECT 
          t.game_id,
          SUM(CASE WHEN t.type = 'cashout' THEN t.net_result ELSE 0 END) as game_result
        FROM poker_transactions t
        WHERE t.player_id = $1 AND t.type = 'cashout'
        GROUP BY t.game_id
      `, [player.id]);
      
      const results = gameResults.rows.map(r => parseFloat(r.game_result) || 0);
      const totalGames = results.length;
      const totalResult = results.reduce((a, b) => a + b, 0);
      const avgResult = totalGames > 0 ? totalResult / totalGames : 0;
      const bestResult = results.length > 0 ? Math.max(...results) : 0;
      const worstResult = results.length > 0 ? Math.min(...results) : 0;
      
      await client.query('COMMIT');
      
      const sign = totalResult >= 0 ? "+" : "";
      const resultEmoji = totalResult >= 0 ? "📈" : "📉";
      
      let message = `📊 *СТАТИСТИКА: ${player.name}*\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━\n`;
      message += `🎲 Игр сыграно: ${totalGames}\n`;
      message += `${resultEmoji} Общий результат: *${sign}$${totalResult.toFixed(0)}*\n`;
      
      if (totalGames > 0) {
        message += `📉 Средний результат: ${avgResult >= 0 ? "+" : ""}$${avgResult.toFixed(0)}\n`;
        message += `🏆 Лучший результат: +$${bestResult.toFixed(0)}\n`;
        message += `😢 Худший результат: $${worstResult.toFixed(0)}\n`;
      }
      
      return {
        text: message,
        reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
      };
    }
    
    if (callbackData === "players") {
      const players = await client.query(
        "SELECT name, is_admin FROM poker_players ORDER BY created_at"
      );
      
      await client.query('COMMIT');
      
      if (players.rows.length === 0) {
        return {
          text: "📋 Пока нет зарегистрированных игроков.",
          reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
        };
      }
      
      let message = "📋 *ИГРОКИ:*\n━━━━━━━━━━━━━━━━━━━━━\n";
      for (const p of players.rows) {
        const admin = p.is_admin ? " 👑" : "";
        message += `• ${p.name}${admin}\n`;
      }
      
      return {
        text: message,
        reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
      };
    }
    
    if (callbackData === "add_guest") {
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может добавлять гостей!" };
      }
      
      if (!activeGame) {
        await client.query('COMMIT');
        return { text: "⚠️ Сначала начни игру!" };
      }
      
      await setPendingAction(client, telegramId, "add_guest_name");
      await client.query('COMMIT');
      
      return {
        text: "👤 *ДОБАВИТЬ ГОСТЯ*\n\nВведите имя гостя:",
        reply_markup: { inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]] }
      };
    }
    
    if (callbackData === "guest_pay_cash" || callbackData === "guest_pay_zelle") {
      const pendingResult = await client.query(
        "SELECT context FROM poker_pending_actions WHERE telegram_id = $1 AND action_type = 'guest_buyin_payment'",
        [telegramId]
      );
      
      if (pendingResult.rows.length === 0) {
        await client.query('COMMIT');
        return { text: "❌ Ошибка: действие не найдено." };
      }
      
      const context = JSON.parse(pendingResult.rows[0].context);
      const paymentMethod = callbackData === "guest_pay_cash" ? "cash" : "zelle";
      
      await clearPendingAction(client, telegramId);
      
      await client.query(
        `INSERT INTO poker_transactions (game_id, player_id, type, amount, payment_method)
         VALUES ($1, $2, 'buyin', $3, $4)`,
        [activeGame!.id, context.guestId, BUYIN_AMOUNT, paymentMethod]
      );
      
      await client.query('COMMIT');
      
      const paymentEmoji = paymentMethod === "cash" ? "💵" : "💳";
      
      return {
        text: `✅ *ГОСТЬ ДОБАВЛЕН!*\n\n👤 ${context.guestName}\n💰 Buy-in: $${BUYIN_AMOUNT}\n${paymentEmoji} Оплата: ${paymentMethod === "cash" ? "Cash" : "Zelle"}`,
        reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
      };
    }
    
    if (callbackData === "guest_cashout_select") {
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может кэшаутить гостей!" };
      }
      
      if (!activeGame) {
        await client.query('COMMIT');
        return { text: "⚠️ Нет активной игры!" };
      }
      
      const guests = await client.query(`
        SELECT DISTINCT p.id, p.name
        FROM poker_players p
        JOIN poker_transactions t ON t.player_id = p.id
        WHERE t.game_id = $1 
          AND p.telegram_id LIKE 'guest_%'
          AND NOT EXISTS (
            SELECT 1 FROM poker_transactions t2 
            WHERE t2.game_id = $1 AND t2.player_id = p.id AND t2.type = 'cashout'
          )
      `, [activeGame.id]);
      
      await client.query('COMMIT');
      
      if (guests.rows.length === 0) {
        return {
          text: "📋 Нет гостей для кэшаута.",
          reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
        };
      }
      
      const guestButtons = guests.rows.map(g => [{ text: `👤 ${g.name}`, callback_data: `guest_cashout_${g.id}` }]);
      guestButtons.push([{ text: "❌ Отмена", callback_data: "cancel" }]);
      
      return {
        text: "🎰 *КЭШАУТ ГОСТЯ*\n\nВыберите гостя:",
        reply_markup: { inline_keyboard: guestButtons }
      };
    }
    
    if (callbackData.startsWith("guest_cashout_")) {
      const guestId = parseInt(callbackData.replace("guest_cashout_", ""));
      
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может кэшаутить гостей!" };
      }
      
      const guestResult = await client.query("SELECT name FROM poker_players WHERE id = $1", [guestId]);
      if (guestResult.rows.length === 0) {
        await client.query('COMMIT');
        return { text: "❌ Гость не найден." };
      }
      
      await setPendingAction(client, telegramId, `guest_cashout_chips:${guestId}`);
      await client.query('COMMIT');
      
      return {
        text: `🎰 *КЭШАУТ: ${guestResult.rows[0].name}*\n\nСколько фишек у гостя? (200 = $20)`,
        reply_markup: { inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel" }]] }
      };
    }
    
    if (callbackData === "delete_game_select") {
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может удалять игры!" };
      }
      
      const games = await client.query(
        "SELECT id, status, created_at FROM poker_games ORDER BY id DESC LIMIT 10"
      );
      
      await client.query('COMMIT');
      
      if (games.rows.length === 0) {
        return {
          text: "📋 Нет игр для удаления.",
          reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
        };
      }
      
      const gameButtons = games.rows.map(g => {
        const status = g.status === 'active' ? '🟢' : '🔴';
        return [{ text: `${status} Игра #${g.id}`, callback_data: `delete_game_${g.id}` }];
      });
      gameButtons.push([{ text: "❌ Отмена", callback_data: "cancel" }]);
      
      return {
        text: "🗑️ *УДАЛИТЬ ИГРУ*\n\nВыберите игру для удаления:",
        reply_markup: { inline_keyboard: gameButtons }
      };
    }
    
    if (callbackData.startsWith("delete_game_")) {
      const gameId = parseInt(callbackData.replace("delete_game_", ""));
      
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может удалять игры!" };
      }
      
      const gameResult = await client.query("SELECT id, status FROM poker_games WHERE id = $1", [gameId]);
      if (gameResult.rows.length === 0) {
        await client.query('COMMIT');
        return { text: "❌ Игра не найдена." };
      }
      
      if (gameResult.rows[0].status === 'active') {
        await client.query('COMMIT');
        return { 
          text: "⚠️ Нельзя удалить активную игру!\n\nСначала заверши её.",
          reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
        };
      }
      
      await client.query("DELETE FROM poker_transactions WHERE game_id = $1", [gameId]);
      await client.query("DELETE FROM poker_games WHERE id = $1", [gameId]);
      
      await client.query('COMMIT');
      
      return {
        text: `✅ Игра #${gameId} удалена!`,
        reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
      };
    }
    
    if (callbackData === "guest_rebuy_select") {
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может делать rebuy для гостей!" };
      }
      
      if (!activeGame) {
        await client.query('COMMIT');
        return { text: "⚠️ Нет активной игры!" };
      }
      
      const guests = await client.query(`
        SELECT DISTINCT p.id, p.name
        FROM poker_players p
        JOIN poker_transactions t ON t.player_id = p.id
        WHERE t.game_id = $1 
          AND p.telegram_id LIKE 'guest_%'
          AND NOT EXISTS (
            SELECT 1 FROM poker_transactions t2 
            WHERE t2.game_id = $1 AND t2.player_id = p.id AND t2.type = 'cashout'
          )
      `, [activeGame.id]);
      
      await client.query('COMMIT');
      
      if (guests.rows.length === 0) {
        return {
          text: "📋 Нет гостей для rebuy.",
          reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
        };
      }
      
      const guestButtons = guests.rows.map(g => [{ text: `👤 ${g.name}`, callback_data: `guest_rebuy_${g.id}` }]);
      guestButtons.push([{ text: "❌ Отмена", callback_data: "cancel" }]);
      
      return {
        text: "💰 *REBUY ДЛЯ ГОСТЯ*\n\nВыберите гостя:",
        reply_markup: { inline_keyboard: guestButtons }
      };
    }
    
    if (callbackData.startsWith("guest_rebuy_")) {
      const guestId = parseInt(callbackData.replace("guest_rebuy_", ""));
      
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может делать rebuy для гостей!" };
      }
      
      const guestResult = await client.query("SELECT name FROM poker_players WHERE id = $1", [guestId]);
      if (guestResult.rows.length === 0) {
        await client.query('COMMIT');
        return { text: "❌ Гость не найден." };
      }
      
      await client.query("DELETE FROM poker_pending_actions WHERE telegram_id = $1", [telegramId]);
      await client.query(
        "INSERT INTO poker_pending_actions (telegram_id, action_type, context) VALUES ($1, $2, $3)",
        [telegramId, "guest_rebuy_payment", JSON.stringify({ guestId, guestName: guestResult.rows[0].name })]
      );
      await client.query('COMMIT');
      
      return {
        text: `💰 *REBUY: ${guestResult.rows[0].name}*\n\nВыберите способ оплаты:`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "💵 Cash", callback_data: "guest_rebuy_pay_cash" },
              { text: "💳 Zelle", callback_data: "guest_rebuy_pay_zelle" }
            ],
            [{ text: "❌ Отмена", callback_data: "cancel" }]
          ]
        }
      };
    }
    
    if (callbackData === "guest_rebuy_pay_cash" || callbackData === "guest_rebuy_pay_zelle") {
      const pendingResult = await client.query(
        "SELECT context FROM poker_pending_actions WHERE telegram_id = $1 AND action_type = 'guest_rebuy_payment'",
        [telegramId]
      );
      
      if (pendingResult.rows.length === 0) {
        await client.query('COMMIT');
        return { text: "❌ Ошибка: действие не найдено." };
      }
      
      const context = JSON.parse(pendingResult.rows[0].context);
      const paymentMethod = callbackData === "guest_rebuy_pay_cash" ? "cash" : "zelle";
      
      await clearPendingAction(client, telegramId);
      
      await client.query(
        `INSERT INTO poker_transactions (game_id, player_id, type, amount, payment_method)
         VALUES ($1, $2, 'rebuy', $3, $4)`,
        [activeGame!.id, context.guestId, BUYIN_AMOUNT, paymentMethod]
      );
      
      await client.query('COMMIT');
      
      const paymentEmoji = paymentMethod === "cash" ? "💵" : "💳";
      
      return {
        text: `✅ *REBUY ДЛЯ ГОСТЯ!*\n\n👤 ${context.guestName}\n💰 Сумма: +$${BUYIN_AMOUNT}\n${paymentEmoji} Оплата: ${paymentMethod === "cash" ? "Cash" : "Zelle"}`,
        reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
      };
    }
    
    // ===== EDIT PLAYER HANDLERS =====
    if (callbackData === "edit_player_select") {
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может редактировать игроков!" };
      }
      
      // If active game, show players in game; otherwise show all registered players
      let players;
      let headerText;
      if (activeGame) {
        players = await client.query(`
          SELECT DISTINCT p.id, p.name, p.telegram_id
          FROM poker_players p
          JOIN poker_transactions t ON t.player_id = p.id
          WHERE t.game_id = $1
          ORDER BY p.name
        `, [activeGame.id]);
        headerText = "✏️ *РЕДАКТИРОВАНИЕ ИГРОКА*\n\nВыберите игрока в текущей игре:";
      } else {
        players = await client.query(`
          SELECT id, name, telegram_id
          FROM poker_players
          ORDER BY name
        `);
        headerText = "✏️ *РЕДАКТИРОВАНИЕ ИГРОКА*\n\nВыберите игрока:";
      }
      
      await client.query('COMMIT');
      
      if (players.rows.length === 0) {
        return {
          text: activeGame ? "📋 В игре пока нет игроков." : "📋 Нет зарегистрированных игроков.",
          reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
        };
      }
      
      const playerButtons = players.rows.map(p => {
        const isGuestPlayer = p.telegram_id.startsWith("guest_");
        const icon = isGuestPlayer ? "👻" : "👤";
        return [{ text: `${icon} ${p.name}`, callback_data: `edit_player_${p.id}` }];
      });
      playerButtons.push([{ text: "❌ Отмена", callback_data: "cancel" }]);
      
      return {
        text: headerText,
        reply_markup: { inline_keyboard: playerButtons }
      };
    }
    
    if (callbackData.startsWith("edit_player_") && !callbackData.startsWith("edit_player_select") && !callbackData.startsWith("edit_player_name_")) {
      const playerId = parseInt(callbackData.replace("edit_player_", ""));
      
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может редактировать игроков!" };
      }
      
      const playerResult = await client.query("SELECT * FROM poker_players WHERE id = $1", [playerId]);
      if (playerResult.rows.length === 0) {
        await client.query('COMMIT');
        return { text: "❌ Игрок не найден." };
      }
      const editPlayer = playerResult.rows[0];
      
      let transactions = { rows: [] as any[] };
      if (activeGame) {
        transactions = await client.query(`
          SELECT id, type, amount, payment_method, chips_total, created_at
          FROM poker_transactions
          WHERE game_id = $1 AND player_id = $2
          ORDER BY created_at ASC
        `, [activeGame.id, playerId]);
      }
      
      await client.query('COMMIT');
      
      let message = `✏️ *${editPlayer.name}*\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━\n`;
      
      if (!activeGame) {
        message += "Нет активной игры.\n";
      } else if (transactions.rows.length === 0) {
        message += "Нет транзакций в текущей игре.\n";
      } else {
        transactions.rows.forEach((t, idx) => {
          const typeEmoji = t.type === 'buyin' ? '🎮' : t.type === 'rebuy' ? '💰' : '🎰';
          const paymentEmoji = t.payment_method === 'cash' ? '💵' : t.payment_method === 'zelle' ? '💳' : '';
          message += `${idx + 1}. ${typeEmoji} ${t.type.toUpperCase()} $${parseFloat(t.amount).toFixed(0)} ${paymentEmoji}\n`;
        });
      }
      
      const transButtons: Array<Array<{ text: string; callback_data: string }>> = transactions.rows.map((t, idx) => {
        const typeLabel = t.type === 'buyin' ? 'Buy-in' : t.type === 'rebuy' ? 'Rebuy' : 'Cashout';
        return [{ text: `✏️ ${idx + 1}. ${typeLabel} $${parseFloat(t.amount).toFixed(0)}`, callback_data: `edit_trans_${t.id}` }];
      });
      
      transButtons.push([{ text: "📝 Изменить имя", callback_data: `edit_player_name_${playerId}` }]);
      transButtons.push([{ text: "◀️ Назад", callback_data: "edit_player_select" }]);
      
      return {
        text: message,
        reply_markup: { inline_keyboard: transButtons }
      };
    }
    
    if (callbackData.startsWith("edit_player_name_")) {
      const playerId = parseInt(callbackData.replace("edit_player_name_", ""));
      
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может редактировать игроков!" };
      }
      
      const playerResult = await client.query("SELECT name FROM poker_players WHERE id = $1", [playerId]);
      if (playerResult.rows.length === 0) {
        await client.query('COMMIT');
        return { text: "❌ Игрок не найден." };
      }
      
      await client.query("DELETE FROM poker_pending_actions WHERE telegram_id = $1", [telegramId]);
      await client.query(
        "INSERT INTO poker_pending_actions (telegram_id, action_type, context) VALUES ($1, $2, $3)",
        [telegramId, "edit_player_name", JSON.stringify({ playerId, oldName: playerResult.rows[0].name })]
      );
      await client.query('COMMIT');
      
      return {
        text: `📝 *ИЗМЕНЕНИЕ ИМЕНИ*\n\nТекущее имя: ${playerResult.rows[0].name}\n\nВведите новое имя:`
      };
    }
    
    if (callbackData.startsWith("edit_trans_")) {
      const transId = parseInt(callbackData.replace("edit_trans_", ""));
      
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может редактировать транзакции!" };
      }
      
      const transResult = await client.query(`
        SELECT t.*, p.name as player_name
        FROM poker_transactions t
        JOIN poker_players p ON p.id = t.player_id
        WHERE t.id = $1
      `, [transId]);
      
      if (transResult.rows.length === 0) {
        await client.query('COMMIT');
        return { text: "❌ Транзакция не найдена." };
      }
      
      const trans = transResult.rows[0];
      await client.query('COMMIT');
      
      const typeEmoji = trans.type === 'buyin' ? '🎮' : trans.type === 'rebuy' ? '💰' : '🎰';
      const paymentEmoji = trans.payment_method === 'cash' ? '💵' : trans.payment_method === 'zelle' ? '💳' : '';
      
      let message = `✏️ *РЕДАКТИРОВАНИЕ ТРАНЗАКЦИИ*\n\n`;
      message += `👤 Игрок: ${trans.player_name}\n`;
      message += `${typeEmoji} Тип: ${trans.type.toUpperCase()}\n`;
      message += `💰 Сумма: $${parseFloat(trans.amount).toFixed(0)}\n`;
      if (trans.payment_method) {
        message += `${paymentEmoji} Оплата: ${trans.payment_method === 'cash' ? 'Cash' : 'Zelle'}\n`;
      }
      if (trans.type === 'cashout' && trans.chips_total) {
        message += `🎲 Фишек: ${trans.chips_total}\n`;
      }
      
      const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
      
      // Only show payment switch for buy-in/rebuy with payment method
      if ((trans.type === 'buyin' || trans.type === 'rebuy') && trans.payment_method) {
        const newMethod = trans.payment_method === 'cash' ? 'zelle' : 'cash';
        const newMethodLabel = newMethod === 'cash' ? '💵 Cash' : '💳 Zelle';
        buttons.push([{ text: `🔄 Сменить на ${newMethodLabel}`, callback_data: `change_payment_${transId}_${newMethod}` }]);
      }
      
      // Delete transaction (not for cashouts in active game - would mess up results)
      if (trans.type !== 'cashout') {
        buttons.push([{ text: "🗑️ Удалить транзакцию", callback_data: `delete_trans_confirm_${transId}` }]);
      } else {
        buttons.push([{ text: "🗑️ Отменить кэшаут", callback_data: `delete_trans_confirm_${transId}` }]);
      }
      
      buttons.push([{ text: "◀️ Назад", callback_data: `edit_player_${trans.player_id}` }]);
      
      return {
        text: message,
        reply_markup: { inline_keyboard: buttons }
      };
    }
    
    if (callbackData.startsWith("change_payment_")) {
      const parts = callbackData.replace("change_payment_", "").split("_");
      const transId = parseInt(parts[0]);
      const newMethod = parts[1];
      
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может изменять транзакции!" };
      }
      
      const transResult = await client.query(`
        SELECT t.player_id, p.name as player_name
        FROM poker_transactions t
        JOIN poker_players p ON p.id = t.player_id
        WHERE t.id = $1
      `, [transId]);
      
      if (transResult.rows.length === 0) {
        await client.query('COMMIT');
        return { text: "❌ Транзакция не найдена." };
      }
      
      await client.query("UPDATE poker_transactions SET payment_method = $1 WHERE id = $2", [newMethod, transId]);
      await client.query('COMMIT');
      
      const paymentEmoji = newMethod === 'cash' ? '💵' : '💳';
      const paymentLabel = newMethod === 'cash' ? 'Cash' : 'Zelle';
      
      return {
        text: `✅ Способ оплаты изменён на ${paymentEmoji} ${paymentLabel}`,
        reply_markup: { inline_keyboard: [[{ text: "◀️ Назад к игроку", callback_data: `edit_player_${transResult.rows[0].player_id}` }]] }
      };
    }
    
    if (callbackData.startsWith("delete_trans_confirm_")) {
      const transId = parseInt(callbackData.replace("delete_trans_confirm_", ""));
      
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может удалять транзакции!" };
      }
      
      const transResult = await client.query(`
        SELECT t.*, p.name as player_name
        FROM poker_transactions t
        JOIN poker_players p ON p.id = t.player_id
        WHERE t.id = $1
      `, [transId]);
      
      if (transResult.rows.length === 0) {
        await client.query('COMMIT');
        return { text: "❌ Транзакция не найдена." };
      }
      
      const trans = transResult.rows[0];
      await client.query('COMMIT');
      
      const typeLabel = trans.type === 'buyin' ? 'Buy-in' : trans.type === 'rebuy' ? 'Rebuy' : 'Cashout';
      
      return {
        text: `⚠️ *УДАЛЕНИЕ ТРАНЗАКЦИИ*\n\n👤 ${trans.player_name}\n🎯 ${typeLabel} $${parseFloat(trans.amount).toFixed(0)}\n\nУдалить эту транзакцию?`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Да, удалить", callback_data: `delete_trans_yes_${transId}` },
              { text: "❌ Отмена", callback_data: `edit_player_${trans.player_id}` }
            ]
          ]
        }
      };
    }
    
    if (callbackData.startsWith("delete_trans_yes_")) {
      const transId = parseInt(callbackData.replace("delete_trans_yes_", ""));
      
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может удалять транзакции!" };
      }
      
      const transResult = await client.query("SELECT player_id FROM poker_transactions WHERE id = $1", [transId]);
      if (transResult.rows.length === 0) {
        await client.query('COMMIT');
        return { text: "❌ Транзакция не найдена." };
      }
      
      const playerId = transResult.rows[0].player_id;
      await client.query("DELETE FROM poker_transactions WHERE id = $1", [transId]);
      await client.query('COMMIT');
      
      return {
        text: "✅ Транзакция удалена!",
        reply_markup: { inline_keyboard: [[{ text: "◀️ Назад к игроку", callback_data: `edit_player_${playerId}` }]] }
      };
    }
    // ===== END EDIT PLAYER HANDLERS =====
    
    if (callbackData === "reset_stats_confirm") {
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может обнулить статистику!" };
      }
      
      if (activeGame) {
        await client.query('COMMIT');
        return { 
          text: "⚠️ Нельзя обнулить статистику во время активной игры!\n\nСначала заверши игру.",
          reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
        };
      }
      
      await client.query('COMMIT');
      return {
        text: "⚠️ *ВНИМАНИЕ!*\n\n🗑️ Это удалит ВСЮ историю игр и статистику ВСЕХ игроков!\n\nТы уверен?",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Да, обнулить всё", callback_data: "reset_stats_yes" },
              { text: "❌ Отмена", callback_data: "cancel" }
            ]
          ]
        }
      };
    }
    
    if (callbackData === "reset_stats_yes") {
      if (!isAdmin) {
        await client.query('COMMIT');
        return { text: "⛔ Только админ может обнулить статистику!" };
      }
      
      if (activeGame) {
        await client.query('COMMIT');
        return { 
          text: "⚠️ Нельзя обнулить статистику во время активной игры!",
          reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
        };
      }
      
      await client.query("DELETE FROM poker_transactions");
      await client.query("DELETE FROM poker_games");
      await client.query("DELETE FROM poker_pending_actions");
      await client.query("ALTER SEQUENCE poker_games_id_seq RESTART WITH 1");
      
      await client.query('COMMIT');
      
      return {
        text: "🗑️ *СТАТИСТИКА ОБНУЛЕНА!*\n\nВся история игр и транзакций удалена.\nСчётчик игр сброшен.\nИгроки сохранены.",
        reply_markup: getMainMenuKeyboard(isAdmin, false, false)
      };
    }
    
    await client.query('COMMIT');
    return {
      text: "❓ Неизвестное действие.",
      reply_markup: getMainMenuKeyboard(isAdmin, isInGame && !hasCashedOut, !!activeGame)
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Callback error:", error);
    return { text: "❌ Произошла ошибка. Попробуй ещё раз." };
  } finally {
    client.release();
  }
}

async function processGuestCashout(guestPlayerId: number, totalChips: number): Promise<TelegramResponse> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const guestResult = await client.query("SELECT * FROM poker_players WHERE id = $1", [guestPlayerId]);
    const guest = guestResult.rows[0];
    const activeGame = await getActiveGame(client);
    
    if (!guest || !activeGame) {
      await client.query('COMMIT');
      return { text: "❌ Ошибка: гость или игра не найдены." };
    }
    
    const totalAmount = (totalChips / CHIPS_PER_BUYIN) * BUYIN_AMOUNT;
    
    const buyins = await client.query(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM poker_transactions
      WHERE game_id = $1 AND player_id = $2 AND type IN ('buyin', 'rebuy')
    `, [activeGame.id, guest.id]);
    
    const totalIn = parseFloat(buyins.rows[0].total) || 0;
    const netResult = totalAmount - totalIn;
    
    await client.query(
      `INSERT INTO poker_transactions (game_id, player_id, type, amount, net_result, chips_total)
       VALUES ($1, $2, 'cashout', $3, $4, $5)`,
      [activeGame.id, guest.id, totalAmount, netResult, totalChips]
    );
    
    await client.query('COMMIT');
    
    const phrase = getRandomPhrase(netResult);
    const sign = netResult >= 0 ? "+" : "";
    const resultEmoji = netResult >= 0 ? "📈" : "📉";
    
    let message = `🎰 *КЭШАУТ ГОСТЯ: ${guest.name}*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `🎲 Фишек: ${totalChips}\n`;
    message += `💰 Сумма: *$${totalAmount.toFixed(0)}*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `📥 Вложено: $${totalIn.toFixed(0)}\n`;
    message += `${resultEmoji} Результат: *${sign}$${netResult.toFixed(0)}*\n\n`;
    message += `_${phrase}_`;
    
    return {
      text: message,
      reply_markup: {
        inline_keyboard: [
          [{ text: "📊 Статус игры", callback_data: "status" }],
          [{ text: "🏁 Завершить игру", callback_data: "end_game" }]
        ]
      }
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Guest cashout error:", error);
    return { text: "❌ Ошибка при кэшауте гостя. Попробуй ещё раз." };
  } finally {
    client.release();
  }
}

async function processCashout(telegramId: string, totalChips: number): Promise<TelegramResponse> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const player = await getPlayer(client, telegramId);
    const activeGame = await getActiveGame(client);
    
    if (!player || !activeGame) {
      await client.query('COMMIT');
      return { text: "❌ Ошибка: игрок или игра не найдены." };
    }
    
    const totalAmount = (totalChips / CHIPS_PER_BUYIN) * BUYIN_AMOUNT;
    
    const buyins = await client.query(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM poker_transactions
      WHERE game_id = $1 AND player_id = $2 AND type IN ('buyin', 'rebuy')
    `, [activeGame.id, player.id]);
    
    const totalIn = parseFloat(buyins.rows[0].total) || 0;
    const netResult = totalAmount - totalIn;
    
    await client.query(
      `INSERT INTO poker_transactions (game_id, player_id, type, amount, net_result, chips_total)
       VALUES ($1, $2, 'cashout', $3, $4, $5)`,
      [activeGame.id, player.id, totalAmount, netResult, totalChips]
    );
    
    await client.query('COMMIT');
    
    const phrase = getRandomPhrase(netResult);
    const sign = netResult >= 0 ? "+" : "";
    const resultEmoji = netResult >= 0 ? "📈" : "📉";
    
    let message = `🎰 *КЭШАУТ: ${player.name}*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `🎲 Фишек: ${totalChips}\n`;
    message += `💰 Сумма: *$${totalAmount.toFixed(0)}*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `📥 Вложено: $${totalIn.toFixed(0)}\n`;
    message += `${resultEmoji} Результат: *${sign}$${netResult.toFixed(0)}*\n\n`;
    message += `_${phrase}_`;
    
    const isAdmin = player.is_admin;
    
    return {
      text: message,
      reply_markup: {
        inline_keyboard: [
          [{ text: "📊 Статус игры", callback_data: "status" }],
          [{ text: "📈 Моя статистика", callback_data: "stats" }],
          ...(isAdmin ? [[{ text: "🏁 Завершить игру", callback_data: "end_game" }]] : [])
        ]
      }
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Cashout error:", error);
    return { text: "❌ Ошибка при кэшауте. Попробуй ещё раз." };
  } finally {
    client.release();
  }
}
