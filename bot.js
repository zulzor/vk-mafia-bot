require('dotenv').config();
const { VK } = require('vk-io');
const vk = new VK({
  token: process.env.VK_TOKEN // ← Замени на настоящий токен
});

const { updates } = vk;

// Хранилище для игр в мафию
const games = new Map(); // chat_id → gameState

// Команда: начать игру
updates.on('message', async (context) => {
  if (!context.isChat) return;

  const chatId = context.chatId;
  const text = context.text?.toLowerCase();
  const userId = context.senderId;

  if (text === '/мафия старт') {
    if (games.has(chatId)) {
      return context.send('Игра уже идёт в этом чате!');
    }

    const game = {
      phase: 'waiting', // waiting, night, day
      players: [],
      roles: [],
      host: userId,
      timer: null
    };

    games.set(chatId, game);

    await context.send(`🎮 Игра в мафию начинается!\nОрганизатор: @id${userId}\nЧтобы присоединиться — напиши /мафия вступить\n(Игра начнётся автоматически, когда наберётся 4 игрока)`);
  }

  if (text === '/мафия вступить') {
    const game = games.get(chatId);
    if (!game || game.phase !== 'waiting') {
      return context.send('Нет активной игры. Напиши /мафия старт, чтобы начать.');
    }

    if (game.players.includes(userId)) {
      return context.send('Ты уже в игре!');
    }

    game.players.push(userId);

    await context.send(`@id${userId} присоединился к игре! (${game.players.length}/4)`);

    // Автостарт при 4 игроках
    if (game.players.length >= 4) {
      startMafiaGame(chatId);
    }
  }

  if (text === '/мафия стоп') {
    if (games.has(chatId)) {
      games.delete(chatId);
      clearTimeout(games.get(chatId)?.timer);
      await context.send('Игра в мафию остановлена.');
    }
  }
});

async function startMafiaGame(chatId) {
  const game = games.get(chatId);
  if (!game) return;

  game.phase = 'day';
  const playerCount = game.players.length;

  // Распределим роли: 1 мафия на 4-5, 2 на 6+
  const mafiaCount = playerCount >= 6 ? 2 : 1;
  const roles = ['Мирный житель'.repeat(playerCount - mafiaCount)] + ['Мафия'.repeat(mafiaCount)];
  game.roles = shuffle(roles);

  await vk.api.messages.send({
    chat_id: chatId,
    message: `Игра началась! 🎭\nФаза: День 1\nВсего игроков: ${playerCount}\nМафия: ${mafiaCount} человек.\n\nДнём все обсуждают, кого выгнать. Голосование — /мафия голос [номер]\nНочью мафия убивает.`
  });

  // Начнём цикл дня/ночи
  scheduleNextPhase(chatId, 'night', 2); // через 2 минуты
}

function scheduleNextPhase(chatId, nextPhase, minutes) {
  const game = games.get(chatId);
  if (!game) return;

  game.timer = setTimeout(async () => {
    if (nextPhase === 'night') {
      await vk.api.messages.send({
        chat_id: chatId,
        message: '🌃 Наступила ночь. Все засыпают. Мафия, выберите, кого убить (личное сообщение боту: /мафия убить [номер])'
      });
      game.phase = 'night';
      scheduleNextPhase(chatId, 'day', 2);
    } else {
      await vk.api.messages.send({
        chat_id: chatId,
        message: '☀️ Наступил день. Все просыпаются. Обсуждение начинается. Голосование через 2 минуты.'
      });
      game.phase = 'day';
      scheduleNextPhase(chatId, 'night', 2);
    }
  }, minutes * 60 * 1000);
}

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

// Запуск бота
updates.start().then(() => {
  console.log('Бот запущен и слушает сообщения...');
});