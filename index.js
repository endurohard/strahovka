require('dotenv').config();
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const Database = require('./database');
const WhatsAppPuppeteer = require('./whatsappPuppeteer');
const { readClientsFromExcel } = require('./excelReader');
const API = require('./api');
const { createBackup, createBackupAndUpload } = require('./backup');

class InsuranceReminderService {
  constructor() {
    this.db = new Database();
    this.whatsapp = new WhatsAppPuppeteer();
    this.excelFilePath = process.env.EXCEL_FILE_PATH || '/data/clients.xlsx';
    this.isRunning = false;
    this.api = null;
    this.queueTimeouts = [];
  }

  /**
   * Инициализация сервиса
   */
  async initialize() {
    console.log('🚀 Запуск сервиса напоминаний о страховке...\n');

    try {
      // Инициализация базы данных
      await this.db.initialize();

      // Загрузка сохранённого шаблона сообщения (переживает рестарт)
      try {
        const savedTemplate = await this.db.getSetting('message_template');
        if (savedTemplate) {
          this.whatsapp.messageTemplate = savedTemplate;
          console.log('✅ Загружен пользовательский шаблон сообщения из БД');
        }
      } catch (e) {
        console.error('⚠️  Не удалось загрузить шаблон из БД:', e.message);
      }

      // Запуск API сервера СНАЧАЛА (до WhatsApp)
      this.api = new API(this.db, this.whatsapp);
      const apiPort = process.env.API_PORT || 3000;
      this.api.start(apiPort);
      console.log(`✅ API сервер запущен на порту ${apiPort}`);

      // Инициализация WhatsApp (асинхронно, не блокирует)
      this.whatsapp.initialize().then(() => {
        console.log('✅ WhatsApp готов!');
      }).catch((error) => {
        console.error('❌ Ошибка WhatsApp:', error.message);
      });

      // Вотчдог: initialize() глотает ошибки запуска браузера (Chromium может
      // упасть при старте после ребута хоста) — тогда isReady навсегда false и
      // очередь молча стоит. Если браузер мёртв — переинициализируем каждые 10 мин.
      this.whatsappReinitInProgress = false;
      this.whatsappWatchdog = setInterval(() => {
        this.retryWhatsAppIfDead().catch((e) =>
          console.error('❌ WhatsApp-вотчдог: ошибка ретрая:', e.message));
      }, 10 * 60 * 1000);

      // Первичная загрузка данных из Excel
      await this.importFromExcel();

      // Показываем статистику
      await this.showStats();

      console.log('\n✅ Сервис успешно запущен!');
      this.isRunning = true;

      // Обработчик очереди: разгребает message_queue каждые 60 сек
      this.queueInterval = setInterval(() => this.processQueue().catch((e) => console.error('processQueue error:', e.message)), 60 * 1000);

      // Первичное наполнение очереди при старте (догоняем сегодняшние/просроченные)
      this.checkAndSendReminders().catch((e) => console.error('Ошибка стартового наполнения очереди:', e.message));

    } catch (error) {
      console.error('❌ Ошибка инициализации сервиса:', error.message);
      throw error;
    }
  }

  /**
   * Переинициализация WhatsApp, если браузер не поднялся.
   * Живой браузер с isReady=false не трогаем — это ожидание сканирования QR.
   */
  async retryWhatsAppIfDead() {
    if (this.whatsapp.isReady || this.whatsappReinitInProgress) return;

    let browserAlive = false;
    try {
      const b = this.whatsapp.browser;
      browserAlive = !!(b && (typeof b.isConnected === 'function' ? b.isConnected() : b.connected));
    } catch (e) {
      browserAlive = false;
    }
    if (browserAlive) return;

    this.whatsappReinitInProgress = true;
    console.log('🔁 WhatsApp не готов, браузер мёртв — повторная инициализация...');
    try {
      try {
        if (this.whatsapp.browser) await this.whatsapp.browser.close();
      } catch (e) { /* браузер уже мёртв */ }
      this.whatsapp.browser = null;
      this.whatsapp.page = null;
      await this.whatsapp.initialize();
      if (this.whatsapp.isReady) {
        console.log('✅ WhatsApp восстановлен после ретрая');
      }
    } finally {
      this.whatsappReinitInProgress = false;
    }
  }

  /**
   * Импорт данных из Excel файла
   */
  async importFromExcel() {
    try {
      console.log('\n📂 Проверка наличия Excel файла...');

      if (!fs.existsSync(this.excelFilePath)) {
        console.warn(`⚠️  Excel файл не найден: ${this.excelFilePath}`);
        console.warn('⚠️  Пропускаю импорт. Поместите файл в /data/clients.xlsx');
        return;
      }

      console.log(`✅ Файл найден: ${this.excelFilePath}`);

      const clients = readClientsFromExcel(this.excelFilePath);

      if (clients.length === 0) {
        console.warn('⚠️  В Excel файле нет данных для импорта');
        return;
      }

      await this.db.importClients(clients);

    } catch (error) {
      console.error('❌ Ошибка импорта из Excel:', error.message);
      throw error;
    }
  }

  /**
   * Показать статистику
   */
  async showStats() {
    try {
      const stats = await this.db.getStats();

      console.log('\n📊 Статистика:');
      console.log(`   Всего клиентов: ${stats.total_clients}`);
      console.log(`   Предстоящих напоминаний: ${stats.upcoming_reminders}`);
      console.log(`   Ожидают отправки: ${stats.pending_reminders}`);
      console.log(`   Уже отправлено: ${stats.sent_reminders}`);

    } catch (error) {
      console.error('❌ Ошибка получения статистики:', error.message);
    }
  }

  /**
   * Заполнение очереди ежедневными напоминаниями.
   * Создаёт записи в message_queue для всех клиентов у которых сегодня reminder_date
   * и которые ещё не попали в очередь сегодня.
   */
  async checkAndSendReminders() {
    if (!this.isRunning) return;

    console.log('\n⏰ Проверка и заполнение очереди напоминаний...');
    console.log(`   Текущее время: ${new Date().toLocaleString('ru-RU')}`);

    try {
      const reminders = await this.db.getDailyReminders();

      if (reminders.length === 0) {
        console.log('   ℹ️  Нет напоминаний для отправки сегодня');
        return;
      }

      const WINDOW_SEC = 10 * 60 * 60;
      const DEFAULT_GAP_SEC = 120;
      const MIN_GAP_SEC = 60;
      const N = reminders.length;
      let gapSec = DEFAULT_GAP_SEC;
      if (N > 1 && (N - 1) * DEFAULT_GAP_SEC > WINDOW_SEC) {
        gapSec = Math.max(MIN_GAP_SEC, Math.floor(WINDOW_SEC / (N - 1)));
      }

      let added = 0;
      for (let i = 0; i < N; i++) {
        const reminder = reminders[i];

        // Не ставим в очередь контакты без номера телефона
        if (!reminder.phone_formatted || !String(reminder.phone_formatted).trim()) {
          console.log('   skip (no phone): ' + reminder.name);
          continue;
        }

        const alreadyQueued = await this.db.isAlreadyQueued(reminder.id, new Date());
        if (alreadyQueued) continue;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expirationDate = new Date(reminder.expiration_date);
        expirationDate.setHours(0, 0, 0, 0);
        const daysLeft = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));

        const message = this.whatsapp.createReminderMessage({
          name: reminder.name,
          insurance: reminder.insurance,
          expirationDate,
          daysLeft
        });

        const scheduledAt = new Date(Date.now() + i * gapSec * 1000);
        await this.db.enqueueMessage(reminder.id, reminder.phone_formatted, reminder.name, message, scheduledAt);
        added++;
      }

      if (added > 0) {
        console.log(`   📨 Добавлено в очередь: ${added} сообщений (шаг ${gapSec} сек)`);
      } else {
        console.log('   ℹ️  Все сегодняшние напоминания уже в очереди');
      }

      // Уведомления админу о контактах без номера телефона (не доставляемы)
      try {
        const noPhone = await this.db.getDueContactsWithoutPhone();
        let notified = 0;
        for (const c of noPhone) {
          const created = await this.db.createAdminNotification({
            type: 'missing_phone',
            clientId: c.id,
            clientName: c.name,
            phone: null,
            message: 'У клиента нет номера телефона — напоминание не может быть отправлено.'
          });
          if (created) notified++;
        }
        if (notified > 0) console.log(`   🔔 Уведомлений о контактах без номера: ${notified}`);
      } catch (e) {
        console.error('   ⚠️  Ошибка уведомлений о контактах без номера:', e.message);
      }

    } catch (error) {
      console.error('❌ Ошибка при заполнении очереди:', error.message);
    }
  }

  /**
   * Обработчик очереди — берёт следующее pending-сообщение и отправляет.
   * Запускается setInterval каждые 60 сек.
   */
  async processQueue() {
    if (!this.isRunning || !this.whatsapp.isReady) return;

    const nowHour = new Date().getHours();
    if (nowHour >= 20 || nowHour < 10) return;

    let item;
    try {
      item = await this.db.getNextQueueItem();
    } catch (e) {
      return;
    }
    if (!item) return;

    // Перепроверка: клиент/номер мог быть поставлен на паузу уже после enqueue.
    if (item.client_id) {
      try {
        const r = await this.db.pool.query(
          'SELECT reminders_paused FROM clients WHERE id = $1',
          [item.client_id]
        );
        if (r.rows[0] && r.rows[0].reminders_paused) {
          await this.db.markQueueItemSkipped(item.id, 'Клиент на паузе');
          console.log(`   ⏸  [Queue] Пропуск (клиент на паузе): ${item.client_name}`);
          return;
        }
      } catch (e) {
        console.error(`   ⚠️  [Queue] Не удалось перечитать флаг паузы клиента (${item.client_name}): ${e.message}`);
      }
    }
    try {
      if (await this.db.isPhonePaused(item.phone)) {
        await this.db.markQueueItemSkipped(item.id, 'Номер в блок-листе');
        console.log(`   ⏸  [Queue] Пропуск (номер в блок-листе): ${item.client_name} (${item.phone})`);
        return;
      }
    } catch (e) {
      console.error(`   ⚠️  [Queue] Не удалось проверить блок-лист номеров: ${e.message}`);
    }

    console.log(`\n📤 [Queue] Отправка: ${item.client_name} (${item.phone}), попытка #${item.attempts + 1}`);
    try {
      await this.whatsapp.sendMessage(item.phone, item.message);
      await this.db.markQueueItemSent(item.id);
      await this.db.markDailyReminderSent(item.client_id);
      console.log(`   ✅ [Queue] Отправлено: ${item.client_name}`);
    } catch (error) {
      // Номер не зарегистрирован в WhatsApp — не повторяем, пропускаем и уведомляем админа
      if (error && error.notRegistered) {
        try {
          await this.db.markQueueItemSkipped(item.id, error.message);
          await this.db.createAdminNotification({
            type: 'unregistered_phone',
            clientId: item.client_id,
            clientName: item.client_name,
            phone: item.phone,
            message: 'Номер не зарегистрирован в WhatsApp — напоминание не отправлено, контакт пропущен.'
          });
          console.warn(`   ⏭️  [Queue] Пропуск (нет WhatsApp): ${item.client_name} (${item.phone}) — создано уведомление админу`);
        } catch (e) {
          console.error(`   ⚠️  [Queue] Ошибка при пометке skip/уведомлении: ${e.message}`);
        }
        return;
      }
      const attempts = item.attempts + 1;
      await this.db.markQueueItemFailed(item.id, error.message, attempts);
      console.warn(`   ❌ [Queue] Ошибка (${item.client_name}): ${error.message} | попытка ${attempts}/${item.max_attempts}`);
    }
  }

  cancelQueue() {
    // Оставлено для обратной совместимости — очередь теперь персистентная в БД
  }

  /**
   * Настройка планировщика задач
   */
  setupScheduler() {
    console.log('\n⏰ Настройка планировщика задач...');

    // Проверка и отправка напоминаний каждый день в 10:00
    cron.schedule('0 10 * * *', async () => {
      console.log('\n🔔 Запуск ежедневной проверки напоминаний...');
      await this.checkAndSendReminders();
    });

    // Обновление данных из Excel каждый день в 09:00
    cron.schedule('0 9 * * *', async () => {
      console.log('\n🔄 Обновление данных из Excel...');
      await this.importFromExcel();
      await this.showStats();
    });

    // Резервное копирование базы данных каждый день в 03:00
    cron.schedule('0 3 * * *', async () => {
      console.log('\nАвтоматическое резервное копирование БД...');
      try {
        const yandexConfigured = process.env.YANDEX_LOGIN && process.env.YANDEX_PASSWORD;
        if (yandexConfigured) {
          const result = await createBackupAndUpload();
          console.log(`Резервная копия создана и загружена на Яндекс.Диск: ${result.filename} (${Math.round(result.size / 1024)} КБ)`);
        } else {
          const result = await createBackup();
          console.log(`Резервная копия создана локально: ${result.filename} (${Math.round(result.size / 1024)} КБ)`);
        }
      } catch (error) {
        console.error('Ошибка резервного копирования:', error.message);
      }
    });

    console.log('✅ Планировщик настроен:');
    console.log('   - 03:00 - резервное копирование БД');
    console.log('   - 09:00 - обновление данных из Excel');
    console.log('   - 10:00 - построение очереди и отправка напоминаний (шаг 2 мин, окно до 20:00 МСК)');
  }

  /**
   * Остановка сервиса
   */
  async shutdown() {
    console.log('\n🛑 Остановка сервиса...');
    this.isRunning = false;
    this.cancelQueue();

    await this.whatsapp.destroy();
    await this.db.close();

    console.log('✅ Сервис остановлен');
    process.exit(0);
  }
}

// Запуск сервиса
const service = new InsuranceReminderService();

(async () => {
  try {
    await service.initialize();
    service.setupScheduler();

    // Обработка сигналов завершения
    process.on('SIGINT', () => service.shutdown());
    process.on('SIGTERM', () => service.shutdown());

    // Опция для немедленной проверки напоминаний (для тестирования)
    if (process.argv.includes('--check-now')) {
      console.log('\n🧪 Запуск проверки напоминаний вручную...');
      await service.checkAndSendReminders();
    }

    // Опция для принудительного импорта
    if (process.argv.includes('--import')) {
      console.log('\n🧪 Принудительный импорт из Excel...');
      await service.importFromExcel();
      await service.showStats();
    }

  } catch (error) {
    console.error('💥 Критическая ошибка:', error);
    process.exit(1);
  }
})();
