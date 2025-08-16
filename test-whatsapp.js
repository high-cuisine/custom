const { 
  useMultiFileAuthState, 
  makeWASocket, 
  DisconnectReason 
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const authFolder = './whatsapp_session';

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log('🔐 Отсканируйте QR код для подключения к WhatsApp');
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp подключен успешно!');
      console.log('📱 Информация о пользователе:', sock.user);
      sendTestMessage(sock);
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log('🔄 Переподключение...');
        setTimeout(() => connectToWhatsApp(), 5000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

async function sendTestMessage(sock) {
  const testNumber = '79123456789@c.us'; // Замените на реальный номер
  try {
    await sock.sendMessage(testNumber, { text: 'Привет, это тестовое сообщение! 🚀' });
    console.log('✅ Тестовое сообщение отправлено!');
  } catch (err) {
    console.error('❌ Ошибка отправки:', err);
  }
}

async function sendCustomMessage(sock, phoneNumber, message) {
  try {
    // Форматируем номер телефона
    let formattedPhone = phoneNumber.replace(/\D/g, '');
    
    // Добавляем код страны если его нет
    if (!formattedPhone.startsWith('7') && !formattedPhone.startsWith('8')) {
      formattedPhone = '7' + formattedPhone;
    }
    
    // Заменяем 8 на 7
    if (formattedPhone.startsWith('8')) {
      formattedPhone = '7' + formattedPhone.substring(1);
    }
    
    const whatsappNumber = formattedPhone + '@c.us';
    
    await sock.sendMessage(whatsappNumber, { text: message });
    console.log(`✅ Сообщение отправлено на номер ${phoneNumber}`);
    return true;
  } catch (err) {
    console.error(`❌ Ошибка отправки на ${phoneNumber}:`, err);
    return false;
  }
}

// Функция для отправки сообщения через командную строку
async function sendMessageFromArgs() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Использование: node test-whatsapp.js <номер_телефона> <сообщение>');
    console.log('Пример: node test-whatsapp.js 79123456789 "Привет!"');
    return;
  }

  const phoneNumber = args[0];
  const message = args[1];

  console.log(`📱 Отправка сообщения на ${phoneNumber}: ${message}`);

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  
  const sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection } = update;

    if (connection === 'open') {
      console.log('✅ WhatsApp подключен, отправляю сообщение...');
      const success = await sendCustomMessage(sock, phoneNumber, message);
      if (success) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

// Проверяем аргументы командной строки
if (process.argv.length > 2) {
  sendMessageFromArgs();
} else {
  console.log('🚀 Запуск WhatsApp клиента...');
  connectToWhatsApp();
} 