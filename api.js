const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const Database = require('./database');
const { readClientsFromExcel } = require('./excelReader');

class API {
  constructor(db, whatsapp) {
    this.db = db;
    this.whatsapp = whatsapp;
    this.app = express();

    // Хранилище пользователей (в продакшене использовать базу данных)
    this.users = {
      'admin': {
        password: 'admin', // В продакшене хранить хешированные пароли
        role: 'admin'
      }
    };

    // Хранилище токенов
    this.tokens = new Map();

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

  // Middleware для проверки авторизации
  requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const token = authHeader.substring(7);
    const username = this.tokens.get(token);

    if (!username) {
      return res.status(401).json({ error: 'Недействительный токен' });
    }

    req.user = { username, ...this.users[username] };
    next();
  }

  // Генерация токена
  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  setupRoutes() {
    // Публичные маршруты (без авторизации)
    this.app.post('/api/login', this.login.bind(this));
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

    // Upload Excel
    const upload = multer({ dest: 'uploads/' });
    this.app.post('/api/upload', this.requireAuth.bind(this), upload.single('file'), this.uploadExcel.bind(this));
  }

  // Вход
  async login(req, res) {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Требуются логин и пароль' });
      }

      const user = this.users[username];

      if (!user || user.password !== password) {
        return res.status(401).json({ error: 'Неверный логин или пароль' });
      }

      // Генерируем токен
      const token = this.generateToken();
      this.tokens.set(token, username);

      res.json({
        token,
        username,
        role: user.role
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
    const username = this.tokens.get(token);

    if (!username) {
      return res.status(401).json({ valid: false });
    }

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
      const { page = 1, limit = 50, search = '', sort = 'reminder_date' } = req.query;
      const offset = (page - 1) * limit;

      let query = `
        SELECT * FROM clients
        WHERE name ILIKE $1 OR phone_formatted ILIKE $1
        ORDER BY ${sort} DESC
        LIMIT $2 OFFSET $3;
      `;

      const countQuery = `
        SELECT COUNT(*) FROM clients
        WHERE name ILIKE $1 OR phone_formatted ILIKE $1;
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
      const { name, phone, insurance, services, amount, start_date } = req.body;

      if (!name || !phone || !start_date) {
        return res.status(400).json({ error: 'Требуются: name, phone, start_date' });
      }

      const startDate = new Date(start_date);
      const expirationDate = new Date(startDate);
      expirationDate.setFullYear(expirationDate.getFullYear() + 1);

      const reminderDate = new Date(expirationDate);
      reminderDate.setDate(reminderDate.getDate() - 7);

      const query = `
        INSERT INTO clients (name, phone, phone_formatted, insurance, services, amount, start_date, expiration_date, reminder_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *;
      `;

      const result = await this.db.pool.query(query, [
        name, phone, phone, insurance, services, amount,
        startDate, expirationDate, reminderDate
      ]);

      res.status(201).json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Обновить клиента
  async updateClient(req, res) {
    try {
      const { id } = req.params;
      const { name, phone, insurance, services, amount, start_date } = req.body;

      const updates = [];
      const values = [];
      let index = 1;

      if (name) {
        updates.push(`name = $${index++}`);
        values.push(name);
      }
      if (phone) {
        updates.push(`phone = $${index++}, phone_formatted = $${index++}`);
        values.push(phone, phone);
      }
      if (insurance) {
        updates.push(`insurance = $${index++}`);
        values.push(insurance);
      }
      if (services) {
        updates.push(`services = $${index++}`);
        values.push(services);
      }
      if (amount) {
        updates.push(`amount = $${index++}`);
        values.push(amount);
      }
      if (start_date) {
        const startDate = new Date(start_date);
        const expirationDate = new Date(startDate);
        expirationDate.setFullYear(expirationDate.getFullYear() + 1);
        const reminderDate = new Date(expirationDate);
        reminderDate.setDate(reminderDate.getDate() - 7);

        updates.push(`start_date = $${index++}, expiration_date = $${index++}, reminder_date = $${index++}`);
        values.push(startDate, expirationDate, reminderDate);
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

      const result = await this.db.pool.query(query, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Клиент не найден' });
      }

      res.json(result.rows[0]);
    } catch (error) {
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
    try {
      console.log('🔄 Запрос на переподключение WhatsApp...');

      // Отключаем текущее соединение
      if (this.whatsapp.client) {
        await this.whatsapp.destroy();
      }

      // Небольшая задержка
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Повторная инициализация
      this.whatsapp.initialize().then(() => {
        console.log('✅ WhatsApp переподключен');
      }).catch((error) => {
        console.error('❌ Ошибка переподключения WhatsApp:', error.message);
      });

      res.json({
        message: 'WhatsApp переподключается...',
        status: 'reconnecting'
      });
    } catch (error) {
      console.error('❌ Ошибка переподключения:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Отключение WhatsApp
  async disconnectWhatsApp(req, res) {
    try {
      console.log('🔴 Запрос на отключение WhatsApp...');

      if (this.whatsapp.client) {
        await this.whatsapp.destroy();
        console.log('✅ WhatsApp отключен');

        res.json({
          message: 'WhatsApp отключен',
          status: 'disconnected'
        });
      } else {
        res.json({
          message: 'WhatsApp уже отключен',
          status: 'disconnected'
        });
      }
    } catch (error) {
      console.error('❌ Ошибка отключения:', error);
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
