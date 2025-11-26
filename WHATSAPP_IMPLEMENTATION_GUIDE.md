# 📱 Руководство по реализации WhatsApp Web

## Оглавление
1. [Два подхода к интеграции](#два-подхода-к-интеграции)
2. [Почему чистый Puppeteer?](#почему-чистый-puppeteer)
3. [Критичная конфигурация Puppeteer](#критичная-конфигурация-puppeteer)
4. [Полная реализация](#полная-реализация)
5. [Поток авторизации](#поток-авторизации)
6. [Отправка сообщений](#отправка-сообщений)
7. [Проблемы и решения](#проблемы-и-решения)

---

## Два подхода к интеграции

### Подход 1: whatsapp-web.js (НЕ рекомендуется)

```javascript
const { Client, LocalAuth } = require('whatsapp-web.js');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: false,
    args: ['--no-sandbox']
  }
});
```

**Проблемы:**
- ❌ Puppeteer не находит Chrome автоматически
- ❌ Требует установки Chromium отдельно
- ❌ Сложно отлаживать при ошибках
- ❌ Меньше контроля над процессом

### Подход 2: Чистый Puppeteer ✅ (рекомендуется)

Обнаружен в проекте `/home/it/pack` - работает стабильно.

```javascript
const puppeteer = require('puppeteer');

this.browser = await puppeteer.launch({
  headless: false, // КРИТИЧНО!
  userDataDir: this.sessionDir,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled'
  ]
});
```

**Преимущества:**
- ✅ Полный контроль над браузером
- ✅ Стабильная работа
- ✅ Легко отлаживать
- ✅ Сохранение сессии через userDataDir

---

## Почему чистый Puppeteer?

На основе анализа проекта `pack` (/home/it/pack/src/whatsappManager.js):

1. **Стабильность**: Работает без сбоев, не требует дополнительной установки Chrome
2. **Контроль**: Прямой доступ к странице и DOM-элементам WhatsApp Web
3. **Сессии**: Простое сохранение через `userDataDir`
4. **Отладка**: Видимый браузер (headless: false) упрощает диагностику
5. **Проверенность**: Используется в production на проекте pack

---

## Критичная конфигурация Puppeteer

### ⚠️ ОБЯЗАТЕЛЬНЫЕ настройки

```javascript
const config = {
  // 1. КРИТИЧНО: headless ДОЛЖЕН быть false
  // WhatsApp Web не работает в headless режиме
  headless: false,

  // 2. КРИТИЧНО: userDataDir для сохранения сессии
  // Без этого нужно сканировать QR при каждом запуске
  userDataDir: path.join(__dirname, 'whatsapp-session'),

  // 3. КРИТИЧНО: args для обхода защит WhatsApp
  args: [
    '--no-sandbox',                              // Отключение sandbox (для Docker)
    '--disable-setuid-sandbox',                  // Дополнительная безопасность
    '--disable-dev-shm-usage',                   // Использование /tmp вместо /dev/shm
    '--disable-accelerated-2d-canvas',           // Отключение GPU ускорения
    '--no-first-run',                            // Без первого запуска
    '--no-zygote',                               // Без zygote процесса
    '--disable-gpu',                             // Отключение GPU
    '--disable-blink-features=AutomationControlled' // Скрываем автоматизацию
  ]
};

this.browser = await puppeteer.launch(config);
```

### Почему эти параметры?

| Параметр | Назначение |
|----------|-----------|
| `headless: false` | WhatsApp блокирует headless браузеры |
| `userDataDir` | Сохраняет cookies/локальное хранилище |
| `--no-sandbox` | Нужен для Docker, иначе не запустится |
| `--disable-setuid-sandbox` | Безопасность в контейнерах |
| `--disable-dev-shm-usage` | Избегаем проблем с памятью в Docker |
| `--disable-blink-features=AutomationControlled` | Скрываем от WhatsApp что это автоматизация |

---

## Полная реализация

### Структура класса

```javascript
class WhatsAppService {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isReady = false;
    this.sessionDir = path.join(__dirname, 'whatsapp-session');

    // Создаем директорию для сессии
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  async initialize() { /* ... */ }
  async waitForAuth() { /* ... */ }
  async sendMessage(phone, message) { /* ... */ }
  async destroy() { /* ... */ }
}
```

### Инициализация браузера

```javascript
async initialize() {
  try {
    console.log('🚀 Запуск браузера для WhatsApp Web...');

    this.browser = await puppeteer.launch({
      headless: false,
      userDataDir: this.sessionDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    this.page = await this.browser.newPage();

    // User Agent для имитации обычного браузера
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log('🌐 Открытие WhatsApp Web...');
    await this.page.goto('https://web.whatsapp.com', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await this.waitForAuth();

    console.log('✅ WhatsApp Web готов!');
    this.isReady = true;

  } catch (error) {
    console.error('❌ Ошибка инициализации WhatsApp:', error.message);
    throw error;
  }
}
```

---

## Поток авторизации

### Проверка сохраненной сессии

```javascript
async waitForAuth() {
  try {
    console.log('📱 Проверка авторизации...');

    // Даем время на загрузку
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Проверяем, авторизованы ли мы
    const isAuthenticated = await this.page.evaluate(() => {
      // Ищем элементы интерфейса чатов
      const hasChats = document.querySelector('[role="grid"]') !== null ||
                      document.querySelector('[data-testid="chat-list"]') !== null ||
                      document.querySelector('#pane-side') !== null;
      return hasChats;
    });

    if (isAuthenticated) {
      console.log('✅ Сессия сохранена, авторизация не требуется');
      this.isReady = true;
      return;
    }

    // Если нет - нужен QR код
    await this.waitForQRScan();

  } catch (error) {
    throw error;
  }
}
```

### Ожидание QR кода

```javascript
async waitForQRScan() {
  console.log('📱 Требуется сканирование QR-кода...');
  console.log('⏳ Откройте WhatsApp на телефоне и отсканируйте QR-код в браузере');
  console.log('   1. Откройте WhatsApp на телефоне');
  console.log('   2. Нажмите три точки → "Связанные устройства"');
  console.log('   3. Нажмите "Привязать устройство"');
  console.log('   4. Отсканируйте QR-код\n');

  // Ждем появления интерфейса WhatsApp (до 5 минут)
  await this.page.waitForFunction(() => {
    const hasChats = document.querySelector('[role="grid"]') !== null ||
                    document.querySelector('[data-testid="chat-list"]') !== null ||
                    document.querySelector('#pane-side') !== null;
    return hasChats;
  }, {
    timeout: 300000 // 5 минут на сканирование
  });

  console.log('✅ Авторизация успешна!');

  // Даем время загрузиться чатам
  await new Promise(resolve => setTimeout(resolve, 3000));
  this.isReady = true;
}
```

### Селекторы для проверки авторизации

```javascript
// Три способа проверить что пользователь авторизован:

// 1. Grid с чатами
document.querySelector('[role="grid"]')

// 2. Список чатов (новая версия)
document.querySelector('[data-testid="chat-list"]')

// 3. Боковая панель
document.querySelector('#pane-side')

// Если хотя бы один найден - авторизованы
```

---

## Отправка сообщений

### Метод через URL (рекомендуется)

```javascript
async sendMessage(phone, message) {
  if (!this.isReady) {
    throw new Error('WhatsApp Web не инициализирован');
  }

  try {
    // 1. Нормализуем номер
    let cleanPhone = phone.replace(/[^0-9]/g, '');

    // Преобразуем 8 в 7 (российские номера)
    if (cleanPhone.startsWith('8')) {
      cleanPhone = '7' + cleanPhone.substring(1);
    }

    // Добавляем 7 если нет
    if (!cleanPhone.startsWith('7')) {
      cleanPhone = '7' + cleanPhone;
    }

    // 2. Формируем URL с текстом
    const url = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`;

    console.log(`📤 Открытие чата с номером ${cleanPhone}...`);
    await this.page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // 3. Ждем поле ввода
    await this.page.waitForSelector('[data-testid="conversation-compose-box-input"]', {
      timeout: 10000
    });

    // 4. Нажимаем Enter (сообщение уже в поле)
    await this.page.keyboard.press('Enter');

    console.log(`✅ Сообщение отправлено на ${cleanPhone}`);

    // 5. Задержка перед следующей отправкой
    await new Promise(resolve => setTimeout(resolve, 1000));

    return {
      success: true,
      phone: cleanPhone,
      message: 'Сообщение отправлено'
    };

  } catch (error) {
    console.error(`❌ Ошибка отправки на ${phone}:`, error.message);
    throw error;
  }
}
```

### Почему через URL?

1. **Надежность**: WhatsApp сам заполняет поле ввода
2. **Простота**: Не нужно искать кнопки и поля
3. **Скорость**: Меньше операций с DOM
4. **Стабильность**: Работает даже при изменении интерфейса

### Формат номера телефона

```javascript
// Входные форматы:
'89094843221'        // С 8
'+79094843221'       // С +7
'9094843221'         // Без кода страны
'8 (909) 484-32-21'  // С пробелами и скобками

// Все преобразуются в:
'79094843221' // Только цифры, начинается с 7
```

---

## Проблемы и решения

### Проблема 1: Chrome не найден

```
Error: Could not find Chrome (ver. 120.0.6099.109)
```

**Решение**: Используйте чистый Puppeteer вместо whatsapp-web.js

```javascript
// ❌ НЕ РАБОТАЕТ
const { Client } = require('whatsapp-web.js');

// ✅ РАБОТАЕТ
const puppeteer = require('puppeteer');
const browser = await puppeteer.launch({ headless: false });
```

### Проблема 2: QR код при каждом запуске

**Причина**: Не сохраняется сессия

**Решение**: Используйте `userDataDir`

```javascript
this.browser = await puppeteer.launch({
  userDataDir: path.join(__dirname, 'whatsapp-session') // КРИТИЧНО!
});
```

### Проблема 3: TimeoutError при waitForFunction

```
TimeoutError: Waiting for function failed: timeout 300000ms exceeded
```

**Причина**: Пользователь не отсканировал QR за 5 минут

**Решение**: Увеличьте timeout или повторите попытку

```javascript
await this.page.waitForFunction(() => {
  // ... проверка авторизации
}, {
  timeout: 600000 // 10 минут вместо 5
});
```

### Проблема 4: Браузер закрывается сам

**Причина**: Процесс Node.js завершился

**Решение**: Добавьте обработку сигналов

```javascript
process.on('SIGINT', async () => {
  console.log('Закрытие браузера...');
  if (this.browser) {
    await this.browser.close();
  }
  process.exit(0);
});
```

### Проблема 5: Не находит селекторы

**Причина**: WhatsApp изменил разметку

**Решение**: Используйте несколько альтернативных селекторов

```javascript
// Проверяем ВСЕ возможные селекторы
const hasChats = document.querySelector('[role="grid"]') !== null ||
                document.querySelector('[data-testid="chat-list"]') !== null ||
                document.querySelector('#pane-side') !== null;
```

### Проблема 6: Блокировка от WhatsApp

**Причина**: WhatsApp обнаружил автоматизацию

**Решение**: Используйте все флаги безопасности

```javascript
args: [
  '--disable-blink-features=AutomationControlled', // Скрываем автоматизацию
  // ... другие флаги
]

// + User Agent
await this.page.setUserAgent('Mozilla/5.0 ...');
```

---

## Массовая рассылка

### Правильная реализация

```javascript
async sendReminders(clients) {
  console.log(`\n📨 Начинаю отправку напоминаний для ${clients.length} клиентов...\n`);

  const results = {
    success: 0,
    failed: 0,
    errors: []
  };

  for (const client of clients) {
    try {
      // 1. Проверяем наличие номера
      if (!client.phone_formatted) {
        console.warn(`⚠️  Пропускаю ${client.name}: нет номера телефона`);
        results.failed++;
        continue;
      }

      // 2. Формируем сообщение
      const message = this.createReminderMessage(client);

      // 3. Отправляем
      await this.sendMessage(client.phone_formatted, message);
      results.success++;

      // 4. КРИТИЧНО: Задержка между сообщениями (3-5 секунд)
      await new Promise(resolve => setTimeout(resolve, 3000));

    } catch (error) {
      results.failed++;
      results.errors.push({
        client: client.name,
        error: error.message
      });
    }
  }

  console.log('\n📊 Результаты отправки:');
  console.log(`✅ Успешно: ${results.success}`);
  console.log(`❌ Ошибки: ${results.failed}`);

  return results;
}
```

### Ограничения WhatsApp

| Лимит | Значение |
|-------|----------|
| Сообщений в день | ~1000 |
| Задержка между сообщениями | 3-5 секунд |
| Новых чатов в день | ~50 |
| Длина сообщения | 65536 символов |

**⚠️ Важно**: Превышение лимитов может привести к блокировке аккаунта!

---

## Шаблон сообщения

```javascript
createReminderMessage(client) {
  const expirationDate = new Date(client.expiration_date).toLocaleDateString('ru-RU');

  return `Здравствуйте, ${client.name}!

Напоминаем, что срок действия вашей страховки (${client.insurance}) истекает ${expirationDate}.

Для продления страховки, пожалуйста, свяжитесь с нами.

Спасибо, что выбираете наши услуги!`;
}
```

---

## Интеграция с Docker

### Dockerfile

```dockerfile
FROM node:18

# Установка зависимостей Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends

# Puppeteer будет использовать установленный Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "index.js"]
```

### docker-compose.yml

```yaml
services:
  app:
    build: .
    volumes:
      - whatsapp_session:/app/whatsapp-session  # КРИТИЧНО: Сохранение сессии
    environment:
      - DISPLAY=:99  # Для X11 (если нужно)
    shm_size: '2gb'  # Увеличенная shared memory для браузера

volumes:
  whatsapp_session:  # Persistent volume для сессии
```

---

## Проверка работы

### Тест инициализации

```javascript
const WhatsAppService = require('./whatsappService-puppeteer');

async function test() {
  const whatsapp = new WhatsAppService();

  try {
    await whatsapp.initialize();
    console.log('✅ Инициализация успешна');

    // Ждем 1 минуту
    await new Promise(resolve => setTimeout(resolve, 60000));

    await whatsapp.destroy();
  } catch (error) {
    console.error('❌ Ошибка:', error);
  }
}

test();
```

### Тест отправки

```javascript
async function testSend() {
  const whatsapp = new WhatsAppService();

  await whatsapp.initialize();

  const result = await whatsapp.sendMessage(
    '79094843221',
    'Тестовое сообщение'
  );

  console.log('Результат:', result);

  await whatsapp.destroy();
}

testSend();
```

---

## Мониторинг и логи

```javascript
// Добавьте логирование всех событий браузера
this.page.on('console', msg => {
  console.log('BROWSER LOG:', msg.text());
});

this.page.on('error', error => {
  console.error('PAGE ERROR:', error);
});

this.page.on('pageerror', error => {
  console.error('PAGE EXCEPTION:', error);
});

this.browser.on('disconnected', () => {
  console.warn('⚠️  Браузер отключен');
  this.isReady = false;
});
```

---

## Резюме: Критичные моменты

### ✅ ОБЯЗАТЕЛЬНО

1. `headless: false` - WhatsApp не работает в headless
2. `userDataDir` - иначе QR при каждом запуске
3. `--no-sandbox` - для Docker
4. `--disable-blink-features=AutomationControlled` - скрываем автоматизацию
5. Задержка 3-5 секунд между сообщениями
6. Несколько селекторов для проверки авторизации
7. Нормализация номеров телефонов

### ❌ НЕ ДЕЛАЙТЕ

1. Не используйте headless режим
2. Не отправляйте больше 1000 сообщений в день
3. Не используйте одну сессию на нескольких серверах
4. Не закрывайте браузер между отправками
5. Не превышайте лимиты WhatsApp

---

## Дополнительные ресурсы

- Документация Puppeteer: https://pptr.dev/
- Селекторы WhatsApp Web (могут меняться): https://github.com/pedroslopez/whatsapp-web.js/wiki
- Рабочий пример: `/home/it/pack/src/whatsappManager.js` на сервере 192.168.5.15

---

**Последнее обновление**: 26.11.2025
**Основано на**: Проект pack (/home/it/pack)
**Статус**: Production-ready ✅
