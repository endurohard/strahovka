require('dotenv').config();
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const Database = require('./database');
const WhatsAppPuppeteer = require('./whatsappPuppeteer');
const { readClientsFromExcel } = require('./excelReader');
const API = require('./api');

class InsuranceReminderService {
  constructor() {
    this.db = new Database();
    this.whatsapp = new WhatsAppPuppeteer();
    this.excelFilePath = process.env.EXCEL_FILE_PATH || '/data/clients.xlsx';
    this.isRunning = false;
    this.api = null;
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
   * Проверка и отправка напоминаний
   */
  async checkAndSendReminders() {
    if (!this.isRunning) {
      console.log('⏸️  Сервис не запущен, пропускаю проверку');
      return;
    }

    console.log('\n⏰ Проверка напоминаний...');
    console.log(`   Текущее время: ${new Date().toLocaleString('ru-RU')}`);

    try {
      // Получаем клиентов для напоминания
      const clientsToRemind = await this.db.getClientsForReminder();

      if (clientsToRemind.length === 0) {
        console.log('   ℹ️  Нет клиентов для напоминания сегодня');
        return;
      }

      console.log(`   📨 Найдено ${clientsToRemind.length} клиентов для напоминания`);

      // Отправляем напоминания через WhatsApp
      for (const client of clientsToRemind) {
        try {
          const message = this.whatsapp.createReminderMessage({
            name: client.name,
            insurance: client.insurance,
            expirationDate: new Date(client.expiration_date)
          });

          await this.whatsapp.sendMessage(client.phone_formatted, message);

          // Отмечаем в базе данных
          await this.db.markReminderSent(client.id);

          console.log(`   ✅ Отправлено: ${client.name} (${client.phone_formatted})`);

          // Задержка между сообщениями
          await new Promise(resolve => setTimeout(resolve, 3000));

        } catch (error) {
          console.error(`   ❌ Ошибка отправки для ${client.name}:`, error.message);
        }
      }

      console.log('\n✅ Проверка напоминаний завершена');

    } catch (error) {
      console.error('❌ Ошибка при проверке напоминаний:', error.message);
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

    console.log('✅ Планировщик настроен:');
    console.log('   - 09:00 - обновление данных из Excel');
    console.log('   - 10:00 - проверка и отправка напоминаний');
  }

  /**
   * Остановка сервиса
   */
  async shutdown() {
    console.log('\n🛑 Остановка сервиса...');
    this.isRunning = false;

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
