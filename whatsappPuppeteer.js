const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class WhatsAppPuppeteer {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isReady = false;
    this.sessionDir = path.join(__dirname, '.wwebjs_auth');
    this.currentQR = null;
    this.messageTemplate = null; // Пользовательский шаблон сообщения

    // Создаем директорию для сессии если её нет
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
        headless: true, // Headless режим для Docker
        userDataDir: this.sessionDir, // Сохраняем сессию
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--remote-debugging-port=9222', // Удаленная отладка
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

      // Ждем либо QR-код, либо успешную авторизацию
      await this.waitForAuth();

      // НЕ устанавливаем isReady здесь - он будет установлен:
      // 1. В waitForAuth() если есть сохраненная сессия
      // 2. В startAuthCheck() когда пользователь отсканирует QR-код
      console.log('✅ WhatsApp Web браузер запущен');

    } catch (error) {
      console.error('❌ Ошибка инициализации WhatsApp:', error.message);
      console.error('   Stack:', error.stack);
      this.isReady = false;
      // НЕ выбрасываем ошибку - просто логируем
      // throw error;
    }
  }

  /**
   * Ожидание авторизации
   */
  async waitForAuth() {
    try {
      console.log('📱 Проверка авторизации...');

      // Ждем несколько секунд, чтобы страница загрузилась
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Проверяем, авторизованы ли мы уже (с коротким таймаутом)
      let isAuthenticated = false;
      try {
        this.page.setDefaultTimeout(10000); // 10 секунд максимум для evaluate
        isAuthenticated = await this.page.evaluate(() => {
          const hasChats = document.querySelector('[role="grid"]') !== null ||
                          document.querySelector('[data-testid="chat-list"]') !== null ||
                          document.querySelector('#pane-side') !== null ||
                          document.querySelector('[aria-label*="Чат"]') !== null ||
                          document.querySelector('[aria-label*="Chat"]') !== null;

          const hasSearchBox = document.querySelector('[data-testid="chat-list-search"]') !== null ||
                               document.querySelector('input[type="text"]') !== null;

          return hasChats || hasSearchBox;
        });
      } catch (evalError) {
        console.log('⚠️  Не удалось проверить авторизацию:', evalError.message);
        isAuthenticated = false;
      }

      if (isAuthenticated) {
        console.log('✅ Сессия сохранена, авторизация не требуется');
        this.isReady = true;
        return;
      }

      console.log('📱 Требуется сканирование QR-кода...');
      console.log('⏳ Откройте страницу настроек WhatsApp и отсканируйте QR-код');

      // НЕ блокируем инициализацию - запускаем проверку авторизации в фоне
      this.startAuthCheck();

      // Считаем что браузер готов для показа QR кода
      console.log('✅ Браузер готов, ожидание сканирования QR-кода');

    } catch (error) {
      // НЕ выбрасываем ошибку - просто логируем
      console.error('❌ Ошибка в waitForAuth:', error.message);
      // Запускаем проверку авторизации в фоне даже при ошибке
      this.startAuthCheck();
      console.log('✅ Браузер готов, ожидание сканирования QR-кода (после ошибки)');
    }
  }

  /**
   * Запуск проверки авторизации в фоне
   */
  startAuthCheck() {
    // Проверяем авторизацию каждые 5 секунд
    const checkInterval = setInterval(async () => {
      try {
        const isAuthenticated = await this.page.evaluate(() => {
          const hasChats = document.querySelector('[role="grid"]') !== null ||
                          document.querySelector('[data-testid="chat-list"]') !== null ||
                          document.querySelector('#pane-side') !== null;
          return hasChats;
        });

        if (isAuthenticated) {
          console.log('✅ WhatsApp авторизован!');
          this.isReady = true;
          clearInterval(checkInterval);
        }
      } catch (error) {
        // Игнорируем ошибки проверки
      }
    }, 5000);
  }

  /**
   * Получить скриншот страницы WhatsApp
   */
  async getScreenshot() {
    if (!this.page) {
      throw new Error('WhatsApp Web не инициализирован');
    }

    try {
      if (this.page.isClosed()) {
        throw new Error('Страница WhatsApp закрыта');
      }

      // Добавляем timeout для screenshot - 5 секунд
      const screenshotPromise = this.page.screenshot({
        type: 'png',
        fullPage: false,
        timeout: 5000
      });

      return await screenshotPromise;
    } catch (error) {
      console.error('Ошибка получения скриншота:', error.message);
      throw new Error(`Не удалось получить скриншот: ${error.message}`);
    }
  }

  /**
   * Отправка сообщения (эмуляция действий пользователя)
   */
  async sendMessage(phoneNumber, message) {
    if (!this.isReady) {
      throw new Error('WhatsApp не готов');
    }

    try {
      // Убираем + из номера для WhatsApp API
      const cleanPhone = phoneNumber.replace(/\+/g, '');

      // ВАЖНО: Передаем текст в URL параметре - WhatsApp автоматически заполнит поле ввода
      const chatUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`;

      console.log(`📤 Отправка сообщения на ${phoneNumber} (URL: ${cleanPhone})...`);

      // Открываем чат с уже заполненным текстом
      await this.page.goto(chatUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      // Ждем загрузки чата
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Ждем появления поля ввода (это подтверждает, что чат открыт)
      const selectors = [
        '[data-testid="conversation-compose-box-input"]',
        'div[contenteditable="true"][data-tab="10"]',
        'div[contenteditable="true"][role="textbox"]',
        'footer div[contenteditable="true"]'
      ];

      let inputFound = false;
      for (const selector of selectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 3000 });
          console.log(`   ✅ Чат открыт, найдено поле ввода: ${selector}`);
          inputFound = true;
          break;
        } catch (e) {
          // Пробуем следующий селектор
        }
      }

      if (!inputFound) {
        throw new Error('Поле ввода сообщения не найдено');
      }

      console.log(`   ✅ Текст автоматически заполнен через URL`);

      // Отправляем Enter
      await this.page.keyboard.press('Enter');

      console.log(`   ✅ Enter нажат`);
      console.log(`✅ Сообщение отправлено на ${phoneNumber}`);

      // Ждем завершения отправки
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Делаем скриншот для проверки
      try {
        const screenshot = await this.page.screenshot();
        const screenshotPath = `/tmp/whatsapp_send_${Date.now()}.png`;
        require('fs').writeFileSync(screenshotPath, screenshot);
        console.log(`📸 Скриншот после отправки сохранен: ${screenshotPath}`);
      } catch (screenshotError) {
        console.log('⚠️  Не удалось сделать скриншот:', screenshotError.message);
      }

      return true;
    } catch (error) {
      console.error(`❌ Ошибка отправки сообщения на ${phoneNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Возвращает шаблон сообщения по умолчанию
   */
  getDefaultTemplate() {
    return `Здравствуйте, {name}!

Напоминаем, что срок действия вашей страховки ({insurance}) истекает {expirationDate}.

{daysLeftMessage}

Для продления страховки, пожалуйста, свяжитесь с нами.

Спасибо, что выбираете наши услуги!`;
  }

  /**
   * Создаёт текст напоминания для клиента
   */
  createReminderMessage(client) {
    const expirationDate = client.expirationDate.toLocaleDateString('ru-RU');
    const daysLeft = client.daysLeft !== undefined ? client.daysLeft : null;

    // Формируем сообщение о количестве дней
    let daysLeftMessage = '';
    if (daysLeft !== null) {
      if (daysLeft === 0) {
        daysLeftMessage = '⚠️ ВНИМАНИЕ: Страховка истекает СЕГОДНЯ!';
      } else if (daysLeft === 1) {
        daysLeftMessage = 'Осталось всего 1 день!';
      } else if (daysLeft <= 7) {
        daysLeftMessage = `Осталось всего ${daysLeft} дней!`;
      } else {
        daysLeftMessage = `Осталось ${daysLeft} дней до окончания.`;
      }
    }

    // Используем пользовательский шаблон или шаблон по умолчанию
    const template = this.messageTemplate || this.getDefaultTemplate();

    // Заменяем плейсхолдеры на реальные значения
    let message = template
      .replace(/\{name\}/g, client.name)
      .replace(/\{insurance\}/g, client.insurance || 'страховка')
      .replace(/\{expirationDate\}/g, expirationDate)
      .replace(/\{daysLeftMessage\}/g, daysLeftMessage)
      .replace(/\{daysLeft\}/g, daysLeft !== null ? daysLeft.toString() : '');

    return message;
  }

  /**
   * Отправляет напоминания списку клиентов
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
      this.browser = null;
      this.page = null;
      this.isReady = false;
      console.log('🔴 WhatsApp браузер закрыт');
    }
  }

  /**
   * Выход из WhatsApp (отвязывание устройства)
   */
  async logout() {
    if (!this.page || !this.isReady) {
      console.log('⚠️  WhatsApp не инициализирован, пропускаем logout');
      return;
    }

    try {
      console.log('🔴 Выполнение logout на странице WhatsApp...');

      // Открываем меню настроек (три точки в верхнем левом углу)
      const menuSelectors = [
        '[data-testid="menu"]',
        '[aria-label*="Menu"]',
        '[title*="Menu"]',
        'header button[aria-label]',
        'header span[data-testid="menu"]'
      ];

      let menuClicked = false;
      for (const selector of menuSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 3000 });
          await this.page.click(selector);
          console.log(`   ✅ Меню открыто через: ${selector}`);
          menuClicked = true;
          break;
        } catch (e) {
          // Пробуем следующий селектор
        }
      }

      if (!menuClicked) {
        console.log('⚠️  Не удалось открыть меню, пропускаем logout на странице');
        return;
      }

      // Ждем появления меню
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Ищем пункт "Выйти" / "Log out"
      const logoutSelectors = [
        '[data-testid="mi-logout"]',
        'li[data-testid*="logout"]',
        'div[role="button"]:has-text("Выйти")',
        'div[role="button"]:has-text("Log out")'
      ];

      let logoutClicked = false;
      for (const selector of logoutSelectors) {
        try {
          await this.page.click(selector);
          console.log(`   ✅ Нажата кнопка выхода через: ${selector}`);
          logoutClicked = true;
          break;
        } catch (e) {
          // Пробуем следующий селектор
        }
      }

      if (!logoutClicked) {
        // Пробуем через XPath
        try {
          const elements = await this.page.$x("//div[contains(text(), 'Выйти') or contains(text(), 'Log out')]");
          if (elements.length > 0) {
            await elements[0].click();
            console.log('   ✅ Нажата кнопка выхода через XPath');
            logoutClicked = true;
          }
        } catch (e) {
          console.log('⚠️  Не удалось найти кнопку выхода');
        }
      }

      if (logoutClicked) {
        // Ждем подтверждения выхода
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Подтверждаем выход (если есть диалог подтверждения)
        try {
          const confirmSelectors = [
            '[data-testid="popup-controls-ok"]',
            'button:has-text("Выйти")',
            'button:has-text("Log out")'
          ];

          for (const selector of confirmSelectors) {
            try {
              await this.page.click(selector, { timeout: 2000 });
              console.log('   ✅ Подтвержден выход');
              break;
            } catch (e) {
              // Может не быть диалога подтверждения
            }
          }
        } catch (e) {
          // Игнорируем, если нет диалога подтверждения
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('✅ Logout выполнен на странице WhatsApp');
      }

    } catch (error) {
      console.error('❌ Ошибка при logout:', error.message);
      // Не выбрасываем ошибку, продолжаем процесс отключения
    }
  }
}

module.exports = WhatsAppPuppeteer;
