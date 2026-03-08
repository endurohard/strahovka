/**
 * Константы приложения
 */

module.exports = {
  // Задержки (в миллисекундах)
  DELAYS: {
    BETWEEN_MESSAGES: 3000,           // Задержка между отправкой сообщений
    AUTH_CHECK_INTERVAL: 5000,        // Интервал проверки авторизации WhatsApp
    WHATSAPP_PAGE_LOAD: 5000,        // Ожидание загрузки страницы WhatsApp
    AFTER_MESSAGE_SEND: 2000,        // Ожидание после отправки сообщения
    BEFORE_BROWSER_RESTART: 2000,    // Задержка перед перезапуском браузера
  },

  // Настройки напоминаний
  REMINDER: {
    DAYS_BEFORE_EXPIRATION: 5,       // За сколько дней до окончания начинать напоминания
    DAYS_BEFORE_FIRST_REMINDER: 7,   // За сколько дней первое напоминание (legacy)
  },

  // Пагинация
  PAGINATION: {
    DEFAULT_LIMIT: 50,
    MAX_LIMIT: 100,
  },

  // Статусы
  STATUS: {
    PENDING: 'pending',
    SENT: 'sent',
    FAILED: 'failed',
  },

  // Роли пользователей
  ROLES: {
    ADMIN: 'admin',
    USER: 'user',
  },

  // Таймауты (в миллисекундах)
  TIMEOUTS: {
    WHATSAPP_PAGE: 60000,            // 60 секунд для загрузки WhatsApp
    SCREENSHOT: 5000,                // 5 секунд для скриншота
    BROWSER_CLOSE: 3000,             // 3 секунды на закрытие браузера
    LOGOUT: 15000,                   // 15 секунд на logout
    EVALUATE: 10000,                 // 10 секунд на evaluate
  },

  // Retry настройки
  RETRY: {
    MAX_ATTEMPTS: 3,                 // Максимальное количество попыток
    DELAY: 2000,                     // Задержка между попытками
    BACKOFF_MULTIPLIER: 2,           // Множитель для экспоненциального backoff
  },

  // Категории расходов
  EXPENSE_CATEGORIES: {
    SALARY: 'salary',
    OFFICE: 'office',
    MARKETING: 'marketing',
    OTHER: 'other',
  },

  // Bcrypt
  BCRYPT: {
    SALT_ROUNDS: 10,
  },
};
