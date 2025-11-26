// Локальный запуск с WhatsApp (без PostgreSQL)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Хранилище клиентов в памяти
let clients = [
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
    last_reminder_sent: null
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

// WhatsApp клиент
let whatsappClient = null;
let whatsappReady = false;

console.log('🔄 Инициализация WhatsApp клиента...');

whatsappClient = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: false,
    args: ['--no-sandbox']
  }
});

whatsappClient.on('qr', (qr) => {
  console.log('\n📱 Отсканируйте QR код в WhatsApp:\n');
  qrcode.generate(qr, { small: true });
  console.log('\nОткройте WhatsApp на телефоне:');
  console.log('1. Нажмите на три точки (меню)');
  console.log('2. Выберите "Связанные устройства"');
  console.log('3. Нажмите "Привязать устройство"');
  console.log('4. Отсканируйте QR код выше\n');
});

whatsappClient.on('authenticated', () => {
  console.log('✅ WhatsApp авторизован!');
});

whatsappClient.on('ready', () => {
  console.log('✅ WhatsApp клиент готов!');
  whatsappReady = true;
});

whatsappClient.on('disconnected', (reason) => {
  console.log('❌ WhatsApp отключен:', reason);
  whatsappReady = false;
});

whatsappClient.initialize();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: 'memory (no PostgreSQL)',
    whatsapp: whatsappReady ? 'connected' : 'connecting...',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/stats', (req, res) => {
  const total = clients.length;
  const sent = clients.filter(c => c.last_reminder_sent).length;
  const pending = clients.filter(c => !c.last_reminder_sent && new Date(c.reminder_date) <= new Date()).length;
  const upcoming = clients.filter(c => !c.last_reminder_sent && new Date(c.reminder_date) > new Date()).length;

  res.json({
    total_clients: total,
    sent_reminders: sent,
    pending_reminders: pending,
    upcoming_reminders: upcoming,
    whatsapp_ready: whatsappReady
  });
});

app.get('/api/clients', (req, res) => {
  const { page = 1, limit = 50, search = '' } = req.query;

  let filtered = clients;
  if (search) {
    filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
    );
  }

  const total = filtered.length;
  const start = (page - 1) * limit;
  const end = start + parseInt(limit);

  res.json({
    clients: filtered.slice(start, end),
    total,
    page: parseInt(page),
    pages: Math.ceil(total / limit)
  });
});

app.get('/api/clients/:id', (req, res) => {
  const client = clients.find(c => c.id === parseInt(req.params.id));
  if (!client) {
    return res.status(404).json({ error: 'Клиент не найден' });
  }
  res.json(client);
});

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
    id: clients.length + 1,
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

  clients.push(newClient);
  res.status(201).json(newClient);
});

app.delete('/api/clients/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = clients.findIndex(c => c.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Клиент не найден' });
  }

  const deleted = clients.splice(index, 1)[0];
  res.json({ message: 'Клиент удален', client: deleted });
});

app.post('/api/send-reminders', async (req, res) => {
  if (!whatsappReady) {
    return res.status(503).json({ error: 'WhatsApp не готов' });
  }

  const clientsToRemind = clients.filter(c =>
    !c.last_reminder_sent &&
    new Date(c.reminder_date).toDateString() === new Date().toDateString()
  );

  let sent = 0;
  let errors = 0;

  for (const client of clientsToRemind) {
    try {
      const message = `Здравствуйте, ${client.name}!

Напоминаем, что срок действия вашей страховки (${client.insurance}) истекает ${new Date(client.expiration_date).toLocaleDateString('ru-RU')}.

Для продления страховки, пожалуйста, свяжитесь с нами.

Спасибо, что выбираете наши услуги!`;

      const chatId = `${client.phone_formatted}@c.us`;
      await whatsappClient.sendMessage(chatId, message);

      client.last_reminder_sent = new Date().toISOString();
      sent++;

      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (error) {
      console.error(`Ошибка отправки для ${client.name}:`, error.message);
      errors++;
    }
  }

  res.json({
    message: 'Напоминания отправлены',
    sent,
    errors,
    total: clientsToRemind.length
  });
});

app.post('/api/send-test', async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ error: 'Требуются: phone, message' });
  }

  if (!whatsappReady) {
    return res.status(503).json({ error: 'WhatsApp не готов' });
  }

  try {
    const chatId = `${phone}@c.us`;
    await whatsappClient.sendMessage(chatId, message);
    res.json({ message: 'Сообщение отправлено' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/whatsapp/status', (req, res) => {
  res.json({
    ready: whatsappReady,
    status: whatsappReady ? 'connected' : 'connecting'
  });
});

app.post('/api/import', (req, res) => {
  res.json({
    message: 'Импорт из Excel в локальном режиме недоступен',
    imported: 0,
    errors: 0
  });
});

app.post('/api/upload', (req, res) => {
  res.json({
    message: 'Загрузка файлов в локальном режиме недоступна',
    imported: 0,
    errors: 0
  });
});

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                      ║');
  console.log('║                  ЛОКАЛЬНЫЙ РЕЖИМ С WHATSAPP                          ║');
  console.log('║                                                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
  console.log('🌐 Веб-интерфейс: http://localhost:3000');
  console.log('📱 WhatsApp: ' + (whatsappReady ? '✅ Готов' : '⏳ Подключение...'));
  console.log('\n📊 Доступные функции:');
  console.log('   ✅ Просмотр клиентов');
  console.log('   ✅ Добавление/удаление клиентов');
  console.log('   ✅ Отправка через WhatsApp');
  console.log('   ⚠️  Нет PostgreSQL (данные в памяти)');
  console.log('   ⚠️  Нет импорта из Excel\n');
});
