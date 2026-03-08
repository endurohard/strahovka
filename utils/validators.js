/**
 * Joi схемы валидации для API endpoints
 */

const Joi = require('joi');

// Схема для телефонного номера
const phoneSchema = Joi.string()
  .pattern(/^(\+7|8|7)?[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}$/)
  .messages({
    'string.pattern.base': 'Неверный формат телефона. Используйте: +79991234567, 89991234567 или 9991234567',
  });

// Схема для создания клиента
const createClientSchema = Joi.object({
  name: Joi.string().min(2).max(255).required().messages({
    'string.empty': 'Имя клиента обязательно',
    'string.min': 'Имя должно содержать минимум 2 символа',
    'string.max': 'Имя слишком длинное (максимум 255 символов)',
  }),
  phone: phoneSchema.required(),
  insurance: Joi.string().max(100).allow('', null),
  services: Joi.string().max(500).allow('', null),
  amount: Joi.number().min(0).default(0),
  insurance_expense: Joi.number().min(0).default(0),
  employee_expense: Joi.number().min(0).default(0),
  start_date: Joi.date().iso().default(() => new Date()),
  expiration_date: Joi.date().iso().min(Joi.ref('start_date')).messages({
    'date.min': 'Дата окончания должна быть после даты оформления',
  }),
  employee_id: Joi.number().integer().allow(null),
});

// Схема для обновления клиента
const updateClientSchema = Joi.object({
  name: Joi.string().min(2).max(255),
  phone: phoneSchema,
  insurance: Joi.string().max(100).allow('', null),
  services: Joi.string().max(500).allow('', null),
  amount: Joi.number().min(0).allow(''),
  insurance_expense: Joi.number().min(0).allow(''),
  employee_expense: Joi.number().min(0).allow(''),
  start_date: Joi.date().iso(),
  expiration_date: Joi.date().iso(),
  employee_id: Joi.number().integer().allow(null, ''),
}).min(1).messages({
  'object.min': 'Должно быть указано хотя бы одно поле для обновления',
});

// Схема для создания пользователя
const createUserSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(50).required().messages({
    'string.alphanum': 'Логин может содержать только буквы и цифры',
    'string.min': 'Логин должен содержать минимум 3 символа',
    'string.max': 'Логин слишком длинный (максимум 50 символов)',
  }),
  password: Joi.string().min(6).max(128).required(),
  role: Joi.string().valid('admin', 'user').default('user'),
});

// Схема для обновления пользователя
const updateUserSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(50),
  password: Joi.string().min(6).max(128),
  role: Joi.string().valid('admin', 'user'),
  active: Joi.boolean(),
}).min(1);

// Схема для логина
const loginSchema = Joi.object({
  username: Joi.string().required().messages({
    'string.empty': 'Логин обязателен',
  }),
  password: Joi.string().required().messages({
    'string.empty': 'Пароль обязателен',
  }),
});

// Схема для смены пароля
const changePasswordSchema = Joi.object({
  old_password: Joi.string().required().messages({
    'string.empty': 'Текущий пароль обязателен',
  }),
  new_password: Joi.string().min(6).max(128).required().messages({
    'string.min': 'Новый пароль должен содержать минимум 6 символов',
  }),
});

// Схема для создания сотрудника
const createEmployeeSchema = Joi.object({
  name: Joi.string().min(2).max(255).required(),
  phone: phoneSchema.allow('', null),
});

// Схема для обновления сотрудника
const updateEmployeeSchema = Joi.object({
  name: Joi.string().min(2).max(255),
  phone: phoneSchema.allow('', null),
  active: Joi.boolean(),
}).min(1);

// Схема для создания расхода
const createExpenseSchema = Joi.object({
  expense_date: Joi.date().iso().required().messages({
    'date.base': 'Неверный формат даты',
  }),
  category: Joi.string().valid('salary', 'office', 'marketing', 'other').required(),
  description: Joi.string().max(500).allow('', null),
  amount: Joi.number().min(0).required().messages({
    'number.min': 'Сумма не может быть отрицательной',
  }),
});

// Схема для тестовой отправки сообщения
const sendTestSchema = Joi.object({
  phone: phoneSchema.required(),
  message: Joi.string().min(1).max(1000).required().messages({
    'string.empty': 'Сообщение не может быть пустым',
    'string.max': 'Сообщение слишком длинное (максимум 1000 символов)',
  }),
});

// Схема для параметров пагинации
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  search: Joi.string().max(255).allow('').default(''),
  sort: Joi.string().valid('reminder_date', 'created_at', 'name', 'start_date', 'expiration_date').default('reminder_date'),
});

/**
 * Middleware для валидации тела запроса
 * @param {Joi.Schema} schema - Joi схема
 * @returns {Function} Express middleware
 */
function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // Показывать все ошибки, а не только первую
      stripUnknown: true, // Удалять неизвестные поля
    });

    if (error) {
      const errors = error.details.map(detail => detail.message);
      return res.status(400).json({
        error: 'Ошибка валидации',
        details: errors,
      });
    }

    // Заменяем req.body валидированными данными
    req.body = value;
    next();
  };
}

/**
 * Middleware для валидации query параметров
 * @param {Joi.Schema} schema - Joi схема
 * @returns {Function} Express middleware
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map(detail => detail.message);
      return res.status(400).json({
        error: 'Ошибка валидации параметров запроса',
        details: errors,
      });
    }

    req.query = value;
    next();
  };
}

module.exports = {
  // Схемы
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

  // Middleware
  validateBody,
  validateQuery,
};
