'use strict';

// Мокаем xlsx до импорта excelReader
jest.mock('xlsx', () => ({
  readFile: jest.fn(),
  utils: {
    sheet_to_json: jest.fn(),
  },
}));

const XLSX = require('xlsx');
const {
  readClientsFromExcel,
  getClientsForReminder,
  excelSerialToDate,
  formatPhoneNumber,
} = require('../../excelReader');

// ─── excelSerialToDate ─────────────────────────────────────────────────────────

describe('excelSerialToDate', () => {
  it('серийный номер 1 соответствует 1899-12-31', () => {
    const date = excelSerialToDate(1);
    expect(date.getFullYear()).toBe(1899);
    expect(date.getMonth()).toBe(11); // декабрь = 11
    expect(date.getDate()).toBe(31);
  });

  it('серийный номер 45000 соответствует 2023-03-14 (или +-1 день в зависимости от TZ)', () => {
    const date = excelSerialToDate(45000);
    // Используем локальную дату чтобы не зависеть от часового пояса
    const y = date.getFullYear();
    const m = date.getMonth(); // 0-based
    expect(y).toBe(2023);
    expect(m).toBe(2); // March = 2
  });

  it('серийный номер 44927 соответствует 2022-12-31', () => {
    const date = excelSerialToDate(44927);
    const iso = date.toISOString().slice(0, 10);
    expect(iso).toBe('2022-12-31');
  });

  it('возвращает объект типа Date', () => {
    expect(excelSerialToDate(45000)).toBeInstanceOf(Date);
  });
});

// ─── formatPhoneNumber ─────────────────────────────────────────────────────────

describe('formatPhoneNumber', () => {
  it('10-значный номер: добавляет префикс 7', () => {
    expect(formatPhoneNumber('9001112233')).toBe('79001112233');
  });

  it('11-значный номер начинающийся с 8: заменяет 8 на 7', () => {
    expect(formatPhoneNumber('89001112233')).toBe('79001112233');
  });

  it('уже корректный номер с 7 не изменяется', () => {
    expect(formatPhoneNumber('79001112233')).toBe('79001112233');
  });

  it('форматирует числовое значение (из Excel)', () => {
    expect(formatPhoneNumber(9001112233)).toBe('79001112233');
  });

  it('пустая строка возвращает пустую строку', () => {
    expect(formatPhoneNumber('')).toBe('');
  });

  it('null возвращает пустую строку', () => {
    expect(formatPhoneNumber(null)).toBe('');
  });

  it('undefined возвращает пустую строку', () => {
    expect(formatPhoneNumber(undefined)).toBe('');
  });

  it('номер с нецифровыми символами очищается перед обработкой', () => {
    expect(formatPhoneNumber('+7(900)111-22-33')).toBe('79001112233');
  });
});

// ─── readClientsFromExcel ──────────────────────────────────────────────────────

describe('readClientsFromExcel', () => {
  // Вспомогательная функция для настройки мока XLSX
  function mockXlsx(rows) {
    const worksheet = {};
    XLSX.readFile.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: worksheet },
    });
    XLSX.utils.sheet_to_json.mockReturnValue(rows);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('пропускает строки где cols 1, 2, 3 все пустые', () => {
    mockXlsx([
      ['', '', '', '', '', '', '', '', ''],  // пустая строка — пропускается
      [1, 45000, 'Иван', '79001112233', 'ОСАГО', 'ТО', 5000, 2000, 500],
    ]);

    const clients = readClientsFromExcel('test.xlsx');

    expect(clients).toHaveLength(1);
    expect(clients[0].name).toBe('Иван');
  });

  it('корректно парсит поля клиента из строки Excel', () => {
    mockXlsx([
      ['id1', 45000, 'Мария Петрова', '89991234567', 'КАСКО', 'Диагностика', 10000, 4000, 1000],
    ]);

    const [client] = readClientsFromExcel('test.xlsx');

    expect(client.id).toBe('id1');
    expect(client.name).toBe('Мария Петрова');
    expect(client.insurance).toBe('КАСКО');
    expect(client.services).toBe('Диагностика');
    expect(client.amount).toBe(10000);
    expect(client.employeeExpense).toBe(1000);
  });

  it('вычисляет insuranceExpense = amount - grossProfit', () => {
    mockXlsx([
      [1, 45000, 'Тест', '79001112233', 'ОСАГО', '', 8000, 3000, 0],
    ]);

    const [client] = readClientsFromExcel('test.xlsx');

    expect(client.grossProfit).toBe(3000);
    expect(client.insuranceExpense).toBe(5000); // 8000 - 3000
  });

  it('вычисляет даты если date — числовой серийный номер Excel', () => {
    // serial 45000 = 2023-02-10
    mockXlsx([
      [1, 45000, 'Дата-тест', null, '', '', 0, 0, 0],
    ]);

    const [client] = readClientsFromExcel('test.xlsx');

    // issueDate = excelSerialToDate(45000)
    expect(client.issueDate).toBeInstanceOf(Date);

    // dateObject = issueDate + 4 дня
    expect(client.dateObject).toBeInstanceOf(Date);
    const diffDays =
      (client.dateObject.getTime() - client.issueDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(4);

    // expirationDate = dateObject + 1 год - 1 день
    expect(client.expirationDate).toBeInstanceOf(Date);

    // reminderDate = expirationDate - 7 дней
    expect(client.reminderDate).toBeInstanceOf(Date);
    const reminderDiff =
      (client.expirationDate.getTime() - client.reminderDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(reminderDiff).toBe(7);
  });

  it('оставляет даты null если date не является числом', () => {
    mockXlsx([
      [1, 'не-число', 'Без-дат', null, '', '', 0, 0, 0],
    ]);

    const [client] = readClientsFromExcel('test.xlsx');

    expect(client.issueDate).toBeNull();
    expect(client.dateObject).toBeNull();
    expect(client.expirationDate).toBeNull();
    expect(client.reminderDate).toBeNull();
  });

  it('форматирует телефон через formatPhoneNumber', () => {
    mockXlsx([
      [1, 45000, 'Телефон-тест', '89161234567', '', '', 0, 0, 0],
    ]);

    const [client] = readClientsFromExcel('test.xlsx');

    expect(client.phone).toBe('89161234567');
    expect(client.phoneFormatted).toBe('79161234567');
  });

  it('возвращает пустой массив если все строки пустые', () => {
    mockXlsx([
      ['', '', '', ''],
      ['', '', '', ''],
    ]);

    const clients = readClientsFromExcel('test.xlsx');

    expect(clients).toHaveLength(0);
  });

  it('amount и grossProfit равны 0 при некорректных значениях', () => {
    mockXlsx([
      [1, 45000, 'Нули', null, '', '', 'не-число', 'нет', ''],
    ]);

    const [client] = readClientsFromExcel('test.xlsx');

    expect(client.amount).toBe(0);
    expect(client.grossProfit).toBe(0);
    expect(client.insuranceExpense).toBe(0);
  });
});

// ─── getClientsForReminder ────────────────────────────────────────────────────

describe('getClientsForReminder', () => {
  // Создаём дату напоминания равную сегодня (без времени)
  function todayDate() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function daysFromToday(n) {
    const d = todayDate();
    d.setDate(d.getDate() + n);
    return d;
  }

  it('возвращает клиентов у которых reminderDate совпадает с сегодня', () => {
    const clients = [
      { name: 'Сегодня', reminderDate: todayDate() },
      { name: 'Завтра', reminderDate: daysFromToday(1) },
      { name: 'Вчера', reminderDate: daysFromToday(-1) },
    ];

    const result = getClientsForReminder(clients);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Сегодня');
  });

  it('возвращает пустой массив если нет совпадений', () => {
    const clients = [
      { name: 'Завтра', reminderDate: daysFromToday(1) },
      { name: 'Через 7 дней', reminderDate: daysFromToday(7) },
    ];

    const result = getClientsForReminder(clients);

    expect(result).toHaveLength(0);
  });

  it('пропускает клиентов без reminderDate', () => {
    const clients = [
      { name: 'Без даты', reminderDate: null },
      { name: 'Тоже без', reminderDate: undefined },
      { name: 'Сегодня', reminderDate: todayDate() },
    ];

    const result = getClientsForReminder(clients);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Сегодня');
  });

  it('игнорирует время в reminderDate — сравнивает только даты', () => {
    const reminderWithTime = todayDate();
    reminderWithTime.setHours(23, 59, 59, 999);

    const clients = [{ name: 'Сегодня но поздно', reminderDate: reminderWithTime }];

    const result = getClientsForReminder(clients);

    expect(result).toHaveLength(1);
  });
});
