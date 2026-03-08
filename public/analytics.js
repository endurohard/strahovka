const API_URL = "";
let token = localStorage.getItem("authToken");
if (!token) window.location.href = "/login.html";
const headers = { "Content-Type": "application/json", "Authorization": "Bearer " + token };
const categoryNames = { salary: "Зарплата", rent: "Аренда", bonus: "Премия", maintenance: "Техничка", internet: "Интернет", other: "Прочее" };

function formatMoney(a) { return new Intl.NumberFormat("ru-RU").format(a) + " Р"; }

function setThisMonth() {
    const n = new Date();
    document.getElementById("start_date").value = new Date(n.getFullYear(), n.getMonth(), 1).toISOString().split("T")[0];
    document.getElementById("end_date").value = n.toISOString().split("T")[0];
    loadAnalytics();
}

function setLastMonth() {
    const n = new Date();
    document.getElementById("start_date").value = new Date(n.getFullYear(), n.getMonth() - 1, 1).toISOString().split("T")[0];
    document.getElementById("end_date").value = new Date(n.getFullYear(), n.getMonth(), 0).toISOString().split("T")[0];
    loadAnalytics();
}

async function loadAnalytics() {
    const s = document.getElementById("start_date").value;
    const e = document.getElementById("end_date").value;
    try {
        const r = await fetch(API_URL + "/api/analytics?start_date=" + s + "&end_date=" + e, { headers });
        const d = await r.json();

        // Основные показатели
        document.getElementById("total-policies").textContent = d.summary.totalPolicies;
        document.getElementById("total-income").textContent = formatMoney(d.summary.totalIncome);
        document.getElementById("insurance-expenses").textContent = formatMoney(d.summary.insuranceExpenses || 0);
        document.getElementById("gross-profit").textContent = formatMoney(d.summary.grossProfit || 0);

        // Расходы
        document.getElementById("employee-expenses").textContent = formatMoney(d.summary.employeeExpenses);
        document.getElementById("salary-expenses").textContent = formatMoney(d.summary.salaryExpenses || 0);
        document.getElementById("other-expenses").textContent = formatMoney(d.summary.otherExpenses);
        document.getElementById("net-profit").textContent = formatMoney(d.summary.netProfit);

        // Таблица сотрудников
        document.getElementById("employees-table").innerHTML = d.byEmployee.map(x =>
            "<tr class='border-t'><td class='py-2 font-medium'>" + x.employee_name + "</td><td class='text-gray-500'>" + x.policies_count + "</td><td class='text-orange-600 font-bold'>" + formatMoney(x.total_expense) + "</td></tr>"
        ).join("") || "<tr><td colspan='3' class='text-gray-500 py-4'>Нет данных</td></tr>";

        // Сводка расходов по категориям
        document.getElementById("expenses-summary").innerHTML = d.expensesByCategory.map(x =>
            "<div class='flex justify-between'><span>" + (categoryNames[x.category] || x.category) + "</span><span class='font-medium'>" + formatMoney(x.total) + "</span></div>"
        ).join("") || "<p class='text-gray-500'>Нет расходов</p>";

        loadExpenses(s, e);
    } catch (err) { console.error(err); }
}

async function loadExpenses(s, e) {
    try {
        const r = await fetch(API_URL + "/api/expenses?start_date=" + s + "&end_date=" + e, { headers });
        const exp = await r.json();
        document.getElementById("expenses-table").innerHTML = exp.map(x =>
            "<tr class='border-t'><td class='py-2'>" + new Date(x.expense_date).toLocaleDateString("ru-RU") + "</td><td>" + (categoryNames[x.category] || x.category) + "</td><td>" + (x.description || "-") + "</td><td>" + formatMoney(x.amount) + "</td><td><button onclick='deleteExpense(" + x.id + ")' class='text-red-500 hover:text-red-700'><i class='fas fa-trash'></i></button></td></tr>"
        ).join("") || "<tr><td colspan='5' class='text-gray-500 py-4'>Нет расходов</td></tr>";
    } catch (err) { console.error(err); }
}

function showAddEmployeeModal() { document.getElementById("add-employee-modal").classList.remove("hidden"); }
function hideAddEmployeeModal() { document.getElementById("add-employee-modal").classList.add("hidden"); }
function showAddExpenseModal() { document.getElementById("expense-date").value = new Date().toISOString().split("T")[0]; document.getElementById("add-expense-modal").classList.remove("hidden"); }
function hideAddExpenseModal() { document.getElementById("add-expense-modal").classList.add("hidden"); }

async function addEmployee() {
    const name = document.getElementById("employee-name").value;
    const phone = document.getElementById("employee-phone").value;
    if (!name) { alert("Введите имя"); return; }
    try {
        const r = await fetch(API_URL + "/api/employees", { method: "POST", headers, body: JSON.stringify({ name, phone }) });
        if (!r.ok) { const d = await r.json(); alert(d.error || "Ошибка добавления сотрудника"); return; }
        hideAddEmployeeModal();
        document.getElementById("employee-name").value = "";
        document.getElementById("employee-phone").value = "";
        loadAnalytics();
    } catch (err) { console.error(err); alert("Ошибка соединения с сервером"); }
}

async function addExpense() {
    const expense_date = document.getElementById("expense-date").value;
    const category = document.getElementById("expense-category").value;
    const description = document.getElementById("expense-description").value;
    const amount = parseFloat(document.getElementById("expense-amount").value);
    if (!expense_date || !amount) { alert("Заполните дату и сумму"); return; }
    try {
        const r = await fetch(API_URL + "/api/expenses", { method: "POST", headers, body: JSON.stringify({ expense_date, category, description, amount }) });
        if (!r.ok) { const d = await r.json(); alert(d.error || "Ошибка добавления расхода"); return; }
        hideAddExpenseModal();
        document.getElementById("expense-description").value = "";
        document.getElementById("expense-amount").value = "";
        loadAnalytics();
    } catch (err) { console.error(err); alert("Ошибка соединения с сервером"); }
}

async function deleteExpense(id) {
    if (!confirm("Удалить этот расход?")) return;
    await fetch(API_URL + "/api/expenses/" + id, { method: "DELETE", headers });
    loadAnalytics();
}

// По умолчанию — с начала года до сегодня
(function() {
    const n = new Date();
    document.getElementById("start_date").value = new Date(n.getFullYear(), 0, 1).toISOString().split("T")[0];
    document.getElementById("end_date").value = n.toISOString().split("T")[0];
    loadAnalytics();
})();
