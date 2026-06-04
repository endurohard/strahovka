'use strict';

// Мокаем pg до импорта Database, чтобы конструктор Pool перехватился
jest.mock('pg', () => {
  const mockQuery = jest.fn();
  const mockEnd = jest.fn();
  const MockPool = jest.fn(() => ({ query: mockQuery, end: mockEnd }));
  return { Pool: MockPool, _mockQuery: mockQuery, _mockEnd: mockEnd };
});

const pg = require('pg');
const Database = require('../../database');

// Вспомогательная функция: возвращает свежие моки из pg после каждого reset
function getMocks() {
  return {
    mockQuery: pg._mockQuery,
    mockEnd: pg._mockEnd,
    MockPool: pg.Pool,
  };
}

describe('Database', () => {
  let db;
  let mockQuery;
  let mockEnd;
  let MockPool;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ mockQuery, mockEnd, MockPool } = getMocks());
    db = new Database();
  });

  // ─── constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('создаёт Pool с параметрами из переменных окружения', () => {
      process.env.DB_HOST = 'testhost';
      process.env.DB_PORT = '5433';
      process.env.DB_NAME = 'testdb';
      process.env.DB_USER = 'testuser';
      process.env.DB_PASSWORD = 'testpass';

      new Database();

      const callArgs = MockPool.mock.calls[MockPool.mock.calls.length - 1][0];
      expect(callArgs.host).toBe('testhost');
      expect(callArgs.port).toBe('5433');
      expect(callArgs.database).toBe('testdb');
      expect(callArgs.user).toBe('testuser');
      expect(callArgs.password).toBe('testpass');

      delete process.env.DB_HOST;
      delete process.env.DB_PORT;
      delete process.env.DB_NAME;
      delete process.env.DB_USER;
      delete process.env.DB_PASSWORD;
    });

    it('использует значения по умолчанию когда переменные окружения не заданы', () => {
      delete process.env.DB_HOST;
      delete process.env.DB_PORT;
      delete process.env.DB_NAME;
      delete process.env.DB_USER;
      delete process.env.DB_PASSWORD;

      new Database();

      const callArgs = MockPool.mock.calls[MockPool.mock.calls.length - 1][0];
      expect(callArgs.host).toBe('localhost');
      expect(callArgs.port).toBe(5432);
      expect(callArgs.database).toBe('strahovka');
      expect(callArgs.user).toBe('postgres');
      expect(callArgs.password).toBe('postgres');
    });
  });

  // ─── initialize ─────────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('вызывает pool.query для создания таблиц', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await db.initialize();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      // Запрос должен содержать CREATE TABLE IF NOT EXISTS
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/i);
    });

    it('пробрасывает ошибку если pool.query завершается с ошибкой', async () => {
      const dbError = new Error('connection refused');
      mockQuery.mockRejectedValueOnce(dbError);

      await expect(db.initialize()).rejects.toThrow('connection refused');
    });
  });

  // ─── upsertClient ───────────────────────────────────────────────────────────

  describe('upsertClient', () => {
    const makeClient = (overrides = {}) => ({
      id: 'client-1',
      name: 'Иван Иванов',
      phone: '79001112233',
      phoneFormatted: '+79001112233',
      insurance: 'ОСАГО',
      services: 'ТО',
      amount: 5000,
      insuranceExpense: 3000,
      employeeExpense: 500,
      issueDate: '2024-01-01',
      dateObject: new Date('2024-01-05'),
      expirationDate: new Date('2025-01-04'),
      reminderDate: new Date('2024-12-28'),
      employeeName: 'Зухра',
      ...overrides,
    });

    it('передаёт правильные 14 параметров в pool.query', async () => {
      const client = makeClient();
      mockQuery.mockResolvedValue({ rows: [{ id: 42 }] });

      await db.upsertClient(client);

      const [, values] = mockQuery.mock.calls[0];
      expect(values).toHaveLength(14);
      expect(values[0]).toBe(client.id);
      expect(values[1]).toBe(client.name);
      expect(values[2]).toBe(client.phone);
      expect(values[3]).toBe(client.phoneFormatted);
      expect(values[4]).toBe(client.insurance);
      expect(values[5]).toBe(client.services);
      expect(values[6]).toBe(client.amount);
      expect(values[7]).toBe(client.insuranceExpense);
      expect(values[8]).toBe(client.employeeExpense);
      expect(values[9]).toBe(client.issueDate);
      expect(values[10]).toBe(client.dateObject);
      expect(values[11]).toBe(client.expirationDate);
      expect(values[12]).toBe(client.reminderDate);
      expect(values[13]).toBe(client.employeeName);
    });

    it('подставляет 0 если insuranceExpense/employeeExpense не заданы', async () => {
      const client = makeClient({ insuranceExpense: undefined, employeeExpense: undefined });
      mockQuery.mockResolvedValue({ rows: [{ id: 42 }] });

      await db.upsertClient(client);

      const [, values] = mockQuery.mock.calls[0];
      expect(values[7]).toBe(0);
      expect(values[8]).toBe(0);
    });

    it('подставляет "Зухра" если employeeName не задан', async () => {
      const client = makeClient({ employeeName: undefined });
      mockQuery.mockResolvedValue({ rows: [{ id: 42 }] });

      await db.upsertClient(client);

      const [, values] = mockQuery.mock.calls[0];
      expect(values[13]).toBe('Зухра');
    });

    it('вызывает generateDailyReminders после вставки клиента', async () => {
      const client = makeClient();
      mockQuery.mockResolvedValue({ rows: [{ id: 7 }] });

      const spy = jest.spyOn(db, 'generateDailyReminders').mockResolvedValue();
      await db.upsertClient(client);

      expect(spy).toHaveBeenCalledWith(7, client.dateObject, client.expirationDate);
    });

    it('возвращает id вставленного клиента', async () => {
      const client = makeClient();
      mockQuery.mockResolvedValue({ rows: [{ id: 99 }] });
      jest.spyOn(db, 'generateDailyReminders').mockResolvedValue();

      const result = await db.upsertClient(client);

      expect(result).toBe(99);
    });
  });

  // ─── importClients ──────────────────────────────────────────────────────────

  describe('importClients', () => {
    const validClient = {
      id: '1',
      name: 'Мария',
      phone: null,
      phoneFormatted: null,
      insurance: 'КАСКО',
      services: '',
      amount: 10000,
      insuranceExpense: 0,
      employeeExpense: 0,
      issueDate: '2024-03-01',
      dateObject: new Date('2024-03-05'),
      expirationDate: new Date('2025-03-04'),
      reminderDate: new Date('2025-02-25'),
      employeeName: 'Зухра',
    };

    it('пропускает клиентов без имени', async () => {
      const spy = jest.spyOn(db, 'upsertClient').mockResolvedValue(1);
      const noName = { ...validClient, name: '' };

      const result = await db.importClients([noName, validClient]);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(result.imported).toBe(1);
    });

    it('пропускает клиентов без dateObject', async () => {
      const spy = jest.spyOn(db, 'upsertClient').mockResolvedValue(1);
      const noDate = { ...validClient, dateObject: null };

      const result = await db.importClients([noDate, validClient]);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(result.imported).toBe(1);
    });

    it('считает ошибки при сбое upsertClient', async () => {
      jest
        .spyOn(db, 'upsertClient')
        .mockRejectedValueOnce(new Error('duplicate'))
        .mockResolvedValueOnce(2);

      const result = await db.importClients([validClient, validClient]);

      expect(result.imported).toBe(1);
      expect(result.errors).toBe(1);
    });

    it('возвращает { imported: 0, errors: 0 } для пустого массива', async () => {
      const result = await db.importClients([]);

      expect(result).toEqual({ imported: 0, errors: 0 });
    });
  });

  // ─── getClientsForReminder ───────────────────────────────────────────────────

  describe('getClientsForReminder', () => {
    it('форматирует дату в строку YYYY-MM-DD и передаёт в запрос', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const date = new Date('2024-06-15T12:00:00.000Z');

      await db.getClientsForReminder(date);

      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe('2024-06-15');
    });

    it('возвращает строки из результата запроса', async () => {
      const rows = [{ id: 1, name: 'Тест' }];
      mockQuery.mockResolvedValueOnce({ rows });

      const result = await db.getClientsForReminder(new Date());

      expect(result).toEqual(rows);
    });
  });

  // ─── markReminderSent ────────────────────────────────────────────────────────

  describe('markReminderSent', () => {
    it('вызывает pool.query с id клиента', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await db.markReminderSent(42);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe(42);
    });
  });

  // ─── getAllClients ───────────────────────────────────────────────────────────

  describe('getAllClients', () => {
    it('возвращает все строки отсортированные по дате', async () => {
      const rows = [{ id: 2 }, { id: 1 }];
      mockQuery.mockResolvedValueOnce({ rows });

      const result = await db.getAllClients();

      expect(result).toEqual(rows);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toMatch(/ORDER BY start_date DESC/i);
    });
  });

  // ─── getStats ────────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('возвращает первую строку результата (агрегированную статистику)', async () => {
      const statsRow = {
        total_clients: 10,
        upcoming_reminders: 2,
        pending_reminders: 1,
        sent_reminders: 7,
      };
      mockQuery.mockResolvedValueOnce({ rows: [statsRow] });

      const result = await db.getStats();

      expect(result).toEqual(statsRow);
    });
  });

  // ─── generateDailyReminders ─────────────────────────────────────────────────

  describe('generateDailyReminders', () => {
    it('создаёт напоминание за 7 дней до expirationDate', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const startDate = new Date('2024-01-05');
      const expirationDate = new Date('2025-01-04');

      await db.generateDailyReminders(1, startDate, expirationDate);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      // Проверяем, что в параметрах передан clientId
      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe(1);

      // Дата напоминания = expirationDate - 7 дней
      const expectedReminderDate = new Date(expirationDate);
      expectedReminderDate.setHours(0, 0, 0, 0);
      expectedReminderDate.setDate(expectedReminderDate.getDate() - 7);
      // params содержит [clientId, Date], проверяем что Date объект имеет правильный месяц/дату
      const reminderParam = params[1];
      expect(reminderParam instanceof Date).toBe(true);
      expect(reminderParam.getMonth()).toBe(expectedReminderDate.getMonth());
      expect(reminderParam.getDate()).toBe(expectedReminderDate.getDate());
    });
  });

  // ─── getDailyReminders ──────────────────────────────────────────────────────

  describe('getDailyReminders', () => {
    it('возвращает pending напоминания для заданной даты', async () => {
      const rows = [{ id: 5, client_id: 3 }];
      mockQuery.mockResolvedValueOnce({ rows });

      const result = await db.getDailyReminders(new Date('2024-12-28'));

      expect(result).toEqual(rows);
      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe('2024-12-28');
    });
  });

  // ─── markDailyReminderSent ──────────────────────────────────────────────────

  describe('markDailyReminderSent', () => {
    it('вызывает pool.query с id напоминания', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await db.markDailyReminderSent(55);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe(55);
    });
  });

  // ─── close ──────────────────────────────────────────────────────────────────

  describe('close', () => {
    it('вызывает pool.end', async () => {
      mockEnd.mockResolvedValueOnce();

      await db.close();

      expect(mockEnd).toHaveBeenCalledTimes(1);
    });
  });

  // ─── getEmployees ────────────────────────────────────────────────────────────

  describe('getEmployees', () => {
    it('запрашивает только активных сотрудников, отсортированных по имени', async () => {
      const rows = [{ id: 1, name: 'Зухра', active: true }];
      mockQuery.mockResolvedValueOnce({ rows });

      const result = await db.getEmployees();

      expect(result).toEqual(rows);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toMatch(/active = true/i);
      expect(sql).toMatch(/ORDER BY name/i);
    });
  });

  // ─── createEmployee ──────────────────────────────────────────────────────────

  describe('createEmployee', () => {
    it('передаёт имя и телефон в запрос, возвращает созданную запись', async () => {
      const employee = { id: 10, name: 'Айгуль', phone: '79001234567' };
      mockQuery.mockResolvedValueOnce({ rows: [employee] });

      const result = await db.createEmployee('Айгуль', '79001234567');

      expect(result).toEqual(employee);
      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe('Айгуль');
      expect(params[1]).toBe('79001234567');
    });

    it('допускает создание сотрудника без телефона', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 11, name: 'Лейла', phone: null }] });

      await db.createEmployee('Лейла');

      const [, params] = mockQuery.mock.calls[0];
      expect(params[1]).toBeNull();
    });
  });

  // ─── updateEmployee ──────────────────────────────────────────────────────────

  describe('updateEmployee', () => {
    it('передаёт все поля в нужном порядке и возвращает обновлённую запись', async () => {
      const updated = { id: 5, name: 'Гуля', phone: '79997776655', active: true };
      mockQuery.mockResolvedValueOnce({ rows: [updated] });

      const result = await db.updateEmployee(5, 'Гуля', '79997776655', true);

      expect(result).toEqual(updated);
      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe('Гуля');
      expect(params[1]).toBe('79997776655');
      expect(params[2]).toBe(true);
      expect(params[3]).toBe(5);
    });
  });

  // ─── deleteEmployee ──────────────────────────────────────────────────────────

  describe('deleteEmployee', () => {
    it('мягко удаляет сотрудника (устанавливает active = false)', async () => {
      const deactivated = { id: 3, name: 'Тест', active: false };
      mockQuery.mockResolvedValueOnce({ rows: [deactivated] });

      const result = await db.deleteEmployee(3);

      expect(result).toEqual(deactivated);
      expect(result.active).toBe(false);
      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe(3);
    });
  });

  // ─── getExpenses ─────────────────────────────────────────────────────────────

  describe('getExpenses', () => {
    it('передаёт startDate и endDate в запрос', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await db.getExpenses('2024-01-01', '2024-12-31');

      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe('2024-01-01');
      expect(params[1]).toBe('2024-12-31');
    });
  });

  // ─── createExpense ───────────────────────────────────────────────────────────

  describe('createExpense', () => {
    it('вставляет расход и возвращает созданную запись', async () => {
      const expense = { id: 1, category: 'аренда', amount: 30000 };
      mockQuery.mockResolvedValueOnce({ rows: [expense] });

      const result = await db.createExpense('2024-06-01', 'аренда', 'Офис', 30000);

      expect(result).toEqual(expense);
      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe('2024-06-01');
      expect(params[1]).toBe('аренда');
      expect(params[2]).toBe('Офис');
      expect(params[3]).toBe(30000);
    });
  });

  // ─── deleteExpense ───────────────────────────────────────────────────────────

  describe('deleteExpense', () => {
    it('удаляет расход по id и возвращает удалённую запись', async () => {
      const deleted = { id: 7 };
      mockQuery.mockResolvedValueOnce({ rows: [deleted] });

      const result = await db.deleteExpense(7);

      expect(result).toEqual(deleted);
      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe(7);
    });
  });

  // ─── getAnalytics ────────────────────────────────────────────────────────────

  describe('getAnalytics', () => {
    it('выполняет несколько запросов и возвращает структуру с расчётными полями', async () => {
      // getAnalytics выполняет 5 запросов в порядке:
      // 1. incomeQuery (total_income, total_insurance_expenses, total_employee_expenses, total_policies)
      // 2. byEmployeeQuery
      // 3. expensesQuery (by category)
      // 4. salaryQuery (total)
      // 5. otherExpensesQuery (total)
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total_income: '100000', total_insurance_expenses: '60000', total_employee_expenses: '10000', total_policies: '20' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, employee_name: 'Зухра', policies_count: 5, total_income: '50000', total_expense: '5000', profit: '10000' }] })
        .mockResolvedValueOnce({ rows: [{ category: 'office', total: '3000' }] })
        .mockResolvedValueOnce({ rows: [{ total: '5000' }] })
        .mockResolvedValueOnce({ rows: [{ total: '3000' }] });

      const result = await db.getAnalytics('2024-01-01', '2024-12-31');

      expect(result).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.summary.totalIncome).toBe(100000);
      expect(result.summary.grossProfit).toBe(40000); // 100000 - 60000
      expect(result.summary.netProfit).toBe(22000); // 40000 - 10000 - 5000 - 3000
      expect(result.byEmployee).toHaveLength(1);
      expect(result.expensesByCategory).toHaveLength(1);
    });

    it('передаёт startDate и endDate в первый запрос', async () => {
      mockQuery.mockResolvedValue({ rows: [{}] });

      await db.getAnalytics('2024-03-01', '2024-03-31');

      const firstCallParams = mockQuery.mock.calls[0][1];
      expect(firstCallParams).toContain('2024-03-01');
      expect(firstCallParams).toContain('2024-03-31');
    });
  });

  // ─── getClientsByPeriod ──────────────────────────────────────────────────────

  describe('getClientsByPeriod', () => {
    it('передаёт период и возвращает строки', async () => {
      const rows = [{ id: 1, name: 'Клиент', employee_name: 'Зухра' }];
      mockQuery.mockResolvedValueOnce({ rows });

      const result = await db.getClientsByPeriod('2024-01-01', '2024-06-30');

      expect(result).toEqual(rows);
      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe('2024-01-01');
      expect(params[1]).toBe('2024-06-30');
    });
  });

  // ─── обработка ошибок ────────────────────────────────────────────────────────

  describe('обработка ошибок pool.query', () => {
    it('getAllClients пробрасывает ошибку БД', async () => {
      mockQuery.mockRejectedValueOnce(new Error('timeout'));

      await expect(db.getAllClients()).rejects.toThrow('timeout');
    });

    it('getStats пробрасывает ошибку БД', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection lost'));

      await expect(db.getStats()).rejects.toThrow('connection lost');
    });

    it('markReminderSent пробрасывает ошибку БД', async () => {
      mockQuery.mockRejectedValueOnce(new Error('deadlock'));

      await expect(db.markReminderSent(1)).rejects.toThrow('deadlock');
    });
  });
});
