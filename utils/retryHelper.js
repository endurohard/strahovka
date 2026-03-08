/**
 * Утилита для retry логики с экспоненциальным backoff
 */

const { RETRY } = require('./constants');

/**
 * Выполняет функцию с повторными попытками при ошибке
 *
 * @param {Function} fn - Асинхронная функция для выполнения
 * @param {Object} options - Настройки retry
 * @param {number} options.maxAttempts - Максимальное количество попыток (по умолчанию 3)
 * @param {number} options.delay - Начальная задержка между попытками в мс (по умолчанию 2000)
 * @param {number} options.backoffMultiplier - Множитель для экспоненциального backoff (по умолчанию 2)
 * @param {Function} options.onRetry - Callback, вызываемый перед каждой повторной попыткой
 * @returns {Promise<any>} Результат выполнения функции
 * @throws {Error} Последняя ошибка, если все попытки исчерпаны
 */
async function retry(fn, options = {}) {
  const {
    maxAttempts = RETRY.MAX_ATTEMPTS,
    delay = RETRY.DELAY,
    backoffMultiplier = RETRY.BACKOFF_MULTIPLIER,
    onRetry = null,
  } = options;

  let lastError;
  let currentDelay = delay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts) {
        console.log(`⚠️  Попытка ${attempt}/${maxAttempts} не удалась: ${error.message}`);
        console.log(`   Повтор через ${currentDelay}мс...`);

        if (onRetry) {
          onRetry(error, attempt, currentDelay);
        }

        await sleep(currentDelay);
        currentDelay *= backoffMultiplier;
      }
    }
  }

  console.error(`❌ Все ${maxAttempts} попытки исчерпаны`);
  throw lastError;
}

/**
 * Задержка выполнения
 * @param {number} ms - Миллисекунды
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry для отправки сообщений через WhatsApp с специальной логикой
 * @param {Function} sendFn - Функция отправки сообщения
 * @param {string} phone - Номер телефона
 * @param {string} message - Сообщение
 * @returns {Promise<boolean>} true если отправка успешна
 */
async function retryWhatsAppSend(sendFn, phone, message) {
  return await retry(
    async () => {
      return await sendFn(phone, message);
    },
    {
      maxAttempts: 3,
      delay: 3000,
      backoffMultiplier: 2,
      onRetry: (error, attempt, delay) => {
        console.log(`   📱 Повторная попытка отправки на ${phone} через ${delay}мс...`);
      },
    }
  );
}

module.exports = {
  retry,
  sleep,
  retryWhatsAppSend,
};
