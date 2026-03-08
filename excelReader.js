const XLSX = require('xlsx');

/**
 * Преобразует Excel serial date в JavaScript Date
 * @param {number} serial - Excel serial date number
 * @returns {Date}
 */
function excelSerialToDate(serial) {
  const excelEpoch = new Date(1899, 11, 30);
  const daysOffset = serial;
  const date = new Date(excelEpoch.getTime() + daysOffset * 24 * 60 * 60 * 1000);
  return date;
}

/**
 * Форматирует номер телефона
 * @param {string|number} phone
 * @returns {string}
 */
function formatPhoneNumber(phone) {
  if (!phone) return '';

  // Преобразуем в строку и убираем все нечисловые символы
  let phoneStr = String(phone).replace(/\D/g, '');

  // Добавляем код страны если его нет
  if (phoneStr.length === 10) {
    phoneStr = '7' + phoneStr;
  } else if (phoneStr.startsWith('8') && phoneStr.length === 11) {
    phoneStr = '7' + phoneStr.slice(1);
  }

  return phoneStr;
}

/**
 * Читает данные клиентов из Excel файла
 * @param {string} filePath - путь к файлу Excel
 * @returns {Array} массив объектов с данными клиентов
 */
function readClientsFromExcel(filePath) {
  try {
    console.log(`📖 Чтение файла: ${filePath}`);

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Преобразование в массив массивов
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    // В файле нет строк-заголовков — данные начинаются с row[0]
    const clients = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      // Пропускаем пустые строки
      if (!row[1] && !row[2] && !row[3]) continue;

      const amount = parseFloat(row[6]) || 0;
      const grossProfit = parseFloat(row[7]) || 0; // в.п. — комиссия агентства

      const client = {
        id: row[0] || i - 1, // номер по порядку
        date: row[1], // дата в формате Excel serial
        dateObject: null,
        name: row[2] || '',
        phone: row[3] || null,
        phoneFormatted: formatPhoneNumber(row[3]) || null,
        insurance: row[4] || '',
        services: row[5] || '',
        amount: amount,
        grossProfit: grossProfit,
        insuranceExpense: amount - grossProfit, // что уходит страховой компании
        employeeExpense: parseFloat(row[8]) || 0, // расход на сотрудника
        expirationDate: null, // дата окончания страховки (через год)
        reminderDate: null // дата напоминания (за неделю до окончания)
      };

      // Преобразуем дату из Excel serial в обычную дату
      if (typeof client.date === 'number') {
        client.dateObject = excelSerialToDate(client.date);

        // Вычисляем дату окончания страховки (через год)
        client.expirationDate = new Date(client.dateObject);
        client.expirationDate.setFullYear(client.expirationDate.getFullYear() + 1);

        // Вычисляем дату напоминания (за 14 дней до окончания)
        client.reminderDate = new Date(client.expirationDate);
        client.reminderDate.setDate(client.reminderDate.getDate() - 14);
      }

      clients.push(client);
    }

    console.log(`✅ Прочитано клиентов: ${clients.length}`);
    return clients;

  } catch (error) {
    console.error('❌ Ошибка при чтении Excel файла:', error.message);
    throw error;
  }
}

/**
 * Получает клиентов, которым нужно отправить напоминание сегодня
 * @param {Array} clients - массив всех клиентов
 * @returns {Array} клиенты для напоминания
 */
function getClientsForReminder(clients) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const clientsToRemind = clients.filter(client => {
    if (!client.reminderDate) return false;

    const reminderDate = new Date(client.reminderDate);
    reminderDate.setHours(0, 0, 0, 0);

    return reminderDate.getTime() === today.getTime();
  });

  return clientsToRemind;
}

module.exports = {
  readClientsFromExcel,
  getClientsForReminder,
  excelSerialToDate,
  formatPhoneNumber
};
