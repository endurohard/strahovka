// Тест скриншота WhatsApp
const WhatsAppPuppeteer = require('./whatsappPuppeteer');

async function test() {
  console.log('Создаем инстанс WhatsApp...');
  const wa = new WhatsAppPuppeteer();

  try {
    console.log('Browser:', wa.browser);
    console.log('Page:', wa.page);
    console.log('Ready:', wa.isReady);

    if (wa.page) {
      console.log('Пытаемся сделать скриншот...');
      const screenshot = await wa.getScreenshot();
      console.log('Скриншот получен! Размер:', screenshot.length, 'байт');
    } else {
      console.log('Page не инициализирована');
    }
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

test();
