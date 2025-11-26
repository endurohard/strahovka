# Быстрый старт

## 1. Подготовка

Убедитесь, что Excel файл находится в директории `data/clients.xlsx`:

```bash
ls -lh data/clients.xlsx
```

## 2. Запуск сервиса

```bash
docker-compose up -d
```

## 3. Просмотр логов и авторизация в WhatsApp

```bash
docker-compose logs -f app
```

При первом запуске появится QR код. Отсканируйте его через WhatsApp на телефоне.

## 4. Проверка работы

### Импорт данных вручную

```bash
docker-compose exec app node index.js --import
```

### Проверка напоминаний вручную

```bash
docker-compose exec app node index.js --check-now
```

### Просмотр логов базы данных

```bash
docker-compose exec db psql -U postgres -d strahovka -c "SELECT name, phone_formatted, reminder_date FROM clients LIMIT 10;"
```

### Статистика

```bash
docker-compose exec db psql -U postgres -d strahovka -c "
SELECT
    COUNT(*) as total_clients,
    COUNT(CASE WHEN reminder_date > NOW() THEN 1 END) as upcoming,
    COUNT(CASE WHEN reminder_date <= NOW() THEN 1 END) as pending
FROM clients;
"
```

## 5. Остановка

```bash
docker-compose down
```

## Расписание работы

- **09:00** - обновление данных из Excel
- **10:00** - отправка напоминаний

## Важно

1. После первой авторизации в WhatsApp сессия сохраняется
2. Данные базы сохраняются между перезапусками
3. Excel файл читается автоматически каждый день в 09:00
4. Можно обновить Excel файл и запустить импорт вручную

## Тестирование без WhatsApp

Для тестирования логики без реальной отправки сообщений можно закомментировать строки отправки в `whatsappService.js`.
