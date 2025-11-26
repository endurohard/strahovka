// WhatsApp сервис на чистом Puppeteer (как в проекте pack)
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class WhatsAppService {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isReady = false;
    this.sessionDir = path.join(__dirname, 'whatsapp-session');

    // Создаем директорию для сессии
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  /**
   * Инициализация браузера и WhatsApp Web
   */
  async initialize() {
    try {
      console.log('🚀 Запуск браузера для WhatsApp Web...');

      this.browser = await puppeteer.launch({
        headless: false, // Браузер должен быть видимым для WhatsApp
        userDataDir: this.sessionDir, // Сохранение сессии
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled'
        ]
      });

      this.page = await this.browser.newPage();
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      console.log('🌐 Открытие WhatsApp Web...');
      await this.page.goto('https://web.whatsapp.com', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      // Ждем авторизации
      await this.waitForAuth();

      console.log('✅ WhatsApp Web готов!');
      this.isReady = true;

    } catch (error) {
      console.error('❌ Ошибка инициализации WhatsApp:', error.message);
      throw error;
    }
  }

  /**
   * Ожидание авторизации
   */
  async waitForAuth() {
    try {
      console.log('📱 Проверка авторизации...');

      // Ждем загрузки страницы
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Проверяем, авторизованы ли мы
      const isAuthenticated = await this.page.evaluate(() => {
        const hasChats = document.querySelector('[role="grid"]') !== null ||
                        document.querySelector('[data-testid="chat-list"]') !== null ||
                        document.querySelector('#pane-side') !== null;
        return hasChats;
      });

      if (isAuthenticated) {
        console.log('✅ Сессия сохранена, авторизация не требуется');
        this.isReady = true;
        return;
      }

      console.log('📱 Требуется сканирование QR-кода...');
      console.log('⏳ Откройте WhatsApp на телефоне и отсканируйте QR-код в браузере');
      console.log('   1. Откройте WhatsApp на телефоне');
      console.log('   2. Нажмите три точки → "Связанные устройства"');
      console.log('   3. Нажмите "Привязать устройство"');
      console.log('   4. Отсканируйте QR-код\n');

      // Ждем появления интерфейса WhatsApp
      await this.page.waitForFunction(() => {
        const hasChats = document.querySelector('[role="grid"]') !== null ||
                        document.querySelector('[data-testid="chat-list"]') !== null ||
                        document.querySelector('#pane-side')  !== null;
        return hasChats;
      }, {
        timeout: 300000 // 5 минут на сканирование
      });

      console.log('✅ Авторизация успешна!');

      // Даем время загрузиться чатам
      await new Promise(resolve => setTimeout(resolve, 3000));
      this.isReady = true;

    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.error('❌ Время ожидания сканирования QR-кода истекло');
      }
      throw error;
    }
  }

  /**
   * Отправка сообщения
   */
  async sendMessage(phone, message) {
    if (!this.isReady) {
      throw new Error('WhatsApp Web не инициализирован');
    }

    try {
      // Нормализуем номер
      let cleanPhone = phone.replace(/[^0-9]/g, '');
      if (cleanPhone.startsWith('8')) {
        cleanPhone = '7' + cleanPhone.substring(1);
      }
      if (!cleanPhone.startsWith('7')) {
        cleanPhone = '7' + cleanPhone;
      }

      const url = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`;

      console.log(`📤 Открытие чата с номером ${cleanPhone}...`);
      await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Ждем загрузки чата
      await this.page.waitForSelector('[data-testid="conversation-compose-box-input"]', {
        timeout: 10000
      });

      // Нажимаем Enter для отправки (сообщение уже в поле)
      await this.page.keyboard.press('Enter');

      console.log(`✅ Сообщение отправлено на ${cleanPhone}`);

      // Небольшая задержка
      await new Promise(resolve => setTimeout(resolve, 1000));

      return {
        success: true,
        phone: cleanPhone,
        message: 'Сообщение отправлено'
      };

    } catch (error) {
      console.error(`❌ Ошибка отправки на ${phone}:`, error.message);
      throw error;
    }
  }

  /**
   * Создание текста напоминания
   */
  createReminderMessage(client) {
    const expirationDate = client.expirationDate.toLocaleDateString('ru-RU');

    return `Здравствуйте, ${client.name}!

Напоминаем, что срок действия вашей страховки (${client.insurance}) истекает ${expirationDate}.

Для продления страховки, пожалуйста, свяжитесь с нами.

Спасибо, что выбираете наши услуги!`;
  }

  /**
   * Отправка напоминаний списку клиентов
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
        if (!client.phoneFormatted && !client.phone_formatted) {
          console.warn(`⚠️  Пропускаю ${client.name}: нет номера телефона`);
          results.failed++;
          continue;
        }

        const phone = client.phoneFormatted || client.phone_formatted;
        const message = this.createReminderMessage({
          name: client.name,
          insurance: client.insurance,
          expirationDate: new Date(client.expiration_date)
        });

        await this.sendMessage(phone, message);
        results.success++;

        // Задержка между сообщениями
        await new Promise(resolve => setTimeout(resolve, 3000));

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
   * Закрытие браузера
   */
  async destroy() {
    if (this.browser) {
      await this.browser.close();
      console.log('🔴 Браузер закрыт');
    }
  }
}

module.exports = WhatsAppService;
