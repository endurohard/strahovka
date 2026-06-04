'use strict';

/**
 * Юнит-тесты для utils/validators.js
 *
 * Покрывают: схемы Joi (createClient, updateClient, createUser, login,
 * createEmployee, createExpense, sendTest, pagination) и мидлвары
 * validateBody / validateQuery.
 */

// Мокаем путь к validators.js через require-псевдоним.
// Реальный модуль лежит в ../../utils/validators относительно tests/unit/.
const {
  createClientSchema,
  updateClientSchema,
  createUserSchema,
  updateUserSchema,
  loginSchema,
  changePasswordSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
  createExpenseSchema,
  sendTestSchema,
  paginationSchema,
  validateBody,
  validateQuery,
} = require('../../utils/validators');

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

/**
 * Удобная обёртка: валидирует данные схемой и возвращает объект { error, value }.
 */
function validate(schema, data, options = {}) {
  return schema.validate(data, { abortEarly: false, ...options });
}

/** Возвращает true, если результат валидации содержит ошибку. */
function hasError(result) {
  return Boolean(result.error);
}

// ---------------------------------------------------------------------------
// 1. createClientSchema — 5 тестов
// ---------------------------------------------------------------------------

describe('createClientSchema', () => {
  // Минимально корректный набор полей для клиента
  const validClient = {
    name: 'Иван Иванов',
    phone: '+79991234567',
    start_date: '2026-01-01',
    expiration_date: '2026-12-31',
  };

  test('Корректные полные данные клиента проходят валидацию', () => {
    const result = validate(createClientSchema, {
      ...validClient,
      insurance: 'ОСАГО',
      services: 'Техосмотр',
      amount: 5000,
      insurance_expense: 1000,
      employee_expense: 500,
      employee_id: 3,
    });
    expect(hasError(result)).toBe(false);
    expect(result.value.name).toBe('Иван Иванов');
  });

  test('Отсутствующее обязательное поле name вызывает ошибку', () => {
    const { name, ...withoutName } = validClient;
    const result = validate(createClientSchema, withoutName);
    expect(hasError(result)).toBe(true);
    const messages = result.error.details.map(d => d.message);
    expect(messages.some(m => m.includes('"name"'))).toBe(true);
  });

  test('Отсутствующее обязательное поле phone вызывает ошибку', () => {
    const { phone, ...withoutPhone } = validClient;
    const result = validate(createClientSchema, withoutPhone);
    expect(hasError(result)).toBe(true);
    const messages = result.error.details.map(d => d.message);
    expect(messages.some(m => m.includes('"phone"'))).toBe(true);
  });

  test('Телефон в неверном формате вызывает ошибку', () => {
    const result = validate(createClientSchema, {
      ...validClient,
      phone: 'abc-not-a-phone',
    });
    expect(hasError(result)).toBe(true);
    const messages = result.error.details.map(d => d.message);
    expect(messages.some(m => m.includes('Неверный формат телефона'))).toBe(true);
  });

  test('expiration_date раньше start_date вызывает ошибку', () => {
    const result = validate(createClientSchema, {
      ...validClient,
      start_date: '2026-06-01',
      expiration_date: '2026-01-01', // раньше start_date
    });
    expect(hasError(result)).toBe(true);
    const messages = result.error.details.map(d => d.message);
    // Joi возвращает кастомное русское сообщение
    expect(messages.some(m => m.includes('Дата окончания') || m.includes('expiration_date'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. updateClientSchema — 3 теста
// ---------------------------------------------------------------------------

describe('updateClientSchema', () => {
  test('Частичное обновление (только name) проходит валидацию', () => {
    const result = validate(updateClientSchema, { name: 'Пётр Петров' });
    expect(hasError(result)).toBe(false);
    expect(result.value.name).toBe('Пётр Петров');
  });

  test('Пустой объект (нет полей) вызывает ошибку из-за ограничения .min(1)', () => {
    const result = validate(updateClientSchema, {});
    expect(hasError(result)).toBe(true);
  });

  test('Телефон в неверном формате вызывает ошибку при обновлении', () => {
    const result = validate(updateClientSchema, { phone: '1234' });
    expect(hasError(result)).toBe(true);
    const messages = result.error.details.map(d => d.message);
    expect(messages.some(m => m.includes('Неверный формат телефона'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. createUserSchema — 3 теста
// ---------------------------------------------------------------------------

describe('createUserSchema', () => {
  const validUser = {
    username: 'admin123',
    password: 'secret99',
  };

  test('Корректный пользователь проходит валидацию', () => {
    const result = validate(createUserSchema, validUser);
    expect(hasError(result)).toBe(false);
    // Роль должна принять значение по умолчанию 'user'
    expect(result.value.role).toBe('user');
  });

  test('Не-алфавитно-цифровой username вызывает ошибку', () => {
    const result = validate(createUserSchema, {
      ...validUser,
      username: 'user name!', // содержит пробел и спецсимвол
    });
    expect(hasError(result)).toBe(true);
    const messages = result.error.details.map(d => d.message);
    expect(messages.some(m => m.includes('Логин') || m.includes('"username"') || m.includes('alphanum'))).toBe(true);
  });

  test('Пароль короче 6 символов вызывает ошибку', () => {
    const result = validate(createUserSchema, {
      ...validUser,
      password: '123', // 3 символа — меньше минимума
    });
    expect(hasError(result)).toBe(true);
    const messages = result.error.details.map(d => d.message);
    expect(messages.some(m => m.includes('"password"'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. loginSchema — 2 теста
// ---------------------------------------------------------------------------

describe('loginSchema', () => {
  test('Корректные данные логина проходят валидацию', () => {
    const result = validate(loginSchema, {
      username: 'admin',
      password: 'mypassword',
    });
    expect(hasError(result)).toBe(false);
  });

  test('Отсутствующий password вызывает ошибку', () => {
    const result = validate(loginSchema, { username: 'admin' });
    expect(hasError(result)).toBe(true);
    const messages = result.error.details.map(d => d.message);
    expect(messages.some(m => m.includes('"password"'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. createEmployeeSchema — 2 теста
// ---------------------------------------------------------------------------

describe('createEmployeeSchema', () => {
  test('Корректный сотрудник проходит валидацию', () => {
    const result = validate(createEmployeeSchema, {
      name: 'Мария Сидорова',
      phone: '89161234567',
    });
    expect(hasError(result)).toBe(false);
  });

  test('Отсутствующее обязательное поле name вызывает ошибку', () => {
    const result = validate(createEmployeeSchema, { phone: '+79991234567' });
    expect(hasError(result)).toBe(true);
    const messages = result.error.details.map(d => d.message);
    expect(messages.some(m => m.includes('"name"'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. createExpenseSchema — 2 теста
// ---------------------------------------------------------------------------

describe('createExpenseSchema', () => {
  const validExpense = {
    expense_date: '2026-03-01',
    category: 'office',
    amount: 3500,
  };

  test('Корректная расходная запись проходит валидацию', () => {
    const result = validate(createExpenseSchema, {
      ...validExpense,
      description: 'Аренда офиса за март',
    });
    expect(hasError(result)).toBe(false);
    expect(result.value.category).toBe('office');
  });

  test('Недопустимая категория вызывает ошибку', () => {
    const result = validate(createExpenseSchema, {
      ...validExpense,
      category: 'food', // нет в enum: salary | office | marketing | other
    });
    expect(hasError(result)).toBe(true);
    const messages = result.error.details.map(d => d.message);
    expect(messages.some(m => m.includes('"category"'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. sendTestSchema — 2 теста
// ---------------------------------------------------------------------------

describe('sendTestSchema', () => {
  test('Корректное тестовое сообщение проходит валидацию', () => {
    const result = validate(sendTestSchema, {
      phone: '+79991234567',
      message: 'Привет, это тестовое сообщение!',
    });
    expect(hasError(result)).toBe(false);
  });

  test('Сообщение длиннее 1000 символов вызывает ошибку', () => {
    const result = validate(sendTestSchema, {
      phone: '+79991234567',
      message: 'x'.repeat(1001), // превышает max(1000)
    });
    expect(hasError(result)).toBe(true);
    const messages = result.error.details.map(d => d.message);
    expect(messages.some(m => m.includes('Сообщение') || m.includes('"message"') || m.includes('1000'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. paginationSchema — 2 теста
// ---------------------------------------------------------------------------

describe('paginationSchema', () => {
  test('Значения по умолчанию применяются при пустом объекте', () => {
    const result = validate(paginationSchema, {});
    expect(hasError(result)).toBe(false);
    expect(result.value.page).toBe(1);
    expect(result.value.limit).toBe(50);
    expect(result.value.search).toBe('');
    expect(result.value.sort).toBe('reminder_date');
  });

  test('Недопустимое поле сортировки вызывает ошибку', () => {
    const result = validate(paginationSchema, { sort: 'invalid_field' });
    expect(hasError(result)).toBe(true);
    const messages = result.error.details.map(d => d.message);
    expect(messages.some(m => m.includes('"sort"'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. validateBody middleware — 2 теста
// ---------------------------------------------------------------------------

describe('validateBody middleware', () => {
  /**
   * Создаёт минимальный фиктивный объект Express-запроса.
   */
  function makeReq(body) {
    return { body };
  }

  /**
   * Создаёт фиктивный объект Express-ответа с отслеживанием вызовов.
   */
  function makeRes() {
    const res = {
      statusCode: null,
      jsonPayload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.jsonPayload = payload;
        return this;
      },
    };
    return res;
  }

  test('Вызывает next() при корректных данных тела запроса', () => {
    const middleware = validateBody(loginSchema);
    const req = makeReq({ username: 'admin', password: 'secret99' });
    const res = makeRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    // Тело должно быть перезаписано очищенным значением
    expect(req.body.username).toBe('admin');
    // Статус ответа не должен устанавливаться
    expect(res.statusCode).toBeNull();
  });

  test('Возвращает 400 при некорректных данных тела запроса', () => {
    const middleware = validateBody(loginSchema);
    const req = makeReq({ username: 'admin' }); // password отсутствует
    const res = makeRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.jsonPayload).toMatchObject({
      error: 'Ошибка валидации',
      details: expect.any(Array),
    });
    expect(res.jsonPayload.details.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 10. validateQuery middleware — 1 тест
// ---------------------------------------------------------------------------

describe('validateQuery middleware', () => {
  function makeReq(query) {
    return { query };
  }

  function makeRes() {
    const res = {
      statusCode: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        return this;
      },
    };
    return res;
  }

  test('Вызывает next() при корректных параметрах запроса и применяет дефолты', () => {
    const middleware = validateQuery(paginationSchema);
    const req = makeReq({ page: '2', limit: '10' });
    const res = makeRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    // Joi приводит строки к числам при валидации query-параметров
    expect(req.query.page).toBe(2);
    expect(req.query.limit).toBe(10);
    // Дефолт сортировки применяется
    expect(req.query.sort).toBe('reminder_date');
    expect(res.statusCode).toBeNull();
  });
});
