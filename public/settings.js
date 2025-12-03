const API_BASE = window.location.origin;

let authToken = localStorage.getItem('authToken');
let statusCheckInterval = null;
let qrCheckInterval = null;

// Проверка авторизации
function checkAuth() {
    if (!authToken) {
        window.location.href = '/login';
        return false;
    }
    return true;
}

// Получение headers с токеном
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
    };
}

// Выход
function logout() {
    fetch(`${API_BASE}/api/logout`, {
        method: 'POST',
        headers: getAuthHeaders()
    }).finally(() => {
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        window.location.href = '/login';
    });
}

// Загрузка при старте
document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;

    // Показать имя пользователя
    const username = localStorage.getItem('username');
    if (username) {
        document.getElementById('username-display').textContent = username;
    }

    // Первичная проверка статуса
    refreshStatus();

    // Автоматическое обновление статуса каждые 10 секунд
    statusCheckInterval = setInterval(refreshStatus, 10000);
});

// Обновить статус WhatsApp
async function refreshStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/whatsapp/status`, {
            headers: getAuthHeaders()
        });
        const data = await res.json();

        console.log('📊 Статус WhatsApp:', data);

        const statusIcon = document.getElementById('status-icon');
        const statusText = document.getElementById('status-text');
        const statusDescription = document.getElementById('status-description');
        const qrSection = document.getElementById('qr-section');
        const sessionInfo = document.getElementById('session-info');
        const testBtn = document.getElementById('test-btn');

        if (data.ready) {
            // WhatsApp подключен
            statusIcon.className = 'fas fa-circle text-green-500 text-2xl';
            statusText.textContent = 'Подключено';
            statusDescription.textContent = 'WhatsApp успешно подключен и готов к работе';

            qrSection.classList.remove('hidden');
            sessionInfo.classList.remove('hidden');
            testBtn.disabled = false;
            testBtn.classList.remove('opacity-50', 'cursor-not-allowed');

            // Скрыть инструкции, изменить заголовок
            document.getElementById('qr-title').textContent = 'WhatsApp просмотр';
            document.getElementById('qr-instructions').classList.add('hidden');

            // Показать скриншот WhatsApp
            displayWhatsAppScreen();

            // Автообновление скриншота каждые 5 секунд
            if (!qrCheckInterval) {
                qrCheckInterval = setInterval(() => {
                    displayWhatsAppScreen();
                }, 5000);
            }
        } else if (data.browserActive) {
            // Браузер запущен, ожидается авторизация
            statusIcon.className = 'fas fa-circle text-orange-500 text-2xl';
            statusText.textContent = 'Ожидание авторизации';
            statusDescription.textContent = 'Отсканируйте QR код в WhatsApp';

            qrSection.classList.remove('hidden');
            sessionInfo.classList.add('hidden');
            testBtn.disabled = true;
            testBtn.classList.add('opacity-50', 'cursor-not-allowed');

            // Показать инструкции, изменить заголовок
            document.getElementById('qr-title').textContent = 'Отсканируйте QR-код для подключения';
            document.getElementById('qr-instructions').classList.remove('hidden');

            // Показать скриншот WhatsApp (с QR кодом)
            displayWhatsAppScreen();

            // Запустить частую проверку статуса при отображении QR
            if (!qrCheckInterval) {
                qrCheckInterval = setInterval(() => {
                    refreshStatus();
                    displayWhatsAppScreen();
                }, 3000);
            }
        } else {
            // WhatsApp инициализируется или отключен
            statusIcon.className = 'fas fa-circle text-gray-400 text-2xl';
            statusText.textContent = data.status === 'initializing' ? 'Инициализация...' : 'Не подключено';
            statusDescription.textContent = data.status === 'initializing'
                ? 'Подключение к WhatsApp...'
                : 'WhatsApp не подключен к серверу';

            qrSection.classList.add('hidden');
            sessionInfo.classList.add('hidden');
            testBtn.disabled = true;
            testBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    } catch (error) {
        console.error('Ошибка проверки статуса:', error);
        showNotification('Ошибка проверки статуса WhatsApp', 'error');
    }
}

// Отобразить скриншот WhatsApp с QR кодом
async function displayWhatsAppScreen() {
    const qrCodeElement = document.getElementById('qr-code');

    // Очистить предыдущий контент
    qrCodeElement.innerHTML = '<div class="text-center p-4"><i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i></div>';

    try {
        console.log('📸 Запрос скриншота WhatsApp...');

        // Получаем скриншот через fetch с авторизацией и timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд timeout

        const response = await fetch(`${API_BASE}/api/whatsapp/screenshot?t=${Date.now()}`, {
            headers: getAuthHeaders(),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        console.log('📸 Ответ получен:', response.status, response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Ошибка ответа:', errorText);
            throw new Error(`Ошибка ${response.status}: ${response.statusText}`);
        }

        // Получаем blob изображения
        const blob = await response.blob();
        console.log('📸 Blob получен, размер:', blob.size, 'тип:', blob.type);

        const imageUrl = URL.createObjectURL(blob);

        // Создать изображение скриншота
        const screenshot = document.createElement('img');
        screenshot.src = imageUrl;
        screenshot.alt = 'WhatsApp Web';
        screenshot.className = 'max-w-full mx-auto rounded-lg shadow-lg';
        screenshot.style.maxHeight = '600px';

        qrCodeElement.innerHTML = '';
        qrCodeElement.appendChild(screenshot);

        console.log('✅ Скриншот отображен успешно');

    } catch (error) {
        console.error('❌ Ошибка загрузки скриншота:', error);

        // Если это ошибка timeout, показываем специальное сообщение
        if (error.name === 'AbortError') {
            qrCodeElement.innerHTML = `
                <div class="text-center p-4">
                    <i class="fas fa-clock text-orange-600 text-4xl mb-2"></i>
                    <p class="text-gray-700">Timeout: не удалось получить скриншот</p>
                    <p class="text-gray-500 text-sm mt-2">Попробуйте обновить страницу</p>
                </div>
            `;
        } else {
            qrCodeElement.innerHTML = `
                <div class="text-center p-4">
                    <i class="fas fa-exclamation-triangle text-yellow-600 text-4xl mb-2"></i>
                    <p class="text-gray-700">Не удалось загрузить изображение WhatsApp</p>
                    <p class="text-gray-500 text-sm mt-2">${error.message}</p>
                </div>
            `;
        }
    }
}

// Переподключить WhatsApp
async function reconnectWhatsApp() {
    if (!confirm('Переподключить WhatsApp?\n\nТекущая сессия будет удалена и потребуется отсканировать новый QR-код.')) return;

    try {
        showNotification('Удаление текущей сессии и переподключение...', 'info');

        const res = await fetch(`${API_BASE}/api/whatsapp/reconnect`, {
            method: 'POST',
            headers: getAuthHeaders()
        });

        const data = await res.json();

        if (res.ok) {
            showNotification('Сессия удалена! Отсканируйте новый QR-код', 'success');

            // Обновить статус сразу
            refreshStatus();

            // Запустить частую проверку статуса
            if (qrCheckInterval) clearInterval(qrCheckInterval);
            qrCheckInterval = setInterval(() => {
                refreshStatus();
                displayWhatsAppScreen();
            }, 3000);
        } else {
            showNotification(data.error || 'Ошибка переподключения', 'error');
        }
    } catch (error) {
        console.error('Ошибка переподключения:', error);
        showNotification('Ошибка переподключения WhatsApp', 'error');
    }
}

// Отключить WhatsApp
async function disconnectWhatsApp() {
    if (!confirm('Отключить WhatsApp и отвязать устройство?\n\nСессия будет полностью удалена, и устройство будет отвязано от WhatsApp.\nПотребуется повторная авторизация через QR код.')) return;

    try {
        showNotification('Отключение WhatsApp и удаление сессии...', 'info');

        const res = await fetch(`${API_BASE}/api/whatsapp/disconnect`, {
            method: 'POST',
            headers: getAuthHeaders()
        });

        const data = await res.json();

        if (res.ok) {
            showNotification('WhatsApp отключен и устройство отвязано', 'success');
            refreshStatus();
        } else {
            showNotification(data.error || 'Ошибка отключения', 'error');
        }
    } catch (error) {
        console.error('Ошибка отключения:', error);
        showNotification('Ошибка отключения WhatsApp', 'error');
    }
}

// Отправить тестовое сообщение
async function sendTestMessage() {
    const phone = prompt('Введите номер телефона (79XXXXXXXXX):');

    if (!phone) return;

    // Валидация номера
    if (!/^7\d{10}$/.test(phone)) {
        showNotification('Неверный формат номера. Используйте формат: 79XXXXXXXXX', 'error');
        return;
    }

    const message = prompt('Введите сообщение:', 'Это тестовое сообщение от сервиса напоминаний.');

    if (!message) return;

    try {
        showNotification('Отправка сообщения...', 'info');

        const res = await fetch(`${API_BASE}/api/send-test`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ phone, message })
        });

        const data = await res.json();

        if (res.ok) {
            showNotification('Тестовое сообщение отправлено успешно!', 'success');
        } else {
            showNotification(data.error || 'Ошибка отправки', 'error');
        }
    } catch (error) {
        console.error('Ошибка отправки:', error);
        showNotification('Ошибка отправки тестового сообщения', 'error');
    }
}

// Просмотр логов
function viewLogs() {
    showNotification('Функция просмотра логов в разработке', 'info');
    // TODO: Реализовать вывод логов WhatsApp
    // Можно добавить API endpoint для получения последних логов
}

// Показать руководство
function showGuide(type) {
    const guides = {
        'implementation': {
            title: 'Руководство по интеграции',
            content: `
                <h3 class="font-bold mb-2">Интеграция WhatsApp</h3>
                <p class="mb-2">Этот сервис использует whatsapp-web.js для интеграции с WhatsApp.</p>
                <ol class="list-decimal ml-4 space-y-1">
                    <li>При первом запуске необходимо отсканировать QR код</li>
                    <li>Сессия сохраняется в папке .wwebjs_auth</li>
                    <li>При повторном запуске QR код не требуется</li>
                    <li>Рекомендуется использовать headless: false для надежности</li>
                </ol>
            `
        },
        'troubleshooting': {
            title: 'Решение проблем',
            content: `
                <h3 class="font-bold mb-2">Частые проблемы</h3>
                <ul class="list-disc ml-4 space-y-1">
                    <li><strong>QR код не появляется:</strong> Проверьте логи сервера</li>
                    <li><strong>Сессия пропала:</strong> Удалите папку .wwebjs_auth и повторите авторизацию</li>
                    <li><strong>Сообщения не отправляются:</strong> Проверьте формат номера (79XXXXXXXXX)</li>
                    <li><strong>WhatsApp отключается:</strong> Используйте headless: false</li>
                </ul>
            `
        },
        'setup': {
            title: 'Инструкция по настройке',
            content: `
                <h3 class="font-bold mb-2">Настройка WhatsApp</h3>
                <ol class="list-decimal ml-4 space-y-1">
                    <li>Убедитесь, что WhatsApp установлен на вашем телефоне</li>
                    <li>Откройте WhatsApp на телефоне</li>
                    <li>Нажмите на три точки (⋮) в правом верхнем углу</li>
                    <li>Выберите "Связанные устройства"</li>
                    <li>Нажмите "Привязать устройство"</li>
                    <li>Отсканируйте QR код, который появился на этой странице</li>
                    <li>Дождитесь подключения (статус изменится на "Подключено")</li>
                </ol>
            `
        }
    };

    const guide = guides[type];

    if (!guide) {
        showNotification('Руководство не найдено', 'error');
        return;
    }

    // Создать модальное окно
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-bold text-gray-800">${guide.title}</h2>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-gray-700">
                    <i class="fas fa-times text-xl"></i>
                </button>
            </div>
            <div class="text-gray-700">
                ${guide.content}
            </div>
            <div class="mt-6 flex justify-end">
                <button onclick="this.closest('.fixed').remove()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    Закрыть
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

// Переключение меню пользователя
function toggleUserMenu() {
    const menu = document.getElementById('userMenu');
    menu.classList.toggle('hidden');
}

// Закрытие меню при клике вне его
document.addEventListener('click', (e) => {
    const menu = document.getElementById('userMenu');
    const button = e.target.closest('button');

    if (menu && !menu.contains(e.target) && (!button || !button.onclick || button.onclick.toString().indexOf('toggleUserMenu') === -1)) {
        menu.classList.add('hidden');
    }
});

// Уведомления
function showNotification(message, type = 'info') {
    const container = document.getElementById('notifications');
    const id = Date.now();

    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        info: 'bg-blue-500',
        warning: 'bg-orange-500'
    };

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        info: 'fa-info-circle',
        warning: 'fa-exclamation-triangle'
    };

    const notification = document.createElement('div');
    notification.id = `notification-${id}`;
    notification.className = `${colors[type]} text-white px-6 py-4 rounded-lg shadow-lg flex items-center space-x-3 max-w-md`;
    notification.innerHTML = `
        <i class="fas ${icons[type]}"></i>
        <span class="flex-1">${message}</span>
        <button onclick="this.parentElement.remove()" class="text-white hover:text-gray-200">
            <i class="fas fa-times"></i>
        </button>
    `;

    container.appendChild(notification);

    setTimeout(() => {
        const el = document.getElementById(`notification-${id}`);
        if (el) el.remove();
    }, 5000);
}

// Изменение учетных данных администратора
async function changeAdminCredentials() {
    const userRole = localStorage.getItem('userRole') || 'user';
    const isAdmin = userRole === 'admin';

    // Создать модальное окно
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-bold text-gray-800">
                    <i class="fas fa-user-shield text-blue-600 mr-2"></i>
                    Изменить пароль
                </h2>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-gray-700">
                    <i class="fas fa-times text-xl"></i>
                </button>
            </div>
            <form id="changeCredentialsForm" class="space-y-4">
                ${!isAdmin ? `
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        <i class="fas fa-lock mr-2"></i>Текущий пароль
                    </label>
                    <input
                        type="password"
                        id="oldPassword"
                        required
                        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        placeholder="Введите текущий пароль"
                    >
                </div>
                ` : `
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        <i class="fas fa-user mr-2"></i>Новый логин
                    </label>
                    <input
                        type="text"
                        id="newUsername"
                        required
                        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        placeholder="Введите новый логин"
                    >
                </div>
                `}
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        <i class="fas fa-lock mr-2"></i>Новый пароль
                    </label>
                    <input
                        type="password"
                        id="newPassword"
                        required
                        minlength="6"
                        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        placeholder="Минимум 6 символов"
                    >
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        <i class="fas fa-lock mr-2"></i>Подтвердите пароль
                    </label>
                    <input
                        type="password"
                        id="confirmPassword"
                        required
                        minlength="6"
                        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        placeholder="Повторите пароль"
                    >
                </div>
                <div class="flex justify-end space-x-3 mt-6">
                    <button
                        type="button"
                        onclick="this.closest('.fixed').remove()"
                        class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                    >
                        Отмена
                    </button>
                    <button
                        type="submit"
                        class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        <i class="fas fa-save mr-2"></i>Сохранить
                    </button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);

    // Обработка формы
    document.getElementById('changeCredentialsForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        // Валидация
        if (newPassword !== confirmPassword) {
            showNotification('Пароли не совпадают', 'error');
            return;
        }

        if (newPassword.length < 6) {
            showNotification('Пароль должен содержать минимум 6 символов', 'error');
            return;
        }

        try {
            showNotification('Обновление пароля...', 'info');

            let res;
            if (isAdmin) {
                // Для админа - меняем логин и пароль через /api/admin/change-credentials
                const newUsername = document.getElementById('newUsername').value;
                res = await fetch(`${API_BASE}/api/admin/change-credentials`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        username: newUsername,
                        password: newPassword
                    })
                });
            } else {
                // Для обычного пользователя - меняем только пароль через /api/users/change-password
                const oldPassword = document.getElementById('oldPassword').value;
                res = await fetch(`${API_BASE}/api/users/change-password`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        old_password: oldPassword,
                        new_password: newPassword
                    })
                });
            }

            const data = await res.json();

            if (res.ok) {
                showNotification('Пароль успешно изменён! Перенаправление на страницу входа...', 'success');
                modal.remove();

                // Через 2 секунды выход и переход на логин
                setTimeout(() => {
                    localStorage.removeItem('authToken');
                    localStorage.removeItem('username');
                    localStorage.removeItem('userRole');
                    window.location.href = '/login';
                }, 2000);
            } else {
                showNotification(data.error || 'Ошибка обновления пароля', 'error');
            }
        } catch (error) {
            console.error('Ошибка обновления пароля:', error);
            showNotification('Ошибка обновления пароля', 'error');
        }
    });
}

// Загрузка шаблона сообщения при старте
document.addEventListener('DOMContentLoaded', async () => {
    await loadMessageTemplate();
});

// Загрузка шаблона сообщения
async function loadMessageTemplate() {
    try {
        const res = await fetch(`${API_BASE}/api/message-template`, {
            headers: getAuthHeaders()
        });

        if (res.ok) {
            const data = await res.json();
            document.getElementById('message-template').value = data.template;
        } else {
            showNotification('Ошибка загрузки шаблона', 'error');
        }
    } catch (error) {
        console.error('Ошибка загрузки шаблона:', error);
        showNotification('Ошибка загрузки шаблона сообщения', 'error');
    }
}

// Сохранение шаблона сообщения
async function saveMessageTemplate() {
    const template = document.getElementById('message-template').value;

    if (!template.trim()) {
        showNotification('Шаблон не может быть пустым', 'error');
        return;
    }

    // Проверка обязательных плейсхолдеров
    const requiredPlaceholders = ['{name}', '{insurance}', '{expirationDate}'];
    const missing = requiredPlaceholders.filter(ph => !template.includes(ph));

    if (missing.length > 0) {
        showNotification(`Отсутствуют обязательные плейсхолдеры: ${missing.join(', ')}`, 'error');
        return;
    }

    try {
        showNotification('Сохранение шаблона...', 'info');

        const res = await fetch(`${API_BASE}/api/message-template`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ template })
        });

        const data = await res.json();

        if (res.ok) {
            showNotification('Шаблон сообщения успешно сохранен!', 'success');
        } else {
            showNotification(data.error || 'Ошибка сохранения', 'error');
        }
    } catch (error) {
        console.error('Ошибка сохранения шаблона:', error);
        showNotification('Ошибка сохранения шаблона', 'error');
    }
}

// Сброс шаблона к значению по умолчанию
async function resetMessageTemplate() {
    if (!confirm('Вы уверены, что хотите сбросить шаблон к значению по умолчанию?')) {
        return;
    }

    const defaultTemplate = `Здравствуйте, {name}!

Напоминаем, что срок действия вашей страховки ({insurance}) истекает {expirationDate}.

{daysLeftMessage}

Для продления страховки, пожалуйста, свяжитесь с нами.

Спасибо, что выбираете наши услуги!`;

    document.getElementById('message-template').value = defaultTemplate;
    showNotification('Шаблон сброшен. Нажмите "Сохранить" для применения', 'info');
}

// Очистка интервалов при уходе со страницы
window.addEventListener('beforeunload', () => {
    if (statusCheckInterval) clearInterval(statusCheckInterval);
    if (qrCheckInterval) clearInterval(qrCheckInterval);
});
