const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

class WhatsAppService {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.sessionPath = path.join(__dirname, '.wwebjs_auth');
  }

  /**
   * Инициализация WhatsApp клиента
   */
  async initialize() {
    console.log('🔄 Инициализация WhatsApp клиента...');

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: this.sessionPath
      }),
      puppeteer: {
        headless: true,  // В Docker работаем в headless режиме
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--remote-debugging-port=9222',  // Порт для удаленной отладки
          '--disable-blink-features=AutomationControlled',
          '--proxy-server=http://172.19.0.1:10819'  // Прокси для обхода блокировок (через socat на хосте)
        ]
      }
    });

    // Обработчик QR кода для первой авторизации
    this.client.on('qr', (qr) => {
      console.log('📱 Отсканируйте QR код в WhatsApp:');
      qrcode.generate(qr, { small: true });
      console.log('\nОткройте WhatsApp на телефоне:');
      console.log('1. Нажмите на три точки (меню)');
      console.log('2. Выберите "Связанные устройства"');
      console.log('3. Нажмите "Привязать устройство"');
      console.log('4. Отсканируйте QR код выше\n');
    });

    // Обработчик успешной авторизации
    this.client.on('authenticated', () => {
      console.log('✅ Авторизация успешна!');
    });

    // Обработчик готовности клиента
    this.client.on('ready', () => {
      console.log('✅ WhatsApp клиент готов к работе!');
      this.isReady = true;
    });

    // Обработчик отключения
    this.client.on('disconnected', (reason) => {
      console.log('❌ WhatsApp клиент отключен:', reason);
      this.isReady = false;
    });

    // Обработчик ошибок
    this.client.on('auth_failure', (msg) => {
      console.error('❌ Ошибка авторизации:', msg);
    });

    await this.client.initialize();

    // Ждём готовности клиента
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout: WhatsApp клиент не готов'));
      }, 120000); // 2 минуты

      const checkReady = setInterval(() => {
        if (this.isReady) {
          clearInterval(checkReady);
          clearTimeout(timeout);
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Отправка сообщения клиенту
   * @param {string} phoneNumber - номер телефона в формате 79XXXXXXXXX
   * @param {string} message - текст сообщения
   */
  async sendMessage(phoneNumber, message) {
    if (!this.isReady) {
      throw new Error('WhatsApp клиент не готов');
    }

    try {
      // Формат номера для WhatsApp: 79XXXXXXXXX@c.us
      const chatId = `${phoneNumber}@c.us`;

      console.log(`📤 Отправка сообщения на ${phoneNumber}...`);

      await this.client.sendMessage(chatId, message);

      console.log(`✅ Сообщение отправлено на ${phoneNumber}`);
      return true;

    } catch (error) {
      console.error(`❌ Ошибка отправки сообщения на ${phoneNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Создаёт текст напоминания для клиента
   * @param {Object} client - данные клиента
   * @returns {string}
   */
  createReminderMessage(client) {
    const expirationDate = client.expirationDate.toLocaleDateString('ru-RU');

    return `Здравствуйте, ${client.name}!

Напоминаем, что срок действия вашей страховки (${client.insurance}) истекает ${expirationDate}.

Для продления страховки, пожалуйста, свяжитесь с нами.

Спасибо, что выбираете наши услуги!`;
  }

  /**
   * Отправляет напоминания списку клиентов
   * @param {Array} clients - массив клиентов
   */
  async sendReminders(clients) {
    console.log(`\n📨 Начинаю отправку напоминаний для ${clients.length} клиентов...\n`);

    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const client of clients) {
      try {
        if (!client.phoneFormatted) {
          console.warn(`⚠️  Пропускаю ${client.name}: нет номера телефона`);
          results.failed++;
          continue;
        }

        const message = this.createReminderMessage(client);
        await this.sendMessage(client.phoneFormatted, message);

        results.success++;

        // Небольшая задержка между сообщениями
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        results.failed++;
        results.errors.push({
          client: client.name,
          error: error.message
        });
      }
    }

    console.log('\n📊 Результаты отправки:');
    console.log(`✅ Успешно: ${results.success}`);
    console.log(`❌ Ошибки: ${results.failed}`);

    if (results.errors.length > 0) {
      console.log('\n❌ Детали ошибок:');
      results.errors.forEach(err => {
        console.log(`  - ${err.client}: ${err.error}`);
      });
    }

    return results;
  }

  /**
   * Закрытие клиента
   */
  async destroy() {
    if (this.client) {
      await this.client.destroy();
      this.isReady = false;
      console.log('🔴 WhatsApp клиент остановлен');
    }
  }

  /**
   * Отключение и выход из WhatsApp (отвязывание устройства)
   */
  async logout() {
    if (this.client) {
      try {
        console.log('🔴 Выход из WhatsApp и отвязывание устройства...');
        await this.client.logout();
        this.isReady = false;
        console.log('✅ Устройство отвязано от WhatsApp');
      } catch (error) {
        console.error('❌ Ошибка при выходе из WhatsApp:', error.message);
        throw error;
      }
    }
  }
}

module.exports = WhatsAppService;
