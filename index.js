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

      // Первичная загрузка данных из Excel
      await this.importFromExcel();

      // Показываем статистику
      await this.showStats();

      console.log('\n✅ Сервис успешно запущен!');
      this.isRunning = true;

    } catch (error) {
      console.error('❌ Ошибка инициализации сервиса:', error.message);
      throw error;
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
   * Построение дневной очереди напоминаний.
   * Окно: 10:00–20:00 по МСК (TZ контейнера = Europe/Moscow).
   * Шаг по умолчанию — 120 сек; сжимается до 60 сек, если очередь не помещается в окно.
   */
  async checkAndSendReminders() {
    if (!this.isRunning) {
      console.log('⏸️  Сервис не запущен, пропускаю проверку');
      return;
    }

    console.log('\n⏰ Построение очереди ежедневных напоминаний...');
    console.log(`   Текущее время: ${new Date().toLocaleString('ru-RU')}`);

    try {
      const reminders = await this.db.getDailyReminders();

      if (reminders.length === 0) {
        console.log('   ℹ️  Нет напоминаний для отправки сегодня');
        return;
      }

      const WINDOW_SEC = 10 * 60 * 60;   // 10:00–20:00 = 600 мин = 36000 сек
      const DEFAULT_GAP_SEC = 120;       // 2 минуты между клиентами
      const MIN_GAP_SEC = 60;            // сжимаем до 1 минуты при перегрузке
      const N = reminders.length;

      let gapSec = DEFAULT_GAP_SEC;
      if (N > 1 && (N - 1) * DEFAULT_GAP_SEC > WINDOW_SEC) {
        gapSec = Math.max(MIN_GAP_SEC, Math.floor(WINDOW_SEC / (N - 1)));
      }

      const lastEta = new Date(Date.now() + (N - 1) * gapSec * 1000);
      const etaStr = lastEta.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      console.log(`   📨 В очереди ${N} клиент(ов); шаг ${gapSec} сек; последняя отправка ~${etaStr}`);

      this.cancelQueue();

      for (let i = 0; i < N; i++) {
        const reminder = reminders[i];
        const delayMs = i * gapSec * 1000;
        const timeoutId = setTimeout(() => this.sendOneReminder(reminder, i + 1, N), delayMs);
        this.queueTimeouts.push(timeoutId);
      }

    } catch (error) {
      console.error('❌ Ошибка при построении очереди напоминаний:', error.message);
    }
  }

  /**
   * Отмена всех запланированных таймеров (например, при выключении сервиса
   * или при повторном запуске cron в тот же день).
   */
  cancelQueue() {
    if (this.queueTimeouts.length > 0) {
      for (const id of this.queueTimeouts) clearTimeout(id);
      console.log(`   🧹 Отменено ${this.queueTimeouts.length} ожидающих таймер(ов)`);
      this.queueTimeouts = [];
    }
  }

  /**
   * Отправка одного напоминания. Не отправляет после 20:00 МСК.
   * При неудаче после MAX_IMMEDIATE_RETRIES ставит себя обратно в очередь
   * через REQUEUE_DELAY_MS и повторяет до 20:00 или восстановления связи.
   * @param {number} requeueCount - сколько раз уже ставили в очередь повторно
   */
  async sendOneReminder(reminder, index, total, requeueCount = 0) {
    if (!this.isRunning) return;

    const nowHour = new Date().getHours();
    if (nowHour >= 20 || nowHour < 10) {
      if (requeueCount > 0) {
        console.log(`   ⏰ [${index}/${total}] Вне окна 10:00–20:00, отменяю повтор для ${reminder.name}`);
      } else {
        console.log(`   ⏰ Вне окна 10:00–20:00 МСК, пропускаю ${reminder.name} (${index}/${total})`);
      }
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expirationDate = new Date(reminder.expiration_date);
    expirationDate.setHours(0, 0, 0, 0);

    const daysLeft = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));

    const message = this.whatsapp.createReminderMessage({
      name: reminder.name,
      insurance: reminder.insurance,
      expirationDate: expirationDate,
      daysLeft: daysLeft
    });

    const MAX_IMMEDIATE_RETRIES = 2;
    const IMMEDIATE_RETRY_DELAY_MS = 30 * 1000;   // 30 сек между немедленными попытками
    const REQUEUE_DELAY_MS = 10 * 60 * 1000;       // 10 мин до следующей постановки в очередь

    for (let attempt = 1; attempt <= MAX_IMMEDIATE_RETRIES; attempt++) {
      try {
        await this.whatsapp.sendMessage(reminder.phone_formatted, message);
        await this.db.markDailyReminderSent(reminder.reminder_id);
        const retryNote = requeueCount > 0 ? ` (повтор #${requeueCount})` : '';
        console.log(`   ✅ [${index}/${total}] Отправлено${retryNote}: ${reminder.name} (дней до окончания: ${daysLeft})`);
        return;
      } catch (error) {
        if (attempt < MAX_IMMEDIATE_RETRIES) {
          console.warn(`   ⚠️  [${index}/${total}] Попытка ${attempt}/${MAX_IMMEDIATE_RETRIES} (${reminder.name}): ${error.message}`);
          console.warn(`   🔄 Немедленный повтор через ${IMMEDIATE_RETRY_DELAY_MS / 1000} сек...`);
          await new Promise(resolve => setTimeout(resolve, IMMEDIATE_RETRY_DELAY_MS));
        } else {
          console.warn(`   📅 [${index}/${total}] Отправка не удалась (${reminder.name}): ${error.message}`);
          console.warn(`   🔁 Ставлю в очередь повторно через ${REQUEUE_DELAY_MS / 60000} мин (повтор #${requeueCount + 1})...`);
          const timeoutId = setTimeout(
            () => this.sendOneReminder(reminder, index, total, requeueCount + 1),
            REQUEUE_DELAY_MS
          );
          this.queueTimeouts.push(timeoutId);
        }
      }
    }
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
