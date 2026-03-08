# Rate Limiting - Документация

## 📋 Обзор

Система rate limiting защищает API от злоупотребления и DDoS-атак, ограничивая количество запросов от одного IP адреса в определенный период времени.

## 🔧 Реализация

### Архитектура

Создан собственный in-memory rate limiter (`utils/rateLimiter.js`) без внешних зависимостей:
- Хранение запросов в Map (IP → массив запросов)
- Sliding window алгоритм
- Автоматическая очистка устаревших записей каждые 5 минут

### Три типа лимитеров

#### 1. Auth Limiter (строгий)
**Использование:** Авторизация, смена паролей, смена учетных данных

```javascript
{
  windowMs: 15 * 60 * 1000,  // 15 минут
  max: 5,                     // 5 попыток
  skipSuccessfulRequests: true // Не учитываем успешные попытки
}
```

**Применяется к:**
- `POST /api/login`
- `POST /api/admin/change-credentials`
- `POST /api/users/change-password`

#### 2. API Limiter (средний)
**Использование:** Обычные API операции

```javascript
{
  windowMs: 15 * 60 * 1000,  // 15 минут
  max: 100                    // 100 запросов
}
```

**Применяется к:**
- `GET /api/clients`
- `PUT /api/clients/:id`
- `DELETE /api/clients/:id`
- `GET /api/stats`
- `GET /api/users`
- И другим операциям чтения/изменения

#### 3. Strict Limiter (жесткий)
**Использование:** Создание ресурсов, загрузка файлов, импорт

```javascript
{
  windowMs: 60 * 60 * 1000,  // 1 час
  max: 10                     // 10 запросов
}
```

**Применяется к:**
- `POST /api/clients` (создание клиента)
- `POST /api/users` (создание пользователя)
- `POST /api/employees` (создание сотрудника)
- `POST /api/expenses` (создание расхода)
- `POST /api/upload` (загрузка файлов)
- `POST /api/import` (импорт из Excel)

## 📊 HTTP Заголовки

Каждый ответ включает информацию о лимитах:

```http
X-RateLimit-Limit: 100           # Максимальное количество запросов
X-RateLimit-Remaining: 87        # Оставшиеся запросы
X-RateLimit-Reset: 2026-02-23... # Время сброса окна
```

При превышении лимита:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 120                 # Секунд до повторной попытки

{
  "error": "Слишком много запросов, попробуйте позже",
  "retryAfter": "120 секунд"
}
```

## 🛠️ API для управления

### Получить статистику

```javascript
const stats = rateLimiter.getStats();
// {
//   totalIPs: 15,
//   windowMs: 900000,
//   maxRequests: 100,
//   activeRequests: 234
// }
```

### Сбросить лимит для IP

```javascript
rateLimiter.resetIp('192.168.1.1');
```

### Сбросить все лимиты

```javascript
rateLimiter.resetAll();
```

## 🧪 Тестирование

Созданы unit тесты: `tests/unit/rateLimiter.test.js`

**Покрытие:**
- Настройки по умолчанию и кастомные
- Извлечение IP из разных заголовков
- Пропуск запросов в пределах лимита
- Блокировка после превышения
- Разделение по IP адресам
- Статистика
- Сброс лимитов

**Запуск тестов:**
```bash
npm test -- rateLimiter.test.js
```

## 📝 Примеры использования

### Создание кастомного лимитера

```javascript
const { createRateLimiter } = require('./utils/rateLimiter');

const customLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,  // 5 минут
  max: 20,                   // 20 запросов
  message: 'Кастомное сообщение',
  statusCode: 503,
  skipSuccessfulRequests: false,
  skipFailedRequests: false
});

// Применение к маршруту
app.post('/api/custom',
  customLimiter.middleware(),
  requireAuth,
  handler
);
```

### Проверка состояния в runtime

```javascript
// В API endpoint
app.get('/api/admin/rate-limit-stats', requireAuth, (req, res) => {
  const authStats = this.authLimiter.getStats();
  const apiStats = this.apiLimiter.getStats();
  const strictStats = this.strictLimiter.getStats();

  res.json({
    auth: authStats,
    api: apiStats,
    strict: strictStats
  });
});
```

## 🔒 Безопасность

### Защита от обхода

1. **IP Detection**: Проверяет несколько источников IP
   - `req.ip`
   - `x-forwarded-for` (первый IP из списка)
   - `x-real-ip`
   - `req.connection.remoteAddress`

2. **В продакшене за reverse proxy:**
   - Убедитесь что Nginx/Apache правильно устанавливает `X-Forwarded-For`
   - Рассмотрите использование `express.set('trust proxy', 1)`

### Рекомендации

1. **Мониторинг**: Логируйте блокировки для анализа атак
```javascript
if (validRequests.length >= this.maxRequests) {
  console.warn(`[RateLimiter] IP ${ip} заблокирован (${validRequests.length}/${this.maxRequests})`);
}
```

2. **Whitelist**: Добавьте исключения для внутренних сервисов
```javascript
middleware() {
  return (req, res, next) => {
    const ip = this.getClientIp(req);

    // Whitelist
    if (['127.0.0.1', '::1', '10.0.0.0'].includes(ip)) {
      return next();
    }

    // ... остальная логика
  };
}
```

3. **Persistent Storage**: Для кластерных установок используйте Redis
```javascript
// Будущая реализация с Redis
const redis = require('redis');
const client = redis.createClient();

// Хранение в Redis вместо Map
```

## 🚀 Production Конфигурация

### Переменные окружения

Можно добавить в `.env`:

```env
# Rate Limiting
RATE_LIMIT_AUTH_MAX=5
RATE_LIMIT_AUTH_WINDOW=900000    # 15 минут

RATE_LIMIT_API_MAX=100
RATE_LIMIT_API_WINDOW=900000

RATE_LIMIT_STRICT_MAX=10
RATE_LIMIT_STRICT_WINDOW=3600000  # 1 час
```

### Динамическая настройка

```javascript
constructor(db, whatsapp) {
  // ...

  this.authLimiter = createRateLimiter({
    windowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 5,
    message: 'Слишком много попыток входа',
    skipSuccessfulRequests: true
  });

  // ... аналогично для других
}
```

## 📈 Мониторинг

### Prometheus Metrics (будущее улучшение)

```javascript
const promClient = require('prom-client');

const rateLimitCounter = new promClient.Counter({
  name: 'rate_limit_blocks_total',
  help: 'Total number of rate limit blocks',
  labelNames: ['ip', 'endpoint']
});

// В middleware при блокировке
rateLimitCounter.inc({ ip, endpoint: req.path });
```

### Простой лог

```javascript
// В cleanup()
console.log(`[RateLimiter] Статистика:
  - Всего IP: ${this.requests.size}
  - Активных запросов: ${activeCount}
  - Очищено: ${cleaned}
`);
```

## 🐛 Troubleshooting

### Проблема: Легитимные пользователи блокируются

**Причина:** Слишком строгие лимиты или shared IP (офис, NAT)

**Решение:**
```javascript
// Увеличить лимиты
max: 200  // вместо 100

// Или уменьшить окно
windowMs: 5 * 60 * 1000  // 5 минут вместо 15
```

### Проблема: Memory leak при большом количестве IP

**Причина:** Накопление записей

**Решение:**
- Уменьшить `windowMs`
- Сократить интервал `cleanup`
- Перейти на Redis для хранения

### Проблема: Rate limiting не работает за load balancer

**Причина:** IP определяется неправильно

**Решение:**
```javascript
// В index.js или api.js
app.set('trust proxy', 1);
```

## 📚 Ссылки

- [OWASP Rate Limiting](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html)
- [RFC 6585 - 429 Status Code](https://tools.ietf.org/html/rfc6585#section-4)
- [Express Rate Limit Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)

---

**Автор:** Claude Code (Anthropic)
**Дата:** 2026-02-23
**Версия:** 1.0.0
