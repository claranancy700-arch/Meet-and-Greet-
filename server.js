require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;
const dataPath = path.join(__dirname, 'data', 'store.json');
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'meet-2026-admin';
const MAX_APPOINTMENTS_PER_SLOT = 6;
const usePostgres = Boolean(process.env.DATABASE_URL);

const pool = usePostgres
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
    })
  : null;

const initialData = {
  users: [],
  appointments: [],
  tiers: [
    {
      id: 'standard',
      name: 'Standard',
      description: 'Community access with a group meet-and-greet session.',
      priceLabel: '$349.99',
      price: 349.99,
      image: 'images/Standard.jpg',
      perks: ['Group greeting', 'Event updates', 'Priority reminder'],
      capacity: 50
    },
    {
      id: 'premium',
      name: 'Premium',
      description: 'Faster entry, private greeting, and a premium photo moment.',
      priceLabel: '$499.99',
      price: 499.99,
      image: 'images/Premuim.jpg',
      perks: ['Private greeting', 'Priority booking', 'Signed gift'],
      capacity: 30
    },
    {
      id: 'vip',
      name: 'VIP',
      description: 'VIP lane, exclusive perks, and a memorable experience.',
      priceLabel: '$1,299.99',
      price: 1299.99,
      image: 'images/VIP.jpg',
      perks: ['VIP seating', 'Exclusive swag', 'Personal photo session'],
      capacity: 15
    }
  ]
};

async function runQuery(text, params = []) {
  if (!usePostgres) {
    throw new Error('PostgreSQL is not configured.');
  }
  return pool.query(text, params);
}

async function ensureDatabase() {
  if (!usePostgres) return;

  await runQuery(`
    CREATE TABLE IF NOT EXISTS tiers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      priceLabel TEXT NOT NULL,
      price NUMERIC NOT NULL,
      perks JSONB NOT NULL,
      capacity INTEGER NOT NULL
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      tierId TEXT NOT NULL REFERENCES tiers(id),
      tierName TEXT NOT NULL,
      amountDue NUMERIC NOT NULL,
      paymentStatus TEXT NOT NULL,
      registeredAt TIMESTAMPTZ NOT NULL,
      paidAt TIMESTAMPTZ,
      paymentMethod JSONB
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      notes TEXT,
      createdAt TIMESTAMPTZ NOT NULL
    )
  `);

  const existingTiers = await runQuery('SELECT COUNT(*) FROM tiers');
  if (existingTiers.rows[0].count === '0') {
    await Promise.all(
      initialData.tiers.map((tier) =>
        runQuery(
          'INSERT INTO tiers (id, name, description, priceLabel, price, perks, capacity) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [tier.id, tier.name, tier.description, tier.priceLabel, tier.price, JSON.stringify(tier.perks), tier.capacity]
        )
      )
    );
  }
}

function formatTier(row) {
  const seed = initialData.tiers.find((item) => item.id === row.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceLabel: row.pricelabel || row.priceLabel,
    price: Number(row.price),
    image: row.image || seed?.image,
    perks: row.perks || [],
    capacity: Number(row.capacity)
  };
}

function formatUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    tierId: row.tierid || row.tierId,
    tierName: row.tiername || row.tierName,
    amountDue: Number(row.amountdue || row.amountDue),
    paymentStatus: row.paymentstatus || row.paymentStatus,
    registeredAt: row.registeredat || row.registeredAt,
    paidAt: row.paidat || row.paidAt,
    paymentMethod: row.paymentmethod || row.paymentMethod
  };
}

function formatAppointment(row) {
  return {
    id: row.id,
    userId: row.userid || row.userId,
    name: row.name,
    email: row.email,
    date: row.date,
    time: row.time,
    notes: row.notes,
    createdAt: row.createdat || row.createdAt
  };
}

function hashPaymentInput(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function createPaymentPdf(user) {
  const pdfDir = path.join(__dirname, 'data', 'pdfs');
  fs.mkdirSync(pdfDir, { recursive: true });
  const fileName = `gateway-payment-${user.id}.pdf`;
  const filePath = path.join(pdfDir, fileName);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const writeStream = fs.createWriteStream(filePath);

    doc.pipe(writeStream);
    doc.fontSize(18).text('Gateway Payment Details', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(`Name: ${user.name}`);
    doc.text(`Email: ${user.email}`);
    doc.text(`Tier: ${user.tierName}`);
    doc.text(`Amount: $${user.amountDue}`);
    doc.text(`Gateway: ${user.paymentMethod?.gateway || 'GatePay'}`);
    doc.text(`Card brand: ${user.paymentMethod?.brand}`);
    doc.text(`Card number: ${user.paymentMethod?.cardNumber}`);
    doc.text(`Card hash: ${user.paymentMethod?.cardHash}`);
    doc.text(`Paid at: ${user.paidAt}`);
    doc.moveDown();
    doc.text('Note: This file contains hashed gateway payment metadata only.');
    doc.end();

    writeStream.on('finish', () => {
      resolve({
        fileName,
        filePath: `/pdfs/${fileName}`,
        createdAt: new Date().toISOString()
      });
    });
    writeStream.on('error', reject);
  });
}

function withTierImages(tiers) {
  return (tiers || []).map((tier) => {
    const seed = initialData.tiers.find((item) => item.id === tier.id);
    return {
      ...tier,
      image: tier.image || seed?.image
    };
  });
}

async function getAllTiers() {
  if (!usePostgres) {
    return withTierImages(loadData().tiers);
  }
  const result = await runQuery('SELECT * FROM tiers ORDER BY id');
  return result.rows.map(formatTier);
}

async function getTierById(tierId) {
  if (!usePostgres) {
    return withTierImages(loadData().tiers).find((item) => item.id === tierId);
  }
  const result = await runQuery('SELECT * FROM tiers WHERE id = $1', [tierId]);
  return result.rows[0] ? formatTier(result.rows[0]) : null;
}

async function getAllAppointments() {
  if (!usePostgres) {
    return loadData().appointments;
  }
  const result = await runQuery('SELECT * FROM appointments ORDER BY createdAt DESC');
  return result.rows.map(formatAppointment);
}

async function getAllUsers() {
  if (!usePostgres) {
    return loadData().users;
  }
  const result = await runQuery('SELECT * FROM users ORDER BY registeredAt DESC');
  return result.rows.map(formatUser);
}

async function getUserByEmail(email) {
  if (!usePostgres) {
    const data = loadData();
    return data.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
  }
  const result = await runQuery('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  return result.rows[0] ? formatUser(result.rows[0]) : null;
}

async function getUserById(userId) {
  if (!usePostgres) {
    const data = loadData();
    return data.users.find((user) => user.id === userId);
  }
  const result = await runQuery('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0] ? formatUser(result.rows[0]) : null;
}

async function addUser(user) {
  if (!usePostgres) {
    const data = loadData();
    data.users.push(user);
    saveData(data);
    return user;
  }
  await runQuery(
    'INSERT INTO users (id, name, email, phone, tierId, tierName, amountDue, paymentStatus, registeredAt, paidAt, paymentMethod) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [user.id, user.name, user.email.toLowerCase(), user.phone, user.tierId, user.tierName, user.amountDue, user.paymentStatus, user.registeredAt, user.paidAt || null, user.paymentMethod || null]
  );
  return user;
}

async function updateUser(user) {
  if (!usePostgres) {
    const data = loadData();
    const index = data.users.findIndex((item) => item.id === user.id);
    if (index !== -1) {
      data.users[index] = user;
      saveData(data);
    }
    return user;
  }
  await runQuery(
    'UPDATE users SET name=$1, email=$2, phone=$3, tierId=$4, tierName=$5, amountDue=$6, paymentStatus=$7, registeredAt=$8, paidAt=$9, paymentMethod=$10 WHERE id=$11',
    [user.name, user.email.toLowerCase(), user.phone, user.tierId, user.tierName, user.amountDue, user.paymentStatus, user.registeredAt, user.paidAt || null, user.paymentMethod || null, user.id]
  );
  return user;
}

async function addAppointment(appointment) {
  if (!usePostgres) {
    const data = loadData();
    data.appointments.push(appointment);
    saveData(data);
    return appointment;
  }
  await runQuery(
    'INSERT INTO appointments (id, userId, name, email, date, time, notes, createdAt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [appointment.id, appointment.userId, appointment.name, appointment.email, appointment.date, appointment.time, appointment.notes, appointment.createdAt]
  );
  return appointment;
}

async function getSummaryData() {
  if (!usePostgres) {
    const data = loadData();
    return { users: data.users, appointments: data.appointments, tiers: data.tiers };
  }
  const [usersResult, appointmentsResult, tiersResult] = await Promise.all([
    runQuery('SELECT * FROM users ORDER BY registeredAt DESC'),
    runQuery('SELECT * FROM appointments ORDER BY createdAt DESC'),
    runQuery('SELECT * FROM tiers ORDER BY id')
  ]);
  return {
    users: usersResult.rows.map(formatUser),
    appointments: appointmentsResult.rows.map(formatAppointment),
    tiers: tiersResult.rows.map(formatTier)
  };
}

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
app.use('/pdfs', express.static(path.join(__dirname, 'data', 'pdfs')));

app.get('/api/tiers', async (req, res) => {
  try {
    const tiers = await getAllTiers();
    res.json(tiers);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load tiers.' });
  }
});

app.get('/api/availability', async (req, res) => {
  const { date, time } = req.query;
  if (!date || !time) {
    return res.status(400).json({ error: 'Date and time are required to check availability.' });
  }

  try {
    const appointments = await getAllAppointments();
    const filled = appointments.filter((appointment) => appointment.date === date && appointment.time === time).length;
    res.json({ date, time, capacity: MAX_APPOINTMENTS_PER_SLOT, remaining: Math.max(0, MAX_APPOINTMENTS_PER_SLOT - filled), filled });
  } catch (error) {
    res.status(500).json({ error: 'Unable to check availability.' });
  }
});

app.post('/api/register', async (req, res) => {
  const { name, email, phone, tierId } = req.body;
  if (!name || !email || !phone || !tierId) {
    return res.status(400).json({ error: 'Name, email, phone, and tier selection are required.' });
  }

  try {
    const tier = await getTierById(tierId);
    if (!tier) {
      return res.status(400).json({ error: 'Invalid tier selected.' });
    }

    const existingUser = await getUserByEmail(email);
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

    await addUser(user);
    res.status(201).json({ user, tier: { id: tier.id, name: tier.name, price: tier.price, priceLabel: tier.priceLabel }, message: 'Registration completed successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Unable to complete registration.' });
  }
});

app.post('/api/pay', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required to complete payment.' });
  }

  try {
    const user = await getUserById(userId);
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
    await updateUser(user);

    res.status(200).json({ user, message: 'Payment completed successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Unable to complete payment.' });
  }
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

app.post('/api/mock-payment', async (req, res) => {
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

  try {
    const user = await getUserById(userId);
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
    const cardHash = hashPaymentInput(normalized);

    user.paymentStatus = 'paid';
    user.paidAt = new Date().toISOString();
    user.paymentMethod = {
      brand,
      cardNumber: normalized,
      last4,
      expiry,
      cardName,
      gateway: 'GatePay',
      cardHash
    };

    const pdfMeta = await createPaymentPdf(user);
    user.paymentMethod.pdf = pdfMeta;

    await updateUser(user);

    res.status(200).json({ user, message: `Payment approved by ${brand} Gateway.` });
  } catch (error) {
    res.status(500).json({ error: 'Unable to process payment.' });
  }
});

app.post('/api/appointments', async (req, res) => {
  const { userId, date, time, notes } = req.body;
  if (!userId || !date || !time) {
    return res.status(400).json({ error: 'User ID, date, and time are required.' });
  }

  try {
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Registered user not found.' });
    }

    if (user.paymentStatus === 'pending') {
      return res.status(402).json({ error: 'Please complete payment before booking an appointment.' });
    }

    const appointments = await getAllAppointments();

    const existingAppointment = appointments.find((appointment) => appointment.userId === userId);
    if (existingAppointment) {
      return res.status(409).json({ error: 'An appointment is already booked for this registration.' });
    }

    const slotCount = appointments.filter((appointment) => appointment.date === date && appointment.time === time).length;
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

    await addAppointment(appointment);
    res.status(201).json({ appointment, message: 'Appointment booked successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Unable to book appointment.' });
  }
});

app.get('/api/users/:email', async (req, res) => {
  try {
    const user = await getUserByEmail(req.params.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load user.' });
  }
});

app.get('/api/admin/summary', async (req, res) => {
  const adminKey = req.headers['x-admin-secret'] || req.query.adminKey;
  if (adminKey !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Admin access denied.' });
  }

  try {
    const data = await getSummaryData();
    const outstandingPayments = data.users.filter((user) => user.paymentStatus === 'pending').length;
    const gatewayPdfDetails = data.users
      .filter((user) => user.paymentMethod?.pdf)
      .map((user) => ({
        name: user.name,
        email: user.email,
        tier: user.tierName,
        gateway: user.paymentMethod?.gateway || 'GatePay',
        last4: user.paymentMethod?.last4 || '',
        cardHash: user.paymentMethod?.cardHash || '',
        pdfFileName: user.paymentMethod.pdf.fileName,
        pdfPath: user.paymentMethod.pdf.filePath,
        createdAt: user.paymentMethod.pdf.createdAt
      }));

    res.json({
      stats: {
        totalRegistrations: data.users.length,
        totalAppointments: data.appointments.length,
        outstandingPayments
      },
      users: data.users,
      appointments: data.appointments,
      tiers: data.tiers,
      gatewayPdfDetails
    });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load admin summary.' });
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function startServer() {
  try {
    await ensureDatabase();
    app.listen(port, () => {
      console.log(`Meet & Greet site listening at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

startServer();
