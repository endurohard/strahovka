const XLSX = require('xlsx');
const path = require('path');

// Чтение Excel файла
const filePath = '/Users/bagamedovyusup/Downloads/ЮСУПУ.xlsx';

console.log('Чтение файла:', filePath);

const workbook = XLSX.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

console.log('Название листа:', sheetName);

// Преобразование в JSON
const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

console.log('\nКоличество строк:', data.length);
console.log('\nПервые 10 строк:\n');

data.slice(0, 10).forEach((row, index) => {
  console.log(`Строка ${index + 1}:`, row);
});

// Показываем заголовки если они есть
if (data.length > 0) {
  console.log('\n\nЗаголовки (первая строка):');
  console.log(data[0]);

  console.log('\n\nПример данных (вторая строка):');
  if (data[1]) {
    console.log(data[1]);
  }
}
