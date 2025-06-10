const { Telegraf, session } = require('telegraf');
require('dotenv').config();
const bot = new Telegraf(process.env.BOT_TOKEN);
const { chromium } = require('playwright');
const fs = require('fs');
const axios = require('axios');

let browser = null;
bot.use(session());
bot.use((ctx, next) => {
  ctx.session ||= {};
  return next();
});

// Конфигурация
const WHATSAPP_WEB_URL = 'https://web.whatsapp.com';
const FILTERS_DB = 'filters.json';

// Загрузка и сохранение фильтров
function loadFilters() {
  try {
    return JSON.parse(fs.readFileSync(FILTERS_DB));
  } catch (e) {
    return {};
  }
}

function saveFilters(filters) {
  fs.writeFileSync(FILTERS_DB, JSON.stringify(filters));
}

// Команды бота
bot.start((ctx) => {
  ctx.reply(
    '🚖 Uber Parser Bot\n\n' +
    'Настройте фильтры:\n' +
    '/set_min_price - Минимальная цена\n' +
    '/set_max_distance - Макс. расстояние (км)\n' +
    '/test - Тест парсера'
  );
});

bot.command('set_min_price', (ctx) => {
  ctx.session.waitingFor = 'min_price';
  ctx.reply('Введите минимальную цену в € (например: 40):');
});

bot.command('set_max_distance', (ctx) => {
  ctx.session.waitingFor = 'max_distance';
  ctx.reply('Введите максимальное расстояние в км (например: 10):');
});

// Обработка текстовых сообщений
bot.on('text', (ctx) => {
  if (!ctx.session.waitingFor) return;

  const userId = ctx.from.id;
  const text = ctx.message.text;
  const filters = loadFilters();

  if (ctx.session.waitingFor === 'min_price') {
    const price = parseFloat(text);
    if (!isNaN(price)) {
      filters[userId] = filters[userId] || {};
      filters[userId].minPrice = price;
      saveFilters(filters);
      ctx.reply(`✅ Мин. цена установлена: ${price} €`);
    } else {
      ctx.reply('❌ Введите число (например: 45.50)');
    }
  } else if (ctx.session.waitingFor === 'max_distance') {
    const distance = parseFloat(text);
    if (!isNaN(distance)) {
      filters[userId] = filters[userId] || {};
      filters[userId].maxDistance = distance;
      saveFilters(filters);
      ctx.reply(`✅ Макс. расстояние установлено: ${distance} км`);
    } else {
      ctx.reply('❌ Введите число (например: 5.5)');
    }
  }
  delete ctx.session.waitingFor;
});

// Геокодирование и расчет расстояния
async function geocodeAddress(address) {
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: address,
        format: 'json',
        limit: 1,
        countrycodes: 'de' // Оптимизация для Германии
      }
    });
    return response.data[0] ? {
      lat: parseFloat(response.data[0].lat),
      lon: parseFloat(response.data[0].lon)
    } : null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = degToRad(lat2 - lat1);
  const dLon = degToRad(lon2 - lon1);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function degToRad(deg) {
  return deg * (Math.PI/180);
}

async function calculateRouteDistance(from, to) {
  const fromCoords = await geocodeAddress(from);
  const toCoords = await geocodeAddress(to);
  
  if (!fromCoords || !toCoords) {
    throw new Error('Could not geocode addresses');
  }
  
  return haversineDistance(
    fromCoords.lat, fromCoords.lon,
    toCoords.lat, toCoords.lon
  );
}

// Парсинг и обработка заказов
async function parseOrderMessage(message) {
  const match = message.match(
    /^(?<price>\d+\.\d{2})\s*€\s*(?:\|.*?)?\n(?<from>[^\n]+)\n->\n(?<to>[^\n]+)/
  );
  
  if (!match) {
    console.log('Failed to parse message:', message);
    return null;
  }
  
  return {
    price: parseFloat(match.groups.price),
    from: match.groups.from.trim(),
    to: match.groups.to.trim()
  };
}

async function processOrder(message) {
  const order = await parseOrderMessage(message);
  if (!order) return;
  
  const { price, from, to } = order;
  const filters = loadFilters();
  
  for (const [userId, userFilters] of Object.entries(filters)) {
    try {
      // Проверка цены
      if (price < (userFilters.minPrice || 0)) continue;
      
      let distanceInfo = '';
      
      // Проверка расстояния если нужно
      if (userFilters.maxDistance && userFilters.maxDistance !== Infinity) {
        const distance = await calculateRouteDistance(from, to);
        if (distance > userFilters.maxDistance) continue;
        distanceInfo = `\nРасстояние: ${distance.toFixed(1)} км`;
      }
      
      // Отправка уведомления
      await bot.telegram.sendMessage(
        userId,
        `💰 *Новый заказ!*\n` +
        `Цена: ${price} €\n` +
        `Откуда: ${from}\n` +
        `Куда: ${to}` +
        distanceInfo,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error(`Error processing order for user ${userId}:`, err);
    }
  }
}

// Мониторинг WhatsApp
async function whatsappMonitor() {
  try {
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.goto(WHATSAPP_WEB_URL);
    console.log('Please log in to WhatsApp Web...');
    
    await page.waitForSelector('._3GlyB', { timeout: 0 });
    console.log('WhatsApp Web loaded successfully');
    
    let lastMessage = '';
    
    while (true) {
      try {
        const messages = await page.$$('.message-in');
        if (messages.length > 0) {
          const newMessage = await messages[messages.length-1].innerText();
          if (newMessage !== lastMessage) {
            lastMessage = newMessage;
            console.log('New message:', newMessage);
            await processOrder(newMessage);
          }
        }
        await page.waitForTimeout(1000);
      } catch (err) {
        console.error('Monitoring error:', err);
      }
    }
  } catch (err) {
    console.error('WhatsApp monitor failed:', err);
  }
}

// Тестовая команда
bot.command('test', async (ctx) => {
  try {
    const testMessage = 
      "46.26 € | Test User\n" +
      "Felberstraße 21, 86154 Augsburg\n" +
      "->\n" +
      "Felberstraße 16, 86405 Meitingen";
    
    const parsed = await parseOrderMessage(testMessage);
    if (parsed) {
      await ctx.reply(
        `✅ *Тест успешен!*\n` +
        `Цена: ${parsed.price} €\n` +
        `Откуда: ${parsed.from}\n` +
        `Куда: ${parsed.to}`
      );
    } else {
      await ctx.reply('❌ Не удалось разобрать тестовое сообщение');
    }
  } catch (err) {
    console.error('Test error:', err);
    await ctx.reply(`❌ Ошибка теста: ${err.message}`);
  }
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
  ctx.reply('Произошла ошибка, попробуйте ещё раз');
});

// Запуск и завершение
bot.launch().then(() => {
  console.log('Bot started');
  whatsappMonitor();
});

process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit();
});