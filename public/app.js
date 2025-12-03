const API_BASE = window.location.origin;

let currentPage = 1;
let searchDebounce = null;
let authToken = localStorage.getItem('authToken');

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

    loadStats();
    loadClients();
    checkWhatsAppStatus();

    // Обновление каждые 30 секунд
    setInterval(() => {
        loadStats();
        checkWhatsAppStatus();
    }, 30000);
});

// Проверка статуса WhatsApp
async function checkWhatsAppStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/whatsapp/status`, {
            headers: getAuthHeaders()
        });
        const data = await res.json();

        const statusEl = document.getElementById('whatsapp-status');
        if (data.ready) {
            // Полностью авторизован и готов
            statusEl.className = 'px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800';
            statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Подключен';
        } else if (data.browserActive) {
            // Браузер активен, но не авторизован (ждет QR)
            statusEl.className = 'px-3 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800';
            statusEl.innerHTML = '<i class="fas fa-qrcode"></i> Ожидание QR';
        } else {
            // Полностью отключен
            statusEl.className = 'px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800';
            statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Отключен';
        }
    } catch (error) {
        console.error('Ошибка проверки WhatsApp:', error);
    }
}

// Загрузка статистики
async function loadStats() {
    try {
        const res = await fetch(`${API_BASE}/api/stats`, {
            headers: getAuthHeaders()
        });
        const data = await res.json();

        document.getElementById('stat-total').textContent = data.total_clients || 0;
        document.getElementById('stat-upcoming').textContent = data.upcoming_reminders || 0;
        document.getElementById('stat-pending').textContent = data.pending_reminders || 0;
        document.getElementById('stat-sent').textContent = data.sent_reminders || 0;
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
        showNotification('Ошибка загрузки статистики', 'error');
    }
}

// Загрузка клиентов
async function loadClients(page = 1) {
    currentPage = page;
    const search = document.getElementById('search').value;
    const sort = document.getElementById('sort').value;

    try {
        const params = new URLSearchParams({
            page,
            limit: 50,
            search,
            sort
        });

        const res = await fetch(`${API_BASE}/api/clients?${params}`, {
            headers: getAuthHeaders()
        });
        const data = await res.json();

        renderClientsTable(data.clients);
        renderPagination(data.page, data.pages, data.total);

        document.getElementById('showing-from').textContent = (data.page - 1) * 50 + 1;
        document.getElementById('showing-to').textContent = Math.min(data.page * 50, data.total);
        document.getElementById('total-count').textContent = data.total;
    } catch (error) {
        console.error('Ошибка загрузки клиентов:', error);
        showNotification('Ошибка загрузки клиентов', 'error');
    }
}

// Отрисовка таблицы клиентов
function renderClientsTable(clients) {
    const tbody = document.getElementById('clients-table');

    if (clients.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="px-6 py-12 text-center text-gray-500">
                    <i class="fas fa-inbox text-4xl mb-2"></i>
                    <p>Клиенты не найдены</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = clients.map(client => {
        const reminderDate = new Date(client.reminder_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let statusBadge = '';
        if (client.last_reminder_sent) {
            statusBadge = '<span class="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">Отправлено</span>';
        } else if (reminderDate <= today) {
            statusBadge = '<span class="px-2 py-1 bg-orange-100 text-orange-800 rounded-full text-xs">Ожидает</span>';
        } else {
            statusBadge = '<span class="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">Запланировано</span>';
        }

        return `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${client.name}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${client.phone_formatted || client.phone}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${client.insurance || '-'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(client.start_date)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(client.expiration_date)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(client.reminder_date)}</td>
                <td class="px-6 py-4 whitespace-nowrap">${statusBadge}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onclick="sendManualReminder(${client.id}, '${client.name.replace(/'/g, "\\'")}')" class="text-green-600 hover:text-green-900 mr-3" title="Отправить напоминание">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                    <button onclick="editClient(${client.id})" class="text-blue-600 hover:text-blue-900 mr-3" title="Редактировать">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteClient(${client.id}, '${client.name.replace(/'/g, "\\'")}')" class="text-red-600 hover:text-red-900" title="Удалить">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Отрисовка пагинации
function renderPagination(current, total, totalCount) {
    const pagination = document.getElementById('pagination');

    if (total <= 1) {
        pagination.innerHTML = '';
        return;
    }

    let html = '';

    // Предыдущая
    if (current > 1) {
        html += `<button onclick="loadClients(${current - 1})" class="px-3 py-1 border rounded hover:bg-gray-100">
            <i class="fas fa-chevron-left"></i>
        </button>`;
    }

    // Страницы
    const startPage = Math.max(1, current - 2);
    const endPage = Math.min(total, current + 2);

    for (let i = startPage; i <= endPage; i++) {
        if (i === current) {
            html += `<button class="px-3 py-1 bg-blue-600 text-white rounded">${i}</button>`;
        } else {
            html += `<button onclick="loadClients(${i})" class="px-3 py-1 border rounded hover:bg-gray-100">${i}</button>`;
        }
    }

    // Следующая
    if (current < total) {
        html += `<button onclick="loadClients(${current + 1})" class="px-3 py-1 border rounded hover:bg-gray-100">
            <i class="fas fa-chevron-right"></i>
        </button>`;
    }

    pagination.innerHTML = html;
}

// Импорт из Excel
async function importExcel() {
    if (!confirm('Импортировать данные из Excel файла?')) return;

    try {
        showNotification('Импорт данных...', 'info');
        const res = await fetch(`${API_BASE}/api/import`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await res.json();

        if (res.ok) {
            showNotification(`Импортировано: ${data.imported}, Ошибок: ${data.errors}`, 'success');
            loadStats();
            loadClients();
        } else {
            showNotification(data.error || 'Ошибка импорта', 'error');
        }
    } catch (error) {
        console.error('Ошибка импорта:', error);
        showNotification('Ошибка импорта данных', 'error');
    }
}

// Отправка напоминаний
async function sendReminders() {
    if (!confirm('Отправить напоминания клиентам?')) return;

    try {
        showNotification('Отправка напоминаний...', 'info');
        const res = await fetch(`${API_BASE}/api/send-reminders`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await res.json();

        if (res.ok) {
            showNotification(`Отправлено: ${data.sent}, Ошибок: ${data.errors}`, 'success');
            loadStats();
            loadClients();
        } else {
            showNotification(data.error || 'Ошибка отправки', 'error');
        }
    } catch (error) {
        console.error('Ошибка отправки:', error);
        showNotification('Ошибка отправки напоминаний', 'error');
    }
}

// Модальное окно загрузки
function showUploadModal() {
    document.getElementById('upload-modal').classList.remove('hidden');
}

function hideUploadModal() {
    document.getElementById('upload-modal').classList.add('hidden');
    document.getElementById('file-input').value = '';
}

async function uploadFile() {
    const fileInput = document.getElementById('file-input');
    const file = fileInput.files[0];

    if (!file) {
        showNotification('Выберите файл', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        showNotification('Загрузка файла...', 'info');
        const res = await fetch(`${API_BASE}/api/upload`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (res.ok) {
            showNotification(`Загружено: ${data.imported}, Ошибок: ${data.errors}`, 'success');
            hideUploadModal();
            loadStats();
            loadClients();
        } else {
            showNotification(data.error || 'Ошибка загрузки', 'error');
        }
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        showNotification('Ошибка загрузки файла', 'error');
    }
}

// Модальное окно добавления клиента
async function showAddClientModal() {
    // Загружаем список сотрудников
    try {
        const res = await fetch(`${API_BASE}/api/employees`, {
            headers: getAuthHeaders()
        });
        const employees = await res.json();
        const select = document.getElementById('employee-select');
        select.innerHTML = '<option value="">-- Не выбран --</option>';
        employees.forEach(emp => {
            select.innerHTML += `<option value="${emp.id}">${emp.name}</option>`;
        });
    } catch (error) {
        console.error('Ошибка загрузки сотрудников:', error);
    }
    document.getElementById('add-client-modal').classList.remove('hidden');
}

function hideAddClientModal() {
    document.getElementById('add-client-modal').classList.add('hidden');
    document.getElementById('add-client-form').reset();
}

async function addClient(event) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData);

    try {
        const res = await fetch(`${API_BASE}/api/clients`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });

        const result = await res.json();

        if (res.ok) {
            showNotification('Клиент добавлен', 'success');
            hideAddClientModal();
            loadStats();
            loadClients();
        } else {
            showNotification(result.error || 'Ошибка добавления', 'error');
        }
    } catch (error) {
        console.error('Ошибка добавления:', error);
        showNotification('Ошибка добавления клиента', 'error');
    }
}

// Удаление клиента
async function deleteClient(id, name) {
    if (!confirm(`Удалить клиента "${name}"?`)) return;

    try {
        const res = await fetch(`${API_BASE}/api/clients/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        const data = await res.json();

        if (res.ok) {
            showNotification('Клиент удален', 'success');
            loadStats();
            loadClients();
        } else {
            showNotification(data.error || 'Ошибка удаления', 'error');
        }
    } catch (error) {
        console.error('Ошибка удаления:', error);
        showNotification('Ошибка удаления клиента', 'error');
    }
}

// Отправка ручного напоминания клиенту
async function sendManualReminder(id, name) {
    if (!confirm(`Отправить напоминание клиенту "${name}"?`)) return;

    try {
        showNotification('Отправка напоминания...', 'info');
        const res = await fetch(`${API_BASE}/api/clients/${id}/remind`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await res.json();

        if (res.ok) {
            showNotification(`Напоминание отправлено клиенту "${name}"`, 'success');
            loadStats();
            loadClients();
        } else {
            showNotification(data.error || 'Ошибка отправки', 'error');
        }
    } catch (error) {
        console.error('Ошибка отправки напоминания:', error);
        showNotification('Ошибка отправки напоминания', 'error');
    }
}

// Редактирование клиента (упрощенная версия)
function editClient(id) {
    showNotification('Функция редактирования в разработке', 'info');
}

// Поиск с задержкой
function debounceSearch() {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
        loadClients(1);
    }, 500);
}

// Форматирование даты
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU');
}

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
    notification.className = `${colors[type]} text-white px-6 py-4 rounded-lg shadow-lg flex items-center space-x-3 fade-in max-w-md`;
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

// Переключение меню пользователя
function toggleUserMenu() {
    const menu = document.getElementById('userMenu');
    menu.classList.toggle('hidden');
}

// Закрытие меню при клике вне его
document.addEventListener('click', (e) => {
    const menu = document.getElementById('userMenu');
    const button = event.target.closest('button');

    if (menu && !menu.contains(e.target) && (!button || !button.onclick || button.onclick.toString().indexOf('toggleUserMenu') === -1)) {
        menu.classList.add('hidden');
    }
});
