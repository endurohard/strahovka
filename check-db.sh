#!/bin/bash

echo "==================================="
echo "Статистика базы данных"
echo "==================================="

docker-compose exec -T db psql -U postgres -d strahovka << EOF
-- Общая статистика
SELECT
    COUNT(*) as "Всего клиентов",
    COUNT(CASE WHEN reminder_date > NOW() THEN 1 END) as "Будущие напоминания",
    COUNT(CASE WHEN reminder_date <= NOW() AND (last_reminder_sent IS NULL OR last_reminder_sent::date < NOW()::date) THEN 1 END) as "Ожидают отправки",
    COUNT(CASE WHEN last_reminder_sent IS NOT NULL THEN 1 END) as "Уже отправлено"
FROM clients;

\echo
\echo '==================================='
\echo 'Клиенты с предстоящими напоминаниями (ближайшие 30 дней)'
\echo '==================================='

SELECT
    name as "Имя",
    phone_formatted as "Телефон",
    insurance as "Страховая",
    TO_CHAR(start_date, 'DD.MM.YYYY') as "Дата начала",
    TO_CHAR(expiration_date, 'DD.MM.YYYY') as "Истекает",
    TO_CHAR(reminder_date, 'DD.MM.YYYY') as "Напомнить"
FROM clients
WHERE reminder_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
ORDER BY reminder_date
LIMIT 10;

\echo
\echo '==================================='
\echo 'Клиенты, ожидающие напоминания сегодня'
\echo '==================================='

SELECT
    name as "Имя",
    phone_formatted as "Телефон",
    insurance as "Страховая",
    TO_CHAR(expiration_date, 'DD.MM.YYYY') as "Истекает",
    CASE
        WHEN last_reminder_sent IS NOT NULL THEN 'Отправлено'
        ELSE 'Ожидает'
    END as "Статус"
FROM clients
WHERE reminder_date::date = NOW()::date
ORDER BY name;
EOF

echo ""
echo "==================================="
echo "Для просмотра всех клиентов:"
echo "docker-compose exec db psql -U postgres -d strahovka -c 'SELECT * FROM clients;'"
echo "==================================="
