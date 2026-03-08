/**
 * Утилиты для форматирования номеров телефонов
 */

/**
 * Форматирует номер телефона в единый формат +7XXXXXXXXXX
 *
 * Поддерживаемые форматы:
 * - 8XXXXXXXXXX → +7XXXXXXXXXX
 * - 7XXXXXXXXXX → +7XXXXXXXXXX
 * - 9XXXXXXXXX → +79XXXXXXXXX
 * - +7XXXXXXXXXX → +7XXXXXXXXXX (без изменений)
 *
 * @param {string|number} phone - Номер телефона в любом формате
 * @returns {string} Отформатированный номер или пустая строка
 */
function formatPhoneNumber(phone) {
  if (!phone) return '';

  // Преобразуем в строку и убираем все нечисловые символы кроме +
  let phoneStr = String(phone).replace(/[^\d+]/g, '');

  // Убираем + для обработки
  const cleanPhone = phoneStr.replace(/\+/g, '');

  // 10 цифр начиная с 9 → добавляем +7
  if (cleanPhone.length === 10 && cleanPhone.startsWith('9')) {
    return '+7' + cleanPhone;
  }

  // 11 цифр начиная с 8 → заменяем 8 на +7
  if (cleanPhone.length === 11 && cleanPhone.startsWith('8')) {
    return '+7' + cleanPhone.substring(1);
  }

  // 11 цифр начиная с 7 → добавляем +
  if (cleanPhone.length === 11 && cleanPhone.startsWith('7')) {
    return '+' + cleanPhone;
  }

  // Если уже в формате +7XXXXXXXXXX
  if (phoneStr.startsWith('+7') && cleanPhone.length === 11) {
    return phoneStr;
  }

  // Если формат не распознан, возвращаем как есть (с удаленными нечисловыми символами)
  return cleanPhone;
}

/**
 * Проверяет, является ли номер телефона валидным
 * @param {string} phone - Номер телефона
 * @returns {boolean} true если номер валиден
 */
function isValidPhoneNumber(phone) {
  if (!phone) return false;

  const formatted = formatPhoneNumber(phone);

  // Проверяем формат +7XXXXXXXXXX (12 символов)
  const regex = /^\+7\d{10}$/;
  return regex.test(formatted);
}

module.exports = {
  formatPhoneNumber,
  isValidPhoneNumber,
};
