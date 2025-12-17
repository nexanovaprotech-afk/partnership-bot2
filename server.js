const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage (persists while server runs)
// For production, replace with MongoDB/PostgreSQL
let data = {
  debts: {
    A: 68500,  // Bhargav
    B: 68500,  // Sagar
    C: 19700   // Bharat
  },
  totals: {
    debtPaid: 0,
    salaryPaid: 0
  },
  payments: [] // Array of all payment records
};

// Percentages
const DEBT_PCT = { A: 46.2837837837, B: 46.2837837837, C: 7.43243243243 };
const SALARY_PCT = { A: 13.7162162162, B: 13.7162162162, C: 72.5675675675 };

// Routes

// Get current state
app.get('/api/state', (req, res) => {
  res.json(data);
});

// Add new payment
app.post('/api/payment', (req, res) => {
  const { amount, user } = req.body;
  const amt = parseFloat(amount);

  if (!amt || amt <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  // Calculate splits
  const toX = amt * 0.5;
  const salaryPool = amt * 0.5;

  const aDebt = toX * (DEBT_PCT.A / 100);
  const bDebt = toX * (DEBT_PCT.B / 100);
  const cDebt = toX * (DEBT_PCT.C / 100);

  const aSalary = salaryPool * (SALARY_PCT.A / 100);
  const bSalary = salaryPool * (SALARY_PCT.B / 100);
  const cSalary = salaryPool * (SALARY_PCT.C / 100);

  // Update totals
  const totalDebtThis = aDebt + bDebt + cDebt;
  const totalSalaryThis = aSalary + bSalary + cSalary;

  data.totals.debtPaid += totalDebtThis;
  data.totals.salaryPaid += totalSalaryThis;

  // Calculate remaining debts
  const totalInit = data.debts.A + data.debts.B + data.debts.C || 1;
  const shareA = data.debts.A / totalInit;
  const shareB = data.debts.B / totalInit;
  const shareC = data.debts.C / totalInit;

  const aPaidTotal = data.totals.debtPaid * shareA;
  const bPaidTotal = data.totals.debtPaid * shareB;
  const cPaidTotal = data.totals.debtPaid * shareC;

  const aRemain = Math.max(0, data.debts.A - aPaidTotal);
  const bRemain = Math.max(0, data.debts.B - bPaidTotal);
  const cRemain = Math.max(0, data.debts.C - cPaidTotal);

  // Create payment record
  const payment = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    amount: amt,
    toX: Math.round(toX),
    salaryPool: Math.round(salaryPool),
    splits: {
      bhargav: {
        debt: Math.round(aDebt),
        salary: Math.round(aSalary),
        net: Math.round(aSalary - aDebt),
        remaining: Math.round(aRemain)
      },
      sagar: {
        debt: Math.round(bDebt),
        salary: Math.round(bSalary),
        net: Math.round(bSalary - bDebt),
        remaining: Math.round(bRemain)
      },
      bharat: {
        debt: Math.round(cDebt),
        salary: Math.round(cSalary),
        net: Math.round(cSalary - cDebt),
        remaining: Math.round(cRemain)
      }
    },
    user: user || 'Unknown'
  };

  // Store payment
  data.payments.unshift(payment); // Add to beginning
  if (data.payments.length > 100) data.payments.pop(); // Keep last 100

  res.json({
    success: true,
    payment: payment,
    totals: {
      debtPaid: Math.round(data.totals.debtPaid),
      salaryPaid: Math.round(data.totals.salaryPaid)
    }
  });
});

// Get payment history
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json(data.payments.slice(0, limit));
});

// Reset data (admin only - add auth in production)
app.post('/api/reset', (req, res) => {
  const { password } = req.body;

  if (password !== 'admin123') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  data.totals.debtPaid = 0;
  data.totals.salaryPaid = 0;
  data.payments = [];

  res.json({ success: true, message: 'Data reset successfully' });
});

// Update debts (admin only)
app.post('/api/update-debts', (req, res) => {
  const { password, debts } = req.body;

  if (password !== 'admin123') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (debts.A) data.debts.A = parseFloat(debts.A);
  if (debts.B) data.debts.B = parseFloat(debts.B);
  if (debts.C) data.debts.C = parseFloat(debts.C);

  res.json({ success: true, debts: data.debts });
});

// Serve Mini App
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Mini App: http://localhost:${PORT}`);
  console.log(`📊 API: http://localhost:${PORT}/api/state`);
});
