require('dotenv').config();
const { VK } = require('vk-io');

const vk = new VK({
  token: process.env.VK_TOKEN
});

const { updates } = vk;

// Хранилище игр
const games = new Map(); // chatId → game

// Обработка входящих сообщений
updates.on('message', async (context) => {
  if (context.isOutbox) return;

  const chatId = context.chatId;
  const text = context.text?.toLowerCase();
  const userId = context.senderId;

  // === КОМАНДА: /мафия — показать клавиатуру ===
  if (text === '/мафия') {
    await context.send({
      message: '🎮 Игра в мафию\nВыберите действие:',
      keyboard: {
        inline: false, // обычная клавиатура (под строкой ввода)
        buttons: [
          [
            { label: '🚀 Начать игру', payload: JSON.stringify({ cmd: 'start_game' }) }
          ],
          [
            { label: '🛑 Остановить игру', payload: JSON.stringify({ cmd: 'stop_game' }) }
          ]
        ]
      }
    });
  }

  // === ОБРАБОТКА НАЖАТИЯ КНОПОК ===
  if (context.isPayloadJSON()) {
    const { cmd } = context.payload;

    if (cmd === 'start_game') {
      if (!context.isChat) {
        return context.send('Эта кнопка работает только в чате.');
      }

      if (games.has(chatId)) {
        return context.send('Игра уже идёт!');
      }

      const game = {
        phase: 'waiting',
        players: [],
        roles: [],
        host: userId,
        timer: null
      };

      games.set(chatId, game);

      await context.send(`🎮 Игра в мафию начинается!\nОрганизатор: @id${userId}\nЧтобы присоединиться — нажмите кнопку ниже или напишите /мафия вступить`, {
        keyboard: {
          inline: false,
          buttons: [
            [
              { label: '✅ Вступить', payload: JSON.stringify({ cmd: 'join_game' }) }
            ],
            [
              { label: '🛑 Остановить игру', payload: JSON.stringify({ cmd: 'stop_game' }) }
            ]
          ]
        }
      });

      // Автостарт через 60 секунд, если наберётся 4 игрока
      const autoStartTimer = setTimeout(() => {
        const game = games.get(chatId);
        if (game && game.phase === 'waiting' && game.players.length >= 4) {
          startMafiaGame(chatId);
        } else if (game) {
          games.delete(chatId);
          vk.api.messages.send({
            chat_id: chatId,
            message: '❌ Набралось недостаточно игроков. Игра отменена.'
          });
        }
      }, 60_000);

      game.timer = autoStartTimer;
    }

    if (cmd === 'join_game') {
      if (!context.isChat) return;

      const game = games.get(chatId);
      if (!game || game.phase !== 'waiting') {
        return context.send('Нет активной игры. Напишите /мафия, чтобы начать.');
      }

      if (game.players.includes(userId)) {
        return context.send('Вы уже в игре!');
      }

      game.players.push(userId);

      await context.send(`@id${userId} присоединился к игре! (${game.players.length}/4)`);

      if (game.players.length >= 4) {
        clearTimeout(game.timer);
        startMafiaGame(chatId);
      }
    }

    if (cmd === 'stop_game') {
      if (!context.isChat) return;

      if (games.has(chatId)) {
        const game = games.get(chatId);
        clearTimeout(game.timer);
        games.delete(chatId);
        await context.send('🛑 Игра в мафию остановлена.');
      } else {
        await context.send('Нет активной игры.');
      }
    }
  }

  // === АЛЬТЕРНАТИВА: /мафия вступить (если кнопка не нажалась) ===
  if (text === '/мафия вступить') {
    if (!context.isChat) return;

    const game = games.get(chatId);
    if (!game || game.phase !== 'waiting') {
      return context.send('Нет активной игры. Напишите /мафия, чтобы начать.');
    }

    if (game.players.includes(userId)) {
      return context.send('Вы уже в игре!');
    }

    game.players.push(userId);
    await context.send(`@id${userId} присоединился к игре! (${game.players.length}/4)`);

    if (game.players.length >= 4) {
      clearTimeout(game.timer);
      startMafiaGame(chatId);
    }
  }
});

// === ФУНКЦИЯ: ЗАПУСК ИГРЫ ===
async function startMafiaGame(chatId) {
  const game = games.get(chatId);
  if (!game) return;

  game.phase = 'day';

  const playerCount = game.players.length;
  const mafiaCount = playerCount >= 6 ? 2 : 1;
  const roles = Array(playerCount - mafiaCount).fill('Мирный житель').concat(Array(mafiaCount).fill('Мафия'));
  game.roles = shuffle(roles);

  await vk.api.messages.send({
    chat_id: chatId,
    message: `🎉 Игра началась!\nФаза: День 1\nМафия: ${mafiaCount} человек.\nОбсуждайте и голосуйте!`,
    keyboard: {
      inline: false,
      buttons: [
        [
          { label: '🗳 Голосовать', payload: JSON.stringify({ cmd: 'vote' }) }
        ],
        [
          { label: '🛑 Остановить игру', payload: JSON.stringify({ cmd: 'stop_game' }) }
        ]
      ]
    }
  });

  // Начинаем цикл день/ночь
  scheduleNextPhase(chatId, 'night', 2);
}

// === ФУНКЦИЯ: Следующая фаза ===
function scheduleNextPhase(chatId, nextPhase, minutes) {
  const game = games.get(chatId);
  if (!game) return;

  game.timer = setTimeout(async () => {
    if (nextPhase === 'night') {
      await vk.api.messages.send({
        chat_id: chatId,
        message: '🌃 Наступила ночь. Все засыпают. Мафия, выберите, кого убить (в ЛС боту: /убить [номер])'
      });
      game.phase = 'night';
      scheduleNextPhase(chatId, 'day', 2);
    } else {
      await vk.api.messages.send({
        chat_id: chatId,
        message: '☀️ Наступил день. Все просыпаются. Обсуждение. Голосование через 2 минуты.',
        keyboard: {
          inline: false,
          buttons: [
            [
              { label: '🗳 Голосовать', payload: JSON.stringify({ cmd: 'vote' }) }
            ],
            [
              { label: '🛑 Остановить игру', payload: JSON.stringify({ cmd: 'stop_game' }) }
            ]
          ]
        }
      });
      game.phase = 'day';
      scheduleNextPhase(chatId, 'night', 2);
    }
  }, minutes * 60 * 1000);
}

// === ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: Перемешать массив ===
function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

// === ЗАПУСК БОТА ===
updates.start().then(() => {
  console.log('✅ Бот запущен и слушает сообщения...');
});