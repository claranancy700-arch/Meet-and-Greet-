const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;
const dataPath = path.join(__dirname, 'data', 'store.json');
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'meet-2026-admin';
const MAX_APPOINTMENTS_PER_SLOT = 6;

const initialData = {
  users: [],
  appointments: [],
  tiers: [
    {
      id: 'standard',
      name: 'Standard',
      description: 'Community access with a group meet-and-greet session.',
      priceLabel: 'Free',
      price: 0,
      perks: ['Group greeting', 'Event updates', 'Priority reminder'],
      capacity: 50
    },
    {
      id: 'premium',
      name: 'Premium',
      description: 'Faster entry, private greeting, and a premium photo moment.',
      priceLabel: '$49',
      price: 49,
      perks: ['Private greeting', 'Priority booking', 'Signed gift'],
      capacity: 30
    },
    {
      id: 'vip',
      name: 'VIP',
      description: 'VIP lane, exclusive perks, and a memorable experience.',
      priceLabel: '$129',
      price: 129,
      perks: ['VIP seating', 'Exclusive swag', 'Personal photo session'],
      capacity: 15
    }
  ]
};

function ensureDataDirectory() {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
}

function writeData(data) {
  ensureDataDirectory();
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function ensureDataFile() {
  if (!fs.existsSync(dataPath)) {
    writeData(initialData);
    return;
  }

  try {
    const current = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    if (!current || !Array.isArray(current.tiers) || current.tiers.length === 0) {
      writeData(initialData);
    }
  } catch (error) {
    writeData(initialData);
  }
}

function loadData() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

function saveData(data) {
  writeData(data);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/tiers', (req, res) => {
  const data = loadData();
  res.json(data.tiers);
});

app.get('/api/availability', (req, res) => {
  const { date, time } = req.query;
  if (!date || !time) {
    return res.status(400).json({ error: 'Date and time are required to check availability.' });
  }

  const data = loadData();
  const filled = data.appointments.filter((appointment) => appointment.date === date && appointment.time === time).length;
  res.json({ date, time, capacity: MAX_APPOINTMENTS_PER_SLOT, remaining: Math.max(0, MAX_APPOINTMENTS_PER_SLOT - filled), filled });
});

app.post('/api/register', (req, res) => {
  const { name, email, phone, tierId } = req.body;
  if (!name || !email || !phone || !tierId) {
    return res.status(400).json({ error: 'Name, email, phone, and tier selection are required.' });
  }

  const data = loadData();
  const tier = data.tiers.find((item) => item.id === tierId);
  if (!tier) {
    return res.status(400).json({ error: 'Invalid tier selected.' });
  }

  const existingUser = data.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
  if (existingUser) {
    return res.status(409).json({ error: 'A registration already exists with that email address.' });
  }

  const user = {
    id: `user_${Date.now()}`,
    name,
    email,
    phone,
    tierId,
    tierName: tier.name,
    amountDue: tier.price,
    paymentStatus: tier.price > 0 ? 'pending' : 'free',
    registeredAt: new Date().toISOString()
  };

  data.users.push(user);
  saveData(data);

  res.status(201).json({ user, tier: { id: tier.id, name: tier.name, price: tier.price, priceLabel: tier.priceLabel }, message: 'Registration completed successfully.' });
});

app.post('/api/pay', (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required to complete payment.' });
  }

  const data = loadData();
  const user = data.users.find((item) => item.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'Registered user not found.' });
  }

  if (user.paymentStatus === 'paid') {
    return res.status(400).json({ error: 'Payment has already been completed.' });
  }

  if (user.amountDue <= 0) {
    return res.status(400).json({ error: 'No payment is required for this registration tier.' });
  }

  user.paymentStatus = 'paid';
  user.paidAt = new Date().toISOString();
  saveData(data);

  res.status(200).json({ user, message: 'Payment completed successfully.' });
});

function validateCardNumber(number) {
  const digits = number.replace(/\D/g, '');
  return /^[0-9]{13,19}$/.test(digits);
}

function validateExpiry(expiry) {
  const match = expiry.match(/^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/);
  if (!match) return false;
  const month = Number(match[1]);
  let year = Number(match[2]);
  if (year < 100) year += 2000;
  const expiryDate = new Date(year, month - 1, 1);
  const now = new Date();
  expiryDate.setMonth(expiryDate.getMonth() + 1);
  return expiryDate > now;
}

function getCardBrand(number) {
  const digits = number.replace(/\D/g, '');
  if (/^4/.test(digits)) return 'Visa';
  if (/^5[1-5]/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'American Express';
  if (/^6(?:011|5)/.test(digits)) return 'Discover';
  return 'Card';
}

app.post('/api/mock-payment', (req, res) => {
  const { userId, cardName, cardNumber, expiry, cvc } = req.body;
  if (!userId || !cardName || !cardNumber || !expiry || !cvc) {
    return res.status(400).json({ error: 'All payment fields are required.' });
  }

  if (!validateCardNumber(cardNumber)) {
    return res.status(400).json({ error: 'Invalid card number.' });
  }

  if (!validateExpiry(expiry)) {
    return res.status(400).json({ error: 'Invalid expiry date. Use MM/YY.' });
  }

  if (!/^[0-9]{3,4}$/.test(cvc)) {
    return res.status(400).json({ error: 'Invalid CVC code.' });
  }

  const data = loadData();
  const user = data.users.find((item) => item.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'Registered user not found.' });
  }

  if (user.paymentStatus === 'paid') {
    return res.status(400).json({ error: 'Payment has already been completed.' });
  }

  if (user.amountDue <= 0) {
    return res.status(400).json({ error: 'No payment is required for this registration tier.' });
  }

  const brand = getCardBrand(cardNumber);
  const normalized = cardNumber.replace(/\D/g, '');
  const last4 = normalized.slice(-4);

  user.paymentStatus = 'paid';
  user.paidAt = new Date().toISOString();
  user.paymentMethod = { brand, last4, expiry, cardName };
  saveData(data);

  res.status(200).json({ user, message: `Payment approved by ${brand} Gateway.` });
});

app.post('/api/appointments', (req, res) => {
  const { userId, date, time, notes } = req.body;
  if (!userId || !date || !time) {
    return res.status(400).json({ error: 'User ID, date, and time are required.' });
  }

  const data = loadData();
  const user = data.users.find((item) => item.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'Registered user not found.' });
  }

  if (user.paymentStatus === 'pending') {
    return res.status(402).json({ error: 'Please complete payment before booking an appointment.' });
  }

  const existingAppointment = data.appointments.find((appointment) => appointment.userId === userId);
  if (existingAppointment) {
    return res.status(409).json({ error: 'An appointment is already booked for this registration.' });
  }

  const slotCount = data.appointments.filter((appointment) => appointment.date === date && appointment.time === time).length;
  if (slotCount >= MAX_APPOINTMENTS_PER_SLOT) {
    return res.status(409).json({ error: 'This appointment slot is full. Please choose another time.' });
  }

  const appointment = {
    id: `appt_${Date.now()}`,
    userId,
    name: user.name,
    email: user.email,
    date,
    time,
    notes: notes || '',
    createdAt: new Date().toISOString()
  };

  data.appointments.push(appointment);
  saveData(data);

  res.status(201).json({ appointment, message: 'Appointment booked successfully.' });
});

app.get('/api/users/:email', (req, res) => {
  const data = loadData();
  const user = data.users.find((item) => item.email.toLowerCase() === req.params.email.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  res.json(user);
});

app.get('/api/admin/summary', (req, res) => {
  const adminKey = req.headers['x-admin-secret'] || req.query.adminKey;
  if (adminKey !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Admin access denied.' });
  }

  const data = loadData();
  const outstandingPayments = data.users.filter((user) => user.paymentStatus === 'pending').length;

  res.json({
    stats: {
      totalRegistrations: data.users.length,
      totalAppointments: data.appointments.length,
      outstandingPayments
    },
    users: data.users,
    appointments: data.appointments,
    tiers: data.tiers
  });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Meet & Greet site listening at http://localhost:${port}`);
});
