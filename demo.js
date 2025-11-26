// Демо-версия API для тестирования веб-интерфейса без БД и WhatsApp
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Тестовые данные
let testClients = [
  {
    id: 1,
    name: 'Магомедов М-Салам',
    phone: '89094843221',
    phone_formatted: '79094843221',
    insurance: 'ингос',
    amount: 5200,
    start_date: '2024-11-01',
    expiration_date: '2025-11-01',
    reminder_date: '2025-10-25',
    last_reminder_sent: null
  },
  {
    id: 2,
    name: 'Нураев Магомед',
    phone: '89604113888',
    phone_formatted: '79604113888',
    insurance: 'альфа',
    amount: 10500,
    start_date: '2024-11-01',
    expiration_date: '2025-11-01',
    reminder_date: '2025-10-25',
    last_reminder_sent: '2024-10-25'
  },
  {
    id: 3,
    name: 'Саидов Магомедхабиб',
    phone: '89034232951',
    phone_formatted: '79034232951',
    insurance: 'ингос',
    amount: 8300,
    start_date: '2024-11-01',
    expiration_date: '2025-11-01',
    reminder_date: '2025-10-25',
    last_reminder_sent: null
  }
];

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: 'demo mode',
    whatsapp: 'demo mode',
    timestamp: new Date().toISOString()
  });
});

// Статистика
app.get('/api/stats', (req, res) => {
  const total = testClients.length;
  const sent = testClients.filter(c => c.last_reminder_sent).length;
  const pending = testClients.filter(c => !c.last_reminder_sent && new Date(c.reminder_date) <= new Date()).length;
  const upcoming = testClients.filter(c => !c.last_reminder_sent && new Date(c.reminder_date) > new Date()).length;

  res.json({
    total_clients: total,
    sent_reminders: sent,
    pending_reminders: pending,
    upcoming_reminders: upcoming,
    whatsapp_ready: false
  });
});

// Получить всех клиентов
app.get('/api/clients', (req, res) => {
  const { page = 1, limit = 50, search = '', sort = 'reminder_date' } = req.query;

  let filtered = testClients;

  if (search) {
    filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
    );
  }

  const total = filtered.length;
  const start = (page - 1) * limit;
  const end = start + parseInt(limit);
  const clients = filtered.slice(start, end);

  res.json({
    clients,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / limit)
  });
});

// Получить клиента по ID
app.get('/api/clients/:id', (req, res) => {
  const client = testClients.find(c => c.id === parseInt(req.params.id));
  if (!client) {
    return res.status(404).json({ error: 'Клиент не найден' });
  }
  res.json(client);
});

// Создать клиента
app.post('/api/clients', (req, res) => {
  const { name, phone, insurance, start_date, amount } = req.body;

  if (!name || !phone || !start_date) {
    return res.status(400).json({ error: 'Требуются: name, phone, start_date' });
  }

  const startDate = new Date(start_date);
  const expirationDate = new Date(startDate);
  expirationDate.setFullYear(expirationDate.getFullYear() + 1);

  const reminderDate = new Date(expirationDate);
  reminderDate.setDate(reminderDate.getDate() - 7);

  const newClient = {
    id: testClients.length + 1,
    name,
    phone,
    phone_formatted: phone.startsWith('8') ? '7' + phone.slice(1) : phone,
    insurance: insurance || '',
    amount: amount || 0,
    start_date: startDate.toISOString().split('T')[0],
    expiration_date: expirationDate.toISOString().split('T')[0],
    reminder_date: reminderDate.toISOString().split('T')[0],
    last_reminder_sent: null
  };

  testClients.push(newClient);
  res.status(201).json(newClient);
});

// Удалить клиента
app.delete('/api/clients/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = testClients.findIndex(c => c.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Клиент не найден' });
  }

  const deleted = testClients.splice(index, 1)[0];
  res.json({ message: 'Клиент удален', client: deleted });
});

// Импорт из Excel
app.post('/api/import', (req, res) => {
  res.json({
    message: 'Импорт в демо-режиме недоступен',
    imported: 0,
    errors: 0,
    total: 0
  });
});

// Отправка напоминаний
app.post('/api/send-reminders', (req, res) => {
  const clientsToRemind = testClients.filter(c =>
    !c.last_reminder_sent &&
    new Date(c.reminder_date).toDateString() === new Date().toDateString()
  );

  clientsToRemind.forEach(c => {
    c.last_reminder_sent = new Date().toISOString();
  });

  res.json({
    message: 'Напоминания отправлены (демо-режим)',
    sent: clientsToRemind.length,
    errors: 0,
    total: clientsToRemind.length
  });
});

// Загрузка файла
app.post('/api/upload', (req, res) => {
  res.json({
    message: 'Загрузка файлов в демо-режиме недоступна',
    imported: 0,
    errors: 0,
    total: 0
  });
});

// Статус WhatsApp
app.get('/api/whatsapp/status', (req, res) => {
  res.json({
    ready: false,
    status: 'demo mode - WhatsApp не подключен'
  });
});

app.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                      ║');
  console.log('║                     ДЕМО-РЕЖИМ ВЕБА-ИНТЕРФЕЙСА                      ║');
  console.log('║                                                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('🌐 Веб-интерфейс запущен на:');
  console.log(`   http://localhost:${PORT}`);
  console.log('');
  console.log('📊 Доступные функции:');
  console.log('   ✅ Просмотр клиентов');
  console.log('   ✅ Поиск и фильтрация');
  console.log('   ✅ Добавление клиента');
  console.log('   ✅ Удаление клиента');
  console.log('   ✅ Статистика');
  console.log('');
  console.log('⚠️  Недоступно в демо-режиме:');
  console.log('   ❌ База данных PostgreSQL');
  console.log('   ❌ WhatsApp интеграция');
  console.log('   ❌ Импорт из Excel');
  console.log('   ❌ Загрузка файлов');
  console.log('');
  console.log('💡 Для полной версии запустите:');
  console.log('   docker-compose up -d');
  console.log('');
});
