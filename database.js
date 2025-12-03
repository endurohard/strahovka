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

      CREATE TABLE IF NOT EXISTS daily_reminders (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        reminder_date DATE NOT NULL,
        sent_at TIMESTAMP,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(client_id, reminder_date)
      );

      CREATE INDEX IF NOT EXISTS idx_reminder_date ON clients(reminder_date);
      CREATE INDEX IF NOT EXISTS idx_phone ON clients(phone_formatted);
      CREATE INDEX IF NOT EXISTS idx_daily_reminder_date ON daily_reminders(reminder_date);
      CREATE INDEX IF NOT EXISTS idx_daily_reminder_status ON daily_reminders(status);
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

      // Generate reminders only for 5 days before expiration
      // (5, 4, 3, 2, 1 days before and on expiration day - 6 reminders total)
      for (let daysBeforeEnd = 5; daysBeforeEnd >= 0; daysBeforeEnd--) {
        const reminderDate = new Date(endDate);
        reminderDate.setDate(reminderDate.getDate() - daysBeforeEnd);
        reminders.push({
          client_id: clientId,
          reminder_date: reminderDate
        });
      }

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
    const dateStr = date.toISOString().split('T')[0];

    const query = `
      SELECT
        dr.id as reminder_id,
        dr.reminder_date,
        c.*
      FROM daily_reminders dr
      JOIN clients c ON dr.client_id = c.id
      WHERE dr.reminder_date = $1
        AND dr.status = 'pending'
      ORDER BY c.name;
    `;

    try {
      const result = await this.pool.query(query, [dateStr]);
      return result.rows;
    } catch (error) {
      console.error('❌ Ошибка получения ежедневных напоминаний:', error.message);
      throw error;
    }
  }

  /**
   * Отметка отправки ежедневного напоминания
   * @param {number} reminderId - ID напоминания из daily_reminders
   */
  async markDailyReminderSent(reminderId) {
    const query = `
      UPDATE daily_reminders
      SET sent_at = NOW(), status = 'sent'
      WHERE id = $1;
    `;

    try {
      await this.pool.query(query, [reminderId]);
    } catch (error) {
      console.error(`❌ Ошибка отметки ежедневного напоминания ${reminderId}:`, error.message);
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
