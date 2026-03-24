const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { hashPassword, comparePassword } = require('./utils/passwordHelper');
const { createAuthLimiter } = require('./utils/rateLimiter');

const Database = require('./database');
const { readClientsFromExcel } = require('./excelReader');
const { createBackup, createBackupAndUpload, restoreBackup, uploadToYandexDisk, listBackups, getBackupPath } = require('./backup');

class API {
  constructor(db, whatsapp) {
    this.db = db;
    this.whatsapp = whatsapp;
    this.app = express();

    // Хранилище пользователей (в продакшене использовать базу данных)
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin';
    this.users = {
      [adminUser]: {
        password: adminPass, // В продакшене хранить хешированные пароли
        role: 'admin'
      }
    };

    // Хранилище токенов
    this.tokens = new Map();

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

  // Нормализация номера телефона: 8xxx -> +7xxx, 7xxx -> +7xxx, 9xxx -> +79xxx
  normalizePhone(phone) {
    if (!phone) return phone;
    // Убираем все нецифровые символы кроме +
    let cleaned = phone.replace(/[^\d+]/g, '');

    // Если начинается с 8 и длина 11 цифр - заменяем 8 на +7
    if (cleaned.startsWith('8') && cleaned.length === 11) {
      return '+7' + cleaned.substring(1);
    }
    // Если начинается с 7 (без +) и длина 11 цифр - добавляем +
    if (cleaned.startsWith('7') && !cleaned.startsWith('+') && cleaned.length === 11) {
      return '+' + cleaned;
    }
    // Если начинается с 9 и длина 10 цифр - добавляем +7
    if (cleaned.startsWith('9') && cleaned.length === 10) {
      return '+7' + cleaned;
    }
    // Если уже начинается с +7 - оставляем как есть
    if (cleaned.startsWith('+7')) {
      return cleaned;
    }
    return cleaned;
  }

  // Middleware для проверки авторизации
  requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const token = authHeader.substring(7);
    const tokenData = this.tokens.get(token);

    if (!tokenData) {
      return res.status(401).json({ error: 'Недействительный токен' });
    }

    // Проверяем срок действия токена (24 часа)
    const TOKEN_TTL = 24 * 60 * 60 * 1000;
    if (Date.now() - tokenData.createdAt > TOKEN_TTL) {
      this.tokens.delete(token);
      return res.status(401).json({ error: 'Токен истёк, войдите заново' });
    }

    const username = tokenData.username;
    req.user = { username, ...this.users[username] };
    next();
  }

  // Генерация токена
  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  setupRoutes() {
    // Публичные маршруты (без авторизации)
    const authLimiter = createAuthLimiter();
    this.app.post('/api/login', authLimiter.middleware(), this.login.bind(this));
    this.app.get('/api/verify-token', this.verifyToken.bind(this));
    this.app.get('/login', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'login.html'));
    });

    // Главная страница (требует авторизацию)
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Страница настроек WhatsApp
    this.app.get('/settings.html', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'settings.html'));
    });

    // API endpoints (требуют авторизацию)
    this.app.get('/api/health', this.requireAuth.bind(this), this.getHealth.bind(this));
    this.app.get('/api/stats', this.requireAuth.bind(this), this.getStats.bind(this));
    this.app.get('/api/clients', this.requireAuth.bind(this), this.getClients.bind(this));
    this.app.get('/api/clients/:id', this.requireAuth.bind(this), this.getClient.bind(this));
    this.app.post('/api/clients', this.requireAuth.bind(this), this.createClient.bind(this));
    this.app.put('/api/clients/:id', this.requireAuth.bind(this), this.updateClient.bind(this));
    this.app.delete('/api/clients/:id', this.requireAuth.bind(this), this.deleteClient.bind(this));
    this.app.post('/api/clients/:id/remind', this.requireAuth.bind(this), this.sendManualReminder.bind(this));
    this.app.post('/api/import', this.requireAuth.bind(this), this.importExcel.bind(this));
    this.app.post('/api/send-reminders', this.requireAuth.bind(this), this.sendReminders.bind(this));
    this.app.post('/api/send-test', this.requireAuth.bind(this), this.sendTest.bind(this));
    this.app.get('/api/whatsapp/status', this.requireAuth.bind(this), this.getWhatsAppStatus.bind(this));
    this.app.get('/api/whatsapp/screenshot', this.requireAuth.bind(this), this.getWhatsAppScreenshot.bind(this));
    this.app.post('/api/whatsapp/reconnect', this.requireAuth.bind(this), this.reconnectWhatsApp.bind(this));
    this.app.post('/api/whatsapp/disconnect', this.requireAuth.bind(this), this.disconnectWhatsApp.bind(this));
    this.app.post('/api/logout', this.requireAuth.bind(this), this.logout.bind(this));
    this.app.post('/api/admin/change-credentials', this.requireAuth.bind(this), this.changeAdminCredentials.bind(this));

    // Управление пользователями
    this.app.get('/api/users', this.requireAuth.bind(this), this.getUsers.bind(this));
    this.app.post('/api/users', this.requireAuth.bind(this), this.createUser.bind(this));
    this.app.put('/api/users/:id', this.requireAuth.bind(this), this.updateUser.bind(this));
    this.app.delete('/api/users/:id', this.requireAuth.bind(this), this.deleteUser.bind(this));
    this.app.post('/api/users/change-password', this.requireAuth.bind(this), this.changeUserPassword.bind(this));

    this.app.get('/api/message-template', this.requireAuth.bind(this), this.getMessageTemplate.bind(this));
    this.app.post('/api/message-template', this.requireAuth.bind(this), this.saveMessageTemplate.bind(this));

    // Upload Excel
    const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (req, file, cb) => { const ext = path.extname(file.originalname).toLowerCase(); cb(null, ['.xlsx', '.xls'].includes(ext)); } });
    this.app.post('/api/upload', this.requireAuth.bind(this), upload.single('file'), this.uploadExcel.bind(this));
// Employees
    this.app.get("/api/employees", this.requireAuth.bind(this), this.getEmployees.bind(this));
    this.app.post("/api/employees", this.requireAuth.bind(this), this.createEmployee.bind(this));
    this.app.put("/api/employees/:id", this.requireAuth.bind(this), this.updateEmployee.bind(this));
    this.app.delete("/api/employees/:id", this.requireAuth.bind(this), this.deleteEmployee.bind(this));
    
    // Expenses
    this.app.get("/api/expenses", this.requireAuth.bind(this), this.getExpenses.bind(this));
    this.app.post("/api/expenses", this.requireAuth.bind(this), this.createExpense.bind(this));
    this.app.delete("/api/expenses/:id", this.requireAuth.bind(this), this.deleteExpense.bind(this));
    
    // Analytics
    this.app.get("/api/analytics", this.requireAuth.bind(this), this.getAnalytics.bind(this));
    
    // Analytics page
    this.app.get("/analytics.html", (req, res) => {
      res.sendFile(path.join(__dirname, "public", "analytics.html"));
    });

    // Backup
    this.app.get('/api/backup/list', this.requireAuth.bind(this), this.getBackupList.bind(this));
    this.app.post('/api/backup/create', this.requireAuth.bind(this), this.createBackup.bind(this));
    this.app.post('/api/backup/upload-yandex', this.requireAuth.bind(this), this.uploadBackupToYandex.bind(this));
    this.app.post('/api/backup/restore/:filename', this.requireAuth.bind(this), this.restoreBackup.bind(this));
    this.app.get('/api/backup/yandex-status', this.requireAuth.bind(this), this.getYandexStatus.bind(this));
    this.app.get('/api/backup/download/:filename', this.requireAuth.bind(this), this.downloadBackup.bind(this));
    this.app.get('/backup.html', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'backup.html'));
    });
  }

  // Вход
  async login(req, res) {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Требуются логин и пароль' });
      }

      let user = null;
      let role = 'user';

      // Сначала проверяем админа из env
      const adminUser = process.env.ADMIN_USERNAME || 'admin';
      const adminPass = process.env.ADMIN_PASSWORD || 'admin';

      if (username === adminUser && password === adminPass) {
        user = { username: adminUser, role: 'admin' };
        role = 'admin';
      } else {
        // Проверяем пользователей из базы данных
        const result = await this.db.pool.query(
          'SELECT * FROM users WHERE username = $1 AND active = true',
          [username]
        );
        if (result.rows.length > 0) {
          const dbUser = result.rows[0];
          const passwordMatch = await comparePassword(password, dbUser.password);
          if (passwordMatch) {
            user = dbUser;
            role = user.role || 'user';
          }
        }
      }

      if (!user) {
        return res.status(401).json({ error: 'Неверный логин или пароль' });
      }

      // Генерируем токен
      const token = this.generateToken();
      this.tokens.set(token, { username, createdAt: Date.now() });

      // Сохраняем инфо о пользователе для requireAuth
      this.users[username] = { password, role };

      res.json({
        token,
        username,
        role
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Проверка токена
  async verifyToken(req, res) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ valid: false });
    }

    const token = authHeader.substring(7);
    const tokenData = this.tokens.get(token);

    if (!tokenData) {
      return res.status(401).json({ valid: false });
    }

    const TOKEN_TTL = 24 * 60 * 60 * 1000;
    if (Date.now() - tokenData.createdAt > TOKEN_TTL) {
      this.tokens.delete(token);
      return res.status(401).json({ valid: false });
    }

    const username = tokenData.username;
    res.json({
      valid: true,
      username,
      role: this.users[username].role
    });
  }

  // Выход
  async logout(req, res) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      this.tokens.delete(token);
    }

    res.json({ message: 'Выход выполнен успешно' });
  }

  // Health check
  async getHealth(req, res) {
    try {
      await this.db.pool.query('SELECT 1');
      res.json({
        status: 'ok',
        database: 'connected',
        whatsapp: this.whatsapp.isReady ? 'ready' : 'not ready',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  }

  // Статистика
  async getStats(req, res) {
    try {
      const stats = await this.db.getStats();

      // Дополнительная статистика
      const upcomingQuery = `
        SELECT
          DATE(reminder_date) as date,
          COUNT(*) as count
        FROM clients
        WHERE reminder_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
        GROUP BY DATE(reminder_date)
        ORDER BY date;
      `;
      const upcoming = await this.db.pool.query(upcomingQuery);

      res.json({
        ...stats,
        upcoming: upcoming.rows,
        whatsapp_ready: this.whatsapp.isReady
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Получить всех клиентов
  async getClients(req, res) {
    try {
      const { page = 1, limit = 50, search = '', sort = 'reminder_date', filter = '' } = req.query;
      const offset = (page - 1) * limit;

      const allowedSorts = { reminder_date: 'ASC', name: 'ASC', created_at: 'DESC' };
      const sortColumn = allowedSorts[sort] ? sort : 'reminder_date';
      const sortDir = allowedSorts[sortColumn];

      let filterClause = '';
      if (filter === 'upcoming') {
        filterClause = `AND reminder_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'`;
      } else if (filter === 'pending') {
        filterClause = `AND reminder_date <= NOW() AND (last_reminder_sent IS NULL OR last_reminder_sent::date < NOW()::date)`;
      }

      let query = `
        SELECT * FROM clients
        WHERE (name ILIKE $1 OR phone_formatted ILIKE $1)
        ${filterClause}
        ORDER BY ${sortColumn} ${sortDir}
        LIMIT $2 OFFSET $3;
      `;

      const countQuery = `
        SELECT COUNT(*) FROM clients
        WHERE (name ILIKE $1 OR phone_formatted ILIKE $1)
        ${filterClause};
      `;

      const clients = await this.db.pool.query(query, [`%${search}%`, limit, offset]);
      const total = await this.db.pool.query(countQuery, [`%${search}%`]);

      res.json({
        clients: clients.rows,
        total: parseInt(total.rows[0].count),
        page: parseInt(page),
        pages: Math.ceil(total.rows[0].count / limit)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Получить клиента по ID
  async getClient(req, res) {
    try {
      const { id } = req.params;
      const result = await this.db.pool.query('SELECT * FROM clients WHERE id = $1', [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Клиент не найден' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Создать клиента
  async createClient(req, res) {
    try {
      const { name, insurance, services, amount, insurance_expense, start_date, expiration_date, employee_id, employee_expense } = req.body;
      const phone = this.normalizePhone(req.body.phone);

      if (!name || !phone) {
        return res.status(400).json({ error: 'Требуются: name, phone' });
      }

      // Дата оформления - если не указана, используем текущую дату
      const startDate = start_date ? new Date(start_date) : new Date();

      // Дата окончания страховки - если не указана, вычисляем через год от даты оформления
      let expirationDate;
      if (expiration_date) {
        expirationDate = new Date(expiration_date);
      } else {
        expirationDate = new Date(startDate);
        expirationDate.setFullYear(expirationDate.getFullYear() + 1);
      }

      // Дата напоминания - за 14 дней до окончания
      const reminderDate = new Date(expirationDate);
      reminderDate.setDate(reminderDate.getDate() - 14);

      const query = `
        INSERT INTO clients (name, phone, phone_formatted, insurance, services, amount, insurance_expense, start_date, expiration_date, reminder_date, employee_id, employee_expense)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *;
      `;

      const result = await this.db.pool.query(query, [
        name, phone, phone, insurance || null, services || null, amount || 0, insurance_expense || 0,
        startDate, expirationDate, reminderDate, employee_id || null, employee_expense || 0
      ]);

      const newClient = result.rows[0];

      // Генерируем ежедневные напоминания от даты оформления до даты окончания
      await this.db.generateDailyReminders(newClient.id, startDate, expirationDate);

      res.status(201).json(newClient);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Обновить клиента
  async updateClient(req, res) {
    try {
      const { id } = req.params;
      const { name, phone, insurance, services, amount, start_date, expiration_date, insurance_expense, employee_id, employee_expense } = req.body;
      console.log('updateClient:', { id, body: req.body });

      const updates = [];
      const values = [];
      let index = 1;

      if (name) {
        updates.push(`name = $${index++}`);
        values.push(name);
      }
      if (phone) {
        const normalizedPhone = this.normalizePhone(phone);
        updates.push(`phone = $${index++}, phone_formatted = $${index++}`);
        values.push(normalizedPhone, normalizedPhone);
      }
      if (insurance) {
        updates.push(`insurance = $${index++}`);
        values.push(insurance);
      }
      if (services) {
        updates.push(`services = $${index++}`);
        values.push(services);
      }
      if (amount !== undefined && amount !== '') {
        updates.push(`amount = $${index++}`);
        values.push(parseFloat(amount) || 0);
      }
      if (insurance_expense !== undefined && insurance_expense !== '') {
        updates.push(`insurance_expense = $${index++}`);
        values.push(parseFloat(insurance_expense) || 0);
      }
      if (employee_id !== undefined) {
        updates.push(`employee_id = $${index++}`);
        values.push(employee_id === '' ? null : (parseInt(employee_id) || null));
      }
      if (employee_expense !== undefined && employee_expense !== '') {
        updates.push(`employee_expense = $${index++}`);
        values.push(parseFloat(employee_expense) || 0);
      }
      if (start_date) {
        updates.push(`start_date = $${index++}`);
        values.push(new Date(start_date));
      }
      if (expiration_date) {
        const expDate = new Date(expiration_date);
        const reminderDate = new Date(expDate);
        reminderDate.setDate(reminderDate.getDate() - 14);

        updates.push(`expiration_date = $${index++}, reminder_date = $${index++}`);
        values.push(expDate, reminderDate);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'Нет данных для обновления' });
      }

      updates.push(`updated_at = NOW()`);
      values.push(id);

      const query = `
        UPDATE clients
        SET ${updates.join(', ')}
        WHERE id = $${index}
        RETURNING *;
      `;

      console.log('SQL Query:', query, 'Values:', values);
      const result = await this.db.pool.query(query, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Клиент не найден' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('updateClient error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Удалить клиента
  async deleteClient(req, res) {
    try {
      const { id } = req.params;
      const result = await this.db.pool.query('DELETE FROM clients WHERE id = $1 RETURNING *', [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Клиент не найден' });
      }

      res.json({ message: 'Клиент удален', client: result.rows[0] });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Отправить ручное напоминание одному клиенту
  async sendManualReminder(req, res) {
    try {
      const { id } = req.params;

      if (!this.whatsapp.isReady) {
        return res.status(503).json({ error: 'WhatsApp не готов' });
      }

      // Получить данные клиента
      const result = await this.db.pool.query('SELECT * FROM clients WHERE id = $1', [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Клиент не найден' });
      }

      const client = result.rows[0];

      // Проверить наличие телефона
      if (!client.phone_formatted || client.phone_formatted.trim() === '') {
        return res.status(400).json({ error: 'У клиента нет номера телефона' });
      }

      // Создать сообщение
      const message = this.whatsapp.createReminderMessage({
        name: client.name,
        insurance: client.insurance,
        expirationDate: new Date(client.expiration_date)
      });

      // Отправить сообщение
      await this.whatsapp.sendMessage(client.phone_formatted, message);

      // Отметить напоминание как отправленное
      await this.db.markReminderSent(client.id);

      res.json({
        message: 'Напоминание отправлено',
        client: client.name,
        phone: client.phone_formatted
      });
    } catch (error) {
      console.error('Ошибка отправки ручного напоминания:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Импорт из Excel
  async importExcel(req, res) {
    try {
      const excelPath = process.env.EXCEL_FILE_PATH || '/data/clients.xlsx';

      if (!fs.existsSync(excelPath)) {
        return res.status(404).json({ error: 'Excel файл не найден' });
      }

      const clients = readClientsFromExcel(excelPath);
      const result = await this.db.importClients(clients);

      res.json({
        message: 'Импорт завершен',
        imported: result.imported,
        errors: result.errors,
        total: clients.length
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Загрузить Excel файл
  async uploadExcel(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
      }

      const clients = readClientsFromExcel(req.file.path);
      const result = await this.db.importClients(clients);

      // Удаляем временный файл
      fs.unlinkSync(req.file.path);

      res.json({
        message: 'Файл загружен и импортирован',
        imported: result.imported,
        errors: result.errors,
        total: clients.length
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Отправить напоминания
  async sendReminders(req, res) {
    try {
      if (!this.whatsapp.isReady) {
        return res.status(503).json({ error: 'WhatsApp не готов' });
      }

      const clientsToRemind = await this.db.getClientsForReminder();

      if (clientsToRemind.length === 0) {
        return res.json({ message: 'Нет клиентов для напоминания сегодня', sent: 0 });
      }

      let sent = 0;
      let errors = 0;

      for (const client of clientsToRemind) {
        try {
          const message = this.whatsapp.createReminderMessage({
            name: client.name,
            insurance: client.insurance,
            expirationDate: new Date(client.expiration_date)
          });

          await this.whatsapp.sendMessage(client.phone_formatted, message);
          await this.db.markReminderSent(client.id);
          sent++;

          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (err) {
          errors++;
        }
      }

      res.json({
        message: 'Напоминания отправлены',
        sent,
        errors,
        total: clientsToRemind.length
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Тестовая отправка
  async sendTest(req, res) {
    try {
      const { phone, message } = req.body;

      if (!phone || !message) {
        return res.status(400).json({ error: 'Требуются: phone, message' });
      }

      if (!this.whatsapp.isReady) {
        return res.status(503).json({ error: 'WhatsApp не готов' });
      }

      await this.whatsapp.sendMessage(phone, message);

      res.json({ message: 'Сообщение отправлено' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Статус WhatsApp
  getWhatsAppStatus(req, res) {
    res.json({
      ready: this.whatsapp.isReady,
      status: this.whatsapp.isReady ? 'connected' : 'disconnected',
      browserActive: this.whatsapp.browser !== null
    });
  }

  // Получить скриншот WhatsApp
  async getWhatsAppScreenshot(req, res) {
    try {
      console.log('📸 Запрос на скриншот WhatsApp');
      console.log('   Browser:', !!this.whatsapp.browser);
      console.log('   Page:', !!this.whatsapp.page);
      console.log('   Ready:', this.whatsapp.isReady);

      const screenshot = await this.whatsapp.getScreenshot();
      console.log('✅ Скриншот получен, размер:', screenshot.length, 'байт');

      res.set('Content-Type', 'image/png');
      res.send(screenshot);
    } catch (error) {
      console.error('❌ Ошибка получения скриншота:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  // Переподключение WhatsApp
  async reconnectWhatsApp(req, res) {
    // Сразу отправляем ответ клиенту
    res.json({
      message: 'WhatsApp переподключается, требуется новый QR-код',
      status: 'reconnecting'
    });

    // Выполняем переподключение асинхронно
    setImmediate(async () => {
      try {
        console.log('🔄 Запрос на переподключение WhatsApp...');

        // Закрываем браузер с таймаутом
        if (this.whatsapp.browser) {
          console.log('🔴 Закрытие браузера...');
          try {
            const destroyPromise = this.whatsapp.destroy();
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Timeout')), 5000)
            );
            await Promise.race([destroyPromise, timeoutPromise]);
            console.log('✅ Браузер закрыт');
          } catch (destroyError) {
            console.warn('⚠️  Браузер не закрыт (таймаут или ошибка):', destroyError.message);
          }
        }

        // Даем время на освобождение ресурсов
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Удаляем папку сессии
        const sessionDir = path.join(__dirname, '.wwebjs_auth');
        if (fs.existsSync(sessionDir)) {
          console.log('🗑️  Удаление сессии WhatsApp...');
          try {
            const { execSync } = require('child_process');
            execSync(`rm -rf "${sessionDir}"`);
            console.log('✅ Сессия удалена');
          } catch (rmError) {
            console.error('❌ Ошибка удаления сессии:', rmError.message);
            // Пробуем через fs
            try {
              fs.rmSync(sessionDir, { recursive: true, force: true });
              console.log('✅ Сессия удалена (через fs)');
            } catch (fsError) {
              console.error('❌ Не удалось удалить сессию:', fsError.message);
            }
          }
        }

        // Небольшая задержка перед повторной инициализацией
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Повторная инициализация
        console.log('🔄 Запуск новой сессии WhatsApp...');
        this.whatsapp.initialize().then(() => {
          console.log('✅ WhatsApp переподключен, требуется сканирование QR-кода');
        }).catch((error) => {
          console.error('❌ Ошибка переподключения WhatsApp:', error.message);
        });

      } catch (error) {
        console.error('❌ Ошибка переподключения:', error);
        console.error('   Stack:', error.stack);
      }
    });
  }

  // Отключение WhatsApp
  async disconnectWhatsApp(req, res) {
    // Сразу отправляем ответ клиенту, чтобы не зависнуть
    res.json({
      message: 'Отключение WhatsApp запущено...',
      status: 'disconnecting'
    });

    // Выполняем отключение асинхронно
    setImmediate(async () => {
      try {
        console.log('🔴 Запрос на отключение WhatsApp...');

        // ВАЖНО: Сначала вызываем logout для отвязки устройства через UI
        if (this.whatsapp.page && this.whatsapp.isReady) {
          console.log('🔴 Попытка отвязать устройство через UI...');
          try {
            const logoutPromise = this.whatsapp.logout();
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Logout timeout')), 15000)
            );

            await Promise.race([logoutPromise, timeoutPromise]);
            console.log('✅ Устройство отвязано через UI');

            // Даем время на завершение logout
            await new Promise(resolve => setTimeout(resolve, 3000));
          } catch (logoutError) {
            console.warn('⚠️  Не удалось отвязать через UI:', logoutError.message);
            // Продолжаем удаление сессии
          }
        }

        // Удаляем папку сессии
        const sessionDir = path.join(__dirname, '.wwebjs_auth');
        console.log('📂 Проверка папки сессии:', sessionDir);

        if (fs.existsSync(sessionDir)) {
          console.log('🗑️  Удаление сессии WhatsApp...');
          try {
            const { execSync } = require('child_process');
            execSync(`rm -rf "${sessionDir}"`);
            console.log('✅ Сессия удалена');
          } catch (rmError) {
            console.error('❌ Ошибка удаления сессии:', rmError.message);
            // Пробуем через fs
            try {
              fs.rmSync(sessionDir, { recursive: true, force: true });
              console.log('✅ Сессия удалена (через fs)');
            } catch (fsError) {
              console.error('❌ Не удалось удалить сессию:', fsError.message);
            }
          }
        } else {
          console.log('ℹ️  Папка сессии не существует');
        }

        // Теперь закрываем браузер (с таймаутом)
        console.log('🔴 Попытка закрытия браузера...');
        try {
          const destroyPromise = this.whatsapp.destroy();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 3000)
          );

          await Promise.race([destroyPromise, timeoutPromise]);
          console.log('✅ Браузер закрыт');
        } catch (destroyError) {
          console.warn('⚠️  Браузер не закрыт (таймаут или ошибка):', destroyError.message);
          // Убиваем процесс браузера принудительно
          try {
            console.log('🔪 Принудительное завершение процессов Chrome...');
            const { execSync } = require('child_process');
            execSync('pkill -f chrome || true');
            execSync('pkill -f chromium || true');
            console.log('✅ Процессы завершены');
          } catch (killError) {
            console.warn('⚠️  Не удалось убить процессы:', killError.message);
          }
        }

        console.log('✅ WhatsApp отключен и устройство отвязано');
        console.log('ℹ️  Для повторного подключения перезагрузите контейнер');

      } catch (error) {
        console.error('❌ Ошибка отключения:', error);
        console.error('   Stack:', error.stack);
      }
    });
  }

  // Изменение учетных данных администратора
  async changeAdminCredentials(req, res) {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Логин и пароль обязательны' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
      }

      // Получаем текущего пользователя
      const currentUsername = req.user.username;

      // Удаляем старого пользователя
      delete this.users[currentUsername];

      // Создаем нового пользователя
      this.users[username] = {
        password: password, // В продакшене хранить хешированные пароли
        role: 'admin'
      };

      // Инвалидируем все токены
      this.tokens.clear();

      console.log(`✅ Учетные данные администратора обновлены: ${username}`);

      res.json({
        message: 'Учетные данные успешно обновлены',
        username: username
      });
    } catch (error) {
      console.error('❌ Ошибка изменения учетных данных:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Получить шаблон сообщения
  async getMessageTemplate(req, res) {
    try {
      const template = this.whatsapp.messageTemplate || this.whatsapp.getDefaultTemplate();
      res.json({ template });
    } catch (error) {
      console.error('❌ Ошибка получения шаблона:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Сохранить шаблон сообщения
  async saveMessageTemplate(req, res) {
    try {
      const { template } = req.body;

      if (!template || template.trim() === '') {
        return res.status(400).json({ error: 'Шаблон сообщения не может быть пустым' });
      }

      // Проверяем наличие необходимых плейсхолдеров
      const requiredPlaceholders = ['{name}', '{insurance}', '{expirationDate}'];
      const missingPlaceholders = requiredPlaceholders.filter(ph => !template.includes(ph));

      if (missingPlaceholders.length > 0) {
        return res.status(400).json({
          error: `Шаблон должен содержать следующие плейсхолдеры: ${missingPlaceholders.join(', ')}`
        });
      }

      this.whatsapp.messageTemplate = template;
      console.log('✅ Шаблон сообщения обновлен');

      res.json({
        message: 'Шаблон сообщения успешно сохранен',
        template: template
      });
    } catch (error) {
      console.error('❌ Ошибка сохранения шаблона:', error);
      res.status(500).json({ error: error.message });
    }
  }

// ==================== EMPLOYEES API ====================
  
  async getEmployees(req, res) {
    try {
      const employees = await this.db.getEmployees();
      res.json(employees);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createEmployee(req, res) {
    try {
      const { name, phone } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }
      const employee = await this.db.createEmployee(name, phone);
      res.status(201).json(employee);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateEmployee(req, res) {
    try {
      const { id } = req.params;
      const { name, phone, active } = req.body;
      const employee = await this.db.updateEmployee(id, name, phone, active);
      res.json(employee);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async deleteEmployee(req, res) {
    try {
      const { id } = req.params;
      const employee = await this.db.deleteEmployee(id);
      res.json({ message: "Employee deactivated", employee });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // ==================== EXPENSES API ====================

  async getExpenses(req, res) {
    try {
      const { start_date, end_date } = req.query;
      const startDate = start_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
      const endDate = end_date || new Date().toISOString().split("T")[0];
      const expenses = await this.db.getExpenses(startDate, endDate);
      res.json(expenses);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createExpense(req, res) {
    try {
      const { expense_date, category, description, amount } = req.body;
      if (!expense_date || !category || !amount) {
        return res.status(400).json({ error: "expense_date, category and amount are required" });
      }
      const expense = await this.db.createExpense(expense_date, category, description, amount);
      res.status(201).json(expense);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async deleteExpense(req, res) {
    try {
      const { id } = req.params;
      const expense = await this.db.deleteExpense(id);
      res.json({ message: "Expense deleted", expense });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // ==================== ANALYTICS API ====================

  async getAnalytics(req, res) {
    try {
      const { start_date, end_date } = req.query;
      const startDate = start_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
      const endDate = end_date || new Date().toISOString().split("T")[0];
      const analytics = await this.db.getAnalytics(startDate, endDate);
      res.json(analytics);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // ==================== USERS API ====================

  async getUsers(req, res) {
    try {
      const result = await this.db.pool.query('SELECT id, username, role, active, created_at FROM users ORDER BY id');
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createUser(req, res) {
    try {
      const { username, password, role } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Требуются username и password' });
      }
      const hashedPassword = await hashPassword(password);
      const result = await this.db.pool.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role, active, created_at',
        [username, hashedPassword, role || 'user']
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Пользователь с таким именем уже существует' });
      }
      res.status(500).json({ error: error.message });
    }
  }

  async updateUser(req, res) {
    try {
      const { id } = req.params;
      const { username, password, role, active } = req.body;

      let query, params;
      if (password) {
        const hashedPassword = await hashPassword(password);
        query = 'UPDATE users SET username = $1, password = $2, role = $3, active = $4 WHERE id = $5 RETURNING id, username, role, active';
        params = [username, hashedPassword, role, active, id];
      } else {
        query = 'UPDATE users SET username = $1, role = $2, active = $3 WHERE id = $4 RETURNING id, username, role, active';
        params = [username, role, active, id];
      }

      const result = await this.db.pool.query(query, params);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async deleteUser(req, res) {
    try {
      const { id } = req.params;
      const result = await this.db.pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      res.json({ message: 'Пользователь удален' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async changeUserPassword(req, res) {
    try {
      const { old_password, new_password } = req.body;
      const username = req.user.username;

      if (!old_password || !new_password) {
        return res.status(400).json({ error: 'Требуются old_password и new_password' });
      }

      // Проверяем старый пароль
      const checkResult = await this.db.pool.query(
        'SELECT * FROM users WHERE username = $1',
        [username]
      );

      if (checkResult.rows.length === 0) {
        return res.status(400).json({ error: 'Пользователь не найден' });
      }

      const passwordMatch = await comparePassword(old_password, checkResult.rows[0].password);
      if (!passwordMatch) {
        return res.status(400).json({ error: 'Неверный текущий пароль' });
      }

      // Обновляем пароль
      const hashedNewPassword = await hashPassword(new_password);
      await this.db.pool.query(
        'UPDATE users SET password = $1 WHERE username = $2',
        [hashedNewPassword, username]
      );

      res.json({ message: 'Пароль успешно изменен' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // ==================== BACKUP API ====================

  async restoreBackup(req, res) {
    try {
      const { filename } = req.params;
      const filepath = getBackupPath(filename);

      if (!filepath) {
        return res.status(404).json({ error: 'Файл резервной копии не найден' });
      }

      console.log(`Восстановление БД из резервной копии: ${filename}`);
      const result = await restoreBackup(filepath);

      console.log(`БД восстановлена: таблиц ${result.tables}, строк ${result.rows}`);
      res.json({
        message: 'База данных успешно восстановлена',
        filename,
        tables: result.tables,
        rows: result.rows
      });
    } catch (error) {
      console.error('Ошибка восстановления:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  async getYandexStatus(req, res) {
    const login = process.env.YANDEX_LOGIN;
    const password = process.env.YANDEX_PASSWORD;

    if (!login || !password) {
      return res.json({ connected: false, error: 'Не настроен (YANDEX_LOGIN/YANDEX_PASSWORD отсутствуют в .env)' });
    }

    const https = require('https');
    const auth = Buffer.from(`${login}:${password}`).toString('base64');

    try {
      const status = await new Promise((resolve) => {
        const req = https.request({
          hostname: 'webdav.yandex.ru',
          path: '/',
          method: 'PROPFIND',
          headers: { 'Authorization': `Basic ${auth}`, 'Depth': '0' }
        }, res => resolve(res.statusCode));
        req.on('error', () => resolve(0));
        req.end();
      });

      if (status === 207) {
        res.json({ connected: true, login });
      } else if (status === 401) {
        res.json({ connected: false, error: 'Неверный логин или пароль (401)' });
      } else {
        res.json({ connected: false, error: `Неожиданный статус: ${status}` });
      }
    } catch (error) {
      res.json({ connected: false, error: error.message });
    }
  }

  async getBackupList(req, res) {
    try {
      const backups = listBackups();
      res.json(backups);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createBackup(req, res) {
    try {
      const result = await createBackup();
      res.json({ message: 'Резервная копия создана', ...result });
    } catch (error) {
      console.error('Ошибка создания резервной копии:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  async uploadBackupToYandex(req, res) {
    try {
      const yandexConfigured = process.env.YANDEX_LOGIN && process.env.YANDEX_PASSWORD;
      if (!yandexConfigured) {
        return res.status(400).json({ error: 'YANDEX_LOGIN и YANDEX_PASSWORD не заданы в .env' });
      }

      // Если передан filename — загружаем существующую копию, иначе создаём новую
      const { filename } = req.body;
      let result;

      if (filename) {
        const filepath = getBackupPath(filename);
        if (!filepath) return res.status(404).json({ error: 'Файл не найден' });
        const { url } = await uploadToYandexDisk(filepath);
        result = { filename, yandex_url: url };
      } else {
        result = await createBackupAndUpload();
      }

      res.json({ message: 'Резервная копия загружена на Яндекс.Диск', ...result });
    } catch (error) {
      console.error('Ошибка загрузки на Яндекс.Диск:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  async downloadBackup(req, res) {
    try {
      const { filename } = req.params;
      const filepath = getBackupPath(filename);

      if (!filepath) {
        return res.status(404).json({ error: 'Файл не найден' });
      }

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.sendFile(filepath);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  start(port = 3000) {
    this.app.listen(port, () => {
      console.log(`🌐 API сервер запущен на порту ${port}`);
      console.log(`   http://localhost:${port}`);
    });
  }
}

module.exports = API;
