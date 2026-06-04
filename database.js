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
        issue_date DATE,
        start_date DATE NOT NULL,
        expiration_date DATE NOT NULL,
        reminder_date DATE NOT NULL,
        last_reminder_sent TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(phone_formatted, start_date)
      );

      CREATE TABLE IF NOT EXISTS daily_reminders (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        reminder_date DATE NOT NULL,
        sent_at TIMESTAMP,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(client_id, reminder_date)
      );

      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        category VARCHAR(100),
        description VARCHAR(255),
        amount DECIMAL(10, 2) NOT NULL,
        expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE clients
        ADD COLUMN IF NOT EXISTS insurance_expense DECIMAL(10,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id),
        ADD COLUMN IF NOT EXISTS employee_expense DECIMAL(10,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS issue_date DATE;

      ALTER TABLE expenses
        ADD COLUMN IF NOT EXISTS category VARCHAR(100);

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

      CREATE INDEX IF NOT EXISTS idx_reminder_date ON clients(reminder_date);
      CREATE INDEX IF NOT EXISTS idx_phone ON clients(phone_formatted);
      CREATE INDEX IF NOT EXISTS idx_daily_reminder_date ON daily_reminders(reminder_date);
      CREATE INDEX IF NOT EXISTS idx_daily_reminder_status ON daily_reminders(status);

      CREATE TABLE IF NOT EXISTS message_queue (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        phone VARCHAR(20) NOT NULL,
        client_name VARCHAR(255),
        message TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 10,
        scheduled_at TIMESTAMP DEFAULT NOW(),
        sent_at TIMESTAMP,
        last_attempt_at TIMESTAMP,
        next_retry_at TIMESTAMP DEFAULT NOW(),
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_mq_status ON message_queue(status);
      CREATE INDEX IF NOT EXISTS idx_mq_next_retry ON message_queue(next_retry_at) WHERE status = 'pending';

      CREATE TABLE IF NOT EXISTS admin_notifications (
        id SERIAL PRIMARY KEY,
        type VARCHAR(40) NOT NULL DEFAULT 'unregistered_phone',
        client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        client_name VARCHAR(255),
        phone VARCHAR(20),
        message TEXT,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_admin_notif_unread ON admin_notifications(is_read) WHERE is_read = false;
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
    const hasPhone = client.phoneFormatted && client.phoneFormatted.length > 0;

    const query = hasPhone ? `
      INSERT INTO clients (
        excel_id, name, phone, phone_formatted, insurance,
        services, amount, insurance_expense, employee_expense, employee_id,
        issue_date, start_date, expiration_date, reminder_date, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
        CASE WHEN $9::numeric > 0 THEN (SELECT id FROM employees WHERE name = $14 AND active = true LIMIT 1) ELSE NULL END,
        $10, $11, $12, $13, NOW())
      ON CONFLICT (phone_formatted, start_date)
      DO UPDATE SET
        name = EXCLUDED.name,
        insurance = EXCLUDED.insurance,
        services = EXCLUDED.services,
        amount = EXCLUDED.amount,
        insurance_expense = EXCLUDED.insurance_expense,
        employee_expense = EXCLUDED.employee_expense,
        employee_id = EXCLUDED.employee_id,
        issue_date = EXCLUDED.issue_date,
        expiration_date = EXCLUDED.expiration_date,
        reminder_date = EXCLUDED.reminder_date,
        updated_at = NOW()
      RETURNING id;
    ` : `
      INSERT INTO clients (
        excel_id, name, phone, phone_formatted, insurance,
        services, amount, insurance_expense, employee_expense, employee_id,
        issue_date, start_date, expiration_date, reminder_date, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
        CASE WHEN $9::numeric > 0 THEN (SELECT id FROM employees WHERE name = $14 AND active = true LIMIT 1) ELSE NULL END,
        $10, $11, $12, $13, NOW())
      ON CONFLICT (name, start_date) WHERE phone_formatted IS NULL OR phone_formatted = ''
      DO UPDATE SET
        insurance = EXCLUDED.insurance,
        services = EXCLUDED.services,
        amount = EXCLUDED.amount,
        insurance_expense = EXCLUDED.insurance_expense,
        employee_expense = EXCLUDED.employee_expense,
        employee_id = EXCLUDED.employee_id,
        issue_date = EXCLUDED.issue_date,
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
      client.insuranceExpense || 0,
      client.employeeExpense || 0,
      client.issueDate,
      client.dateObject,
      client.expirationDate,
      client.reminderDate,
      client.employeeName || 'Зухра'
    ];

    try {
      const result = await this.pool.query(query, values);
      const clientId = result.rows[0].id;

      // Генерируем ежедневные напоминания от даты оформления до даты окончания
      await this.generateDailyReminders(clientId, client.dateObject, client.expirationDate);

      return clientId;
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
        // Пропускаем клиентов без имени или даты
        if (!client.name || !client.dateObject) {
          console.warn(`⚠️  Пропускаю клиента: нет имени или даты`, client);
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
        COUNT(CASE WHEN reminder_date <= NOW()
                   AND expiration_date::date >= CURRENT_DATE
                   AND (last_reminder_sent IS NULL OR last_reminder_sent::date < NOW()::date)
                   AND phone_formatted IS NOT NULL AND btrim(phone_formatted) <> ''
                   AND NOT EXISTS (
                     SELECT 1 FROM message_queue mq
                     WHERE mq.client_id = clients.id AND mq.status = 'skipped'
                       AND mq.created_at::date = CURRENT_DATE
                   )
                 THEN 1 END) as pending_reminders,
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
   * Генерация ежедневных напоминаний для клиента
   * Создает запись на каждый день от даты оформления до даты окончания страховки
   * @param {number} clientId - ID клиента
   * @param {Date} startDate - дата оформления
   * @param {Date} expirationDate - дата окончания страховки
   */
  async generateDailyReminders(clientId, startDate, expirationDate) {
    try {
      const reminders = [];
      const endDate = new Date(expirationDate);
      endDate.setHours(0, 0, 0, 0);

      // Generate reminder 7 days before expiration (1 reminder only)
      const reminderDate = new Date(endDate);
      reminderDate.setDate(reminderDate.getDate() - 7);
      reminders.push({
        client_id: clientId,
        reminder_date: reminderDate
      });

      // Insert all reminders in one query
      if (reminders.length > 0) {
        const values = reminders.map((r, idx) =>
          `($${idx * 2 + 1}, $${idx * 2 + 2})`
        ).join(', ');

        const flatValues = reminders.flatMap(r => [r.client_id, r.reminder_date]);

        const query = `
          INSERT INTO daily_reminders (client_id, reminder_date)
          VALUES ${values}
          ON CONFLICT (client_id, reminder_date) DO NOTHING;
        `;

        await this.pool.query(query, flatValues);
        console.log(`Created ${reminders.length} daily reminders for client ${clientId}`);
      }
    } catch (error) {
      console.error(`Error generating daily reminders for client ${clientId}:`, error.message);
      throw error;
    }
  }

  /**
   * Получение клиентов для ежедневных напоминаний на указанную дату
   * @param {Date} date - дата для проверки
   */
  async getDailyReminders(date = new Date()) {
    // Используем clients.reminder_date — дата там правильная (за 7 дней до окончания).
    // daily_reminders содержит смещённые даты из-за timezone-бага при генерации.
    const query = `
      SELECT
        c.id as reminder_id,
        c.reminder_date,
        c.*
      FROM clients c
      WHERE c.reminder_date::date <= CURRENT_DATE
        AND c.expiration_date::date >= CURRENT_DATE
        AND c.phone_formatted IS NOT NULL AND btrim(c.phone_formatted) <> ''
        AND (c.last_reminder_sent IS NULL OR c.last_reminder_sent::date < CURRENT_DATE)
      ORDER BY c.name;
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('❌ Ошибка получения ежедневных напоминаний:', error.message);
      throw error;
    }
  }

  /**
   * Отметка отправки напоминания клиенту (обновляет clients.last_reminder_sent)
   * @param {number} reminderId - clients.id
   */
  async markDailyReminderSent(reminderId) {
    const query = `
      UPDATE clients
      SET last_reminder_sent = NOW()
      WHERE id = $1;
    `;

    try {
      await this.pool.query(query, [reminderId]);
    } catch (error) {
      console.error(`❌ Ошибка отметки отправки напоминания для клиента ${reminderId}:`, error.message);
      throw error;
    }
  }


  // Просроченные/сегодняшние контакты без номера телефона (для уведомления админу)
  async getDueContactsWithoutPhone() {
    const result = await this.pool.query(`
      SELECT id, name FROM clients
      WHERE reminder_date::date <= CURRENT_DATE
        AND expiration_date::date >= CURRENT_DATE
        AND (last_reminder_sent IS NULL OR last_reminder_sent::date < CURRENT_DATE)
        AND (phone_formatted IS NULL OR btrim(phone_formatted) = '')
      ORDER BY name;
    `);
    return result.rows;
  }

  // ==================== MESSAGE QUEUE ====================

  async enqueueMessage(clientId, phone, clientName, message, scheduledAt = null) {
    const query = `
      INSERT INTO message_queue (client_id, phone, client_name, message, scheduled_at, next_retry_at)
      VALUES ($1, $2, $3, $4, $5, $5)
      RETURNING id;
    `;
    const at = scheduledAt || new Date();
    const result = await this.pool.query(query, [clientId, phone, clientName, message, at]);
    return result.rows[0].id;
  }

  async getNextQueueItem() {
    const query = `
      SELECT * FROM message_queue
      WHERE status = 'pending'
        AND next_retry_at <= NOW()
      ORDER BY next_retry_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED;
    `;
    const result = await this.pool.query(query);
    return result.rows[0] || null;
  }

  async markQueueItemSent(id) {
    await this.pool.query(
      `UPDATE message_queue SET status = 'sent', sent_at = NOW(), last_attempt_at = NOW(), error_message = NULL WHERE id = $1`,
      [id]
    );
  }

  async markQueueItemSkipped(id, reason) {
    await this.pool.query(
      `UPDATE message_queue SET status = 'skipped', last_attempt_at = NOW(), error_message = $2 WHERE id = $1`,
      [id, (reason || '').substring(0, 500)]
    );
  }

  // ==================== ADMIN NOTIFICATIONS ====================

  // Создаёт уведомление админу; дедуплицирует по (type, phone) среди непрочитанных.
  async createAdminNotification({ type = 'unregistered_phone', clientId = null, clientName = null, phone = null, message = null }) {
    const result = await this.pool.query(
      `INSERT INTO admin_notifications (type, client_id, client_name, phone, message)
       SELECT $1::varchar, $2::int, $3::varchar, $4::varchar, $5::text
       WHERE NOT EXISTS (
         SELECT 1 FROM admin_notifications
         WHERE type = $1::varchar AND client_id IS NOT DISTINCT FROM $2::int AND is_read = false
       )
       RETURNING id`,
      [type, clientId, clientName, phone, message]
    );
    return result.rows[0] ? result.rows[0].id : null;
  }

  async getAdminNotifications(limit = 50) {
    const result = await this.pool.query(
      `SELECT * FROM admin_notifications ORDER BY is_read ASC, created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async getUnreadNotificationCount() {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM admin_notifications WHERE is_read = false`
    );
    return result.rows[0].count;
  }

  async markNotificationRead(id) {
    await this.pool.query(`UPDATE admin_notifications SET is_read = true WHERE id = $1`, [id]);
  }

  async markAllNotificationsRead() {
    await this.pool.query(`UPDATE admin_notifications SET is_read = true WHERE is_read = false`);
  }

  async markQueueItemFailed(id, errorMessage, attempts) {
    const backoffMinutes = [5, 10, 30, 60, 120, 240, 480, 960, 960, 960];
    const delayMin = backoffMinutes[Math.min(attempts, backoffMinutes.length - 1)];
    const nextRetry = new Date(Date.now() + delayMin * 60 * 1000);
    const maxAttempts = 10;
    const newStatus = attempts >= maxAttempts ? 'failed' : 'pending';
    await this.pool.query(
      `UPDATE message_queue
       SET status = $1, attempts = $2, last_attempt_at = NOW(),
           next_retry_at = $3, error_message = $4
       WHERE id = $5`,
      [newStatus, attempts, nextRetry, errorMessage.substring(0, 500), id]
    );
  }

  async getQueueStats() {
    const result = await this.pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) as total
      FROM message_queue
      WHERE created_at >= CURRENT_DATE;
    `);
    return result.rows[0];
  }

  async getQueueItems(limit = 100, offset = 0) {
    const result = await this.pool.query(
      `SELECT * FROM message_queue ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  }

  async retryQueueItem(id) {
    await this.pool.query(
      `UPDATE message_queue SET status = 'pending', next_retry_at = NOW(), error_message = NULL WHERE id = $1`,
      [id]
    );
  }

  async isAlreadyQueued(clientId, scheduledDate) {
    const dateStr = scheduledDate.toISOString().split('T')[0];
    const result = await this.pool.query(
      `SELECT id FROM message_queue
       WHERE client_id = $1
         AND created_at::date = $2
         AND status IN ('pending', 'sent', 'skipped')
       LIMIT 1`,
      [clientId, dateStr]
    );
    return result.rows.length > 0;
  }

  /**
   * Закрытие пула соединений
   */
  async close() {
    await this.pool.end();
    console.log('🔴 Соединение с базой данных закрыто');
  }

  async getEmployees() {
    const query = 'SELECT * FROM employees WHERE active = true ORDER BY name;';
    const result = await this.pool.query(query);
    return result.rows;
  }

  async createEmployee(name, phone = null) {
    const query = 'INSERT INTO employees (name, phone) VALUES ($1, $2) RETURNING *;';
    const result = await this.pool.query(query, [name, phone]);
    return result.rows[0];
  }

  async updateEmployee(id, name, phone, active) {
    const query = 'UPDATE employees SET name = $1, phone = $2, active = $3 WHERE id = $4 RETURNING *;';
    const result = await this.pool.query(query, [name, phone, active, id]);
    return result.rows[0];
  }

  async deleteEmployee(id) {
    const query = 'UPDATE employees SET active = false WHERE id = $1 RETURNING *;';
    const result = await this.pool.query(query, [id]);
    return result.rows[0];
  }

  // ==================== EXPENSES ====================

  async getExpenses(startDate, endDate) {
    const query = `
      SELECT * FROM expenses 
      WHERE expense_date BETWEEN $1 AND $2 
      ORDER BY expense_date DESC;
    `;
    const result = await this.pool.query(query, [startDate, endDate]);
    return result.rows;
  }

  async createExpense(expenseDate, category, description, amount) {
    const query = `
      INSERT INTO expenses (expense_date, category, description, amount)
      VALUES ($1, $2, $3, $4) RETURNING *;
    `;
    const result = await this.pool.query(query, [expenseDate, category, description, amount]);
    return result.rows[0];
  }

  async deleteExpense(id) {
    const query = 'DELETE FROM expenses WHERE id = $1 RETURNING *;';
    const result = await this.pool.query(query, [id]);
    return result.rows[0];
  }

  // ==================== ANALYTICS ====================

  async getAnalytics(startDate, endDate) {
    // Доходы и расходы от клиентов
    const incomeQuery = `
      SELECT
        COALESCE(SUM(amount), 0) as total_income,
        COALESCE(SUM(insurance_expense), 0) as total_insurance_expenses,
        COALESCE(SUM(employee_expense), 0) as total_employee_expenses,
        COUNT(*) as total_policies
      FROM clients
      WHERE start_date BETWEEN $1 AND $2;
    `;
    const incomeResult = await this.pool.query(incomeQuery, [startDate, endDate]);

    // По сотрудникам - считаем прибыль с полисов (доход - страховая - сотруднику)
    const byEmployeeQuery = `
      SELECT
        e.id,
        e.name as employee_name,
        COUNT(c.id) as policies_count,
        COALESCE(SUM(c.amount), 0) as total_income,
        COALESCE(SUM(c.employee_expense), 0) as total_expense,
        COALESCE(SUM(c.amount - COALESCE(c.insurance_expense, 0) - COALESCE(c.employee_expense, 0)), 0) as profit
      FROM employees e
      LEFT JOIN clients c ON c.employee_id = e.id
        AND c.start_date BETWEEN $1 AND $2
      WHERE e.active = true
      GROUP BY e.id, e.name
      ORDER BY profit DESC;
    `;
    const byEmployeeResult = await this.pool.query(byEmployeeQuery, [startDate, endDate]);

    // Расходы по категориям
    const expensesQuery = `
      SELECT
        category,
        COALESCE(SUM(amount), 0) as total
      FROM expenses
      WHERE expense_date BETWEEN $1 AND $2
      GROUP BY category;
    `;
    const expensesResult = await this.pool.query(expensesQuery, [startDate, endDate]);

    // Зарплаты (отдельно от прочих расходов)
    const salaryQuery = `
      SELECT COALESCE(SUM(amount), 0) as total
      FROM expenses
      WHERE expense_date BETWEEN $1 AND $2 AND category = 'salary';
    `;
    const salaryResult = await this.pool.query(salaryQuery, [startDate, endDate]);

    // Прочие расходы (без зарплат)
    const otherExpensesQuery = `
      SELECT COALESCE(SUM(amount), 0) as total
      FROM expenses
      WHERE expense_date BETWEEN $1 AND $2 AND category != 'salary';
    `;
    const otherExpensesResult = await this.pool.query(otherExpensesQuery, [startDate, endDate]);

    const totalIncome = parseFloat(incomeResult.rows[0].total_income) || 0;
    const insuranceExpenses = parseFloat(incomeResult.rows[0].total_insurance_expenses) || 0;
    const employeeExpenses = parseFloat(incomeResult.rows[0].total_employee_expenses) || 0;
    const salaryExpenses = parseFloat(salaryResult.rows[0].total) || 0;
    const otherExpenses = parseFloat(otherExpensesResult.rows[0].total) || 0;

    // Валовая прибыль = Доход от клиентов - Страховым компаниям
    const grossProfit = totalIncome - insuranceExpenses;

    // Чистая прибыль = Валовая прибыль - Сотрудникам (с полисов) - Зарплаты - Прочие расходы
    const netProfit = grossProfit - employeeExpenses - salaryExpenses - otherExpenses;

    return {
      period: { startDate, endDate },
      summary: {
        totalIncome: totalIncome,
        totalPolicies: parseInt(incomeResult.rows[0].total_policies) || 0,
        insuranceExpenses: insuranceExpenses,
        grossProfit: grossProfit,
        employeeExpenses: employeeExpenses,
        salaryExpenses: salaryExpenses,
        otherExpenses: otherExpenses,
        netProfit: netProfit
      },
      byEmployee: byEmployeeResult.rows,
      expensesByCategory: expensesResult.rows
    };
  }

  async getClientsByPeriod(startDate, endDate) {
    const query = `
      SELECT c.*, e.name as employee_name
      FROM clients c
      LEFT JOIN employees e ON c.employee_id = e.id
      WHERE c.start_date BETWEEN $1 AND $2
      ORDER BY c.start_date DESC;
    `;
    const result = await this.pool.query(query, [startDate, endDate]);
    return result.rows;
  }

}

module.exports = Database;
