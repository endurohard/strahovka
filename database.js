const { Pool } = require('pg');

class Database {
  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'strahovka',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres'
    });
  }

  /**
   * Инициализация таблиц базы данных
   */
  async initialize() {
    console.log('🔄 Инициализация базы данных...');

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        excel_id INTEGER,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        phone_formatted VARCHAR(20),
        insurance VARCHAR(100),
        services TEXT,
        amount DECIMAL(10, 2),
        start_date DATE NOT NULL,
        expiration_date DATE NOT NULL,
        reminder_date DATE NOT NULL,
        last_reminder_sent TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(phone_formatted, start_date)
      );

      CREATE INDEX IF NOT EXISTS idx_reminder_date ON clients(reminder_date);
      CREATE INDEX IF NOT EXISTS idx_phone ON clients(phone_formatted);
    `;

    try {
      await this.pool.query(createTableQuery);
      console.log('✅ Таблицы созданы успешно');
    } catch (error) {
      console.error('❌ Ошибка создания таблиц:', error.message);
      throw error;
    }
  }

  /**
   * Добавление или обновление клиента
   * @param {Object} client - данные клиента
   */
  async upsertClient(client) {
    const query = `
      INSERT INTO clients (
        excel_id, name, phone, phone_formatted, insurance,
        services, amount, start_date, expiration_date, reminder_date, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (phone_formatted, start_date)
      DO UPDATE SET
        name = EXCLUDED.name,
        insurance = EXCLUDED.insurance,
        services = EXCLUDED.services,
        amount = EXCLUDED.amount,
        expiration_date = EXCLUDED.expiration_date,
        reminder_date = EXCLUDED.reminder_date,
        updated_at = NOW()
      RETURNING id;
    `;

    const values = [
      client.id,
      client.name,
      client.phone,
      client.phoneFormatted,
      client.insurance,
      client.services,
      client.amount,
      client.dateObject,
      client.expirationDate,
      client.reminderDate
    ];

    try {
      const result = await this.pool.query(query, values);
      return result.rows[0].id;
    } catch (error) {
      console.error(`❌ Ошибка при сохранении клиента ${client.name}:`, error.message);
      throw error;
    }
  }

  /**
   * Импорт клиентов из массива
   * @param {Array} clients - массив клиентов
   */
  async importClients(clients) {
    console.log(`\n📥 Импорт ${clients.length} клиентов в базу данных...`);

    let imported = 0;
    let updated = 0;
    let errors = 0;

    for (const client of clients) {
      try {
        // Пропускаем клиентов без обязательных полей
        if (!client.name || !client.dateObject || !client.phoneFormatted) {
          console.warn(`⚠️  Пропускаю клиента: недостаточно данных`, client);
          errors++;
          continue;
        }

        await this.upsertClient(client);
        imported++;
      } catch (error) {
        errors++;
        console.error(`❌ Ошибка импорта клиента ${client.name}:`, error.message);
      }
    }

    console.log(`✅ Импорт завершён: добавлено/обновлено ${imported}, ошибок ${errors}`);
    return { imported, errors };
  }

  /**
   * Получение клиентов для напоминания на указанную дату
   * @param {Date} date - дата для проверки
   */
  async getClientsForReminder(date = new Date()) {
    const dateStr = date.toISOString().split('T')[0];

    const query = `
      SELECT * FROM clients
      WHERE reminder_date = $1
        AND (last_reminder_sent IS NULL OR last_reminder_sent::date < $1)
      ORDER BY name;
    `;

    try {
      const result = await this.pool.query(query, [dateStr]);
      return result.rows;
    } catch (error) {
      console.error('❌ Ошибка получения клиентов для напоминания:', error.message);
      throw error;
    }
  }

  /**
   * Отметка отправки напоминания клиенту
   * @param {number} clientId - ID клиента
   */
  async markReminderSent(clientId) {
    const query = `
      UPDATE clients
      SET last_reminder_sent = NOW()
      WHERE id = $1;
    `;

    try {
      await this.pool.query(query, [clientId]);
    } catch (error) {
      console.error(`❌ Ошибка отметки напоминания для клиента ${clientId}:`, error.message);
      throw error;
    }
  }

  /**
   * Получение всех клиентов
   */
  async getAllClients() {
    const query = 'SELECT * FROM clients ORDER BY start_date DESC;';
    try {
      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('❌ Ошибка получения клиентов:', error.message);
      throw error;
    }
  }

  /**
   * Получение статистики
   */
  async getStats() {
    const query = `
      SELECT
        COUNT(*) as total_clients,
        COUNT(CASE WHEN reminder_date > NOW() THEN 1 END) as upcoming_reminders,
        COUNT(CASE WHEN reminder_date <= NOW() AND (last_reminder_sent IS NULL OR last_reminder_sent::date < NOW()::date) THEN 1 END) as pending_reminders,
        COUNT(CASE WHEN last_reminder_sent IS NOT NULL THEN 1 END) as sent_reminders
      FROM clients;
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Ошибка получения статистики:', error.message);
      throw error;
    }
  }

  /**
   * Закрытие пула соединений
   */
  async close() {
    await this.pool.end();
    console.log('🔴 Соединение с базой данных закрыто');
  }
}

module.exports = Database;
