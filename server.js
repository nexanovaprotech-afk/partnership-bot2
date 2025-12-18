const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const ADMIN_PASSWORD = 'admin123';
const PRESET_ADMIN_ID = null;

let ADMIN_TELEGRAM_ID = PRESET_ADMIN_ID;

// INITIAL DEBTS
const INITIAL_DEBTS = {
    A: 66250,  // Bhargav
    B: 66250,  // Sagar
    C: 17450   // Bharat
};

const TOTAL_DEBT = INITIAL_DEBTS.A + INITIAL_DEBTS.B + INITIAL_DEBTS.C;

// SHAREHOLDING (for dividing total payment)
const SHAREHOLDING = {
    A: 0.30,  // Bhargav 30%
    B: 0.30,  // Sagar 30%
    C: 0.40   // Bharat 40%
};

let state = {
    totalDebtPaid: 0,
    totalSalaryPaid: 0,
    totalExtraPayments: 0,
    extraPayments: { A: 0, B: 0, C: 0 },
    payments: [],
    initialDebts: INITIAL_DEBTS
};

function isAdmin(telegramId) {
    if (!ADMIN_TELEGRAM_ID) return false;
    return telegramId?.toString() === ADMIN_TELEGRAM_ID?.toString();
}

// CORRECT CALCULATION:
// 1. Divide payment by shareholding (30/30/40) - each partner gets their share
// 2. Calculate debt clear rate: ensures 50% of total payment goes to Person X
// 3. Each partner pays debt based on THEIR debt amount × clear rate
// 4. Each partner keeps salary = Their share - Their debt payment
// Result: Bharat gets HIGHER salary (40% share, low debt)
//         Everyone clears debt at SAME % rate
function calculatePartnerDetails(amount) {
    // Step 1: Divide by shareholding
    const shareA = amount * SHAREHOLDING.A;  // 30%
    const shareB = amount * SHAREHOLDING.B;  // 30%
    const shareC = amount * SHAREHOLDING.C;  // 40%

    // Step 2: Calculate debt clear rate (ensures 50% to Person X)
    const debtClearRate = (amount * 0.5) / TOTAL_DEBT;  // as decimal (e.g., 0.066689)

    // Step 3: Calculate debt payments (each partner pays their debt × clear rate)
    const debtA = INITIAL_DEBTS.A * debtClearRate;
    const debtB = INITIAL_DEBTS.B * debtClearRate;
    const debtC = INITIAL_DEBTS.C * debtClearRate;

    // Step 4: Calculate salaries (share - debt)
    const salaryA = shareA - debtA;
    const salaryB = shareB - debtB;
    const salaryC = shareC - debtC;

    return {
        A: { share: shareA, debt: debtA, salary: salaryA },
        B: { share: shareB, debt: debtB, salary: salaryB },
        C: { share: shareC, debt: debtC, salary: salaryC },
        debtClearRate: debtClearRate * 100  // as percentage
    };
}

app.get('/api/state', (req, res) => {
    res.json(state);
});

app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json({
        history: state.payments.slice(-limit).reverse(),
        totalDebtPaid: state.totalDebtPaid,
        totalSalaryPaid: state.totalSalaryPaid,
        totalExtraPayments: state.totalExtraPayments,
        extraPayments: state.extraPayments
    });
});

// POST: Record regular payment
app.post('/api/payment', (req, res) => {
    const { amount, recordedBy, telegramId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    const partnerDetails = calculatePartnerDetails(amount);

    const toPersonX = partnerDetails.A.debt + partnerDetails.B.debt + partnerDetails.C.debt;
    const toSalary = partnerDetails.A.salary + partnerDetails.B.salary + partnerDetails.C.salary;

    state.totalDebtPaid += toPersonX;
    state.totalSalaryPaid += toSalary;

    state.payments.push({
        type: 'regular',
        amount: parseFloat(amount),
        toPersonX,
        toSalary,
        partnerDetails,
        recordedBy: recordedBy || 'Unknown',
        timestamp: new Date().toISOString(),
        telegramId
    });

    console.log(`💰 Payment: ₹${amount}`);
    console.log(`   Debt Clear Rate: ${partnerDetails.debtClearRate.toFixed(4)}%`);
    console.log(`   Bhargav (30%): Share ₹${partnerDetails.A.share.toFixed(2)} → Debt ₹${partnerDetails.A.debt.toFixed(2)} + Salary ₹${partnerDetails.A.salary.toFixed(2)}`);
    console.log(`   Sagar (30%): Share ₹${partnerDetails.B.share.toFixed(2)} → Debt ₹${partnerDetails.B.debt.toFixed(2)} + Salary ₹${partnerDetails.B.salary.toFixed(2)}`);
    console.log(`   Bharat (40%): Share ₹${partnerDetails.C.share.toFixed(2)} → Debt ₹${partnerDetails.C.debt.toFixed(2)} + Salary ₹${partnerDetails.C.salary.toFixed(2)}`);
    console.log(`   Total: Debt ₹${toPersonX.toFixed(2)} (50%) | Salary ₹${toSalary.toFixed(2)} (50%)`);

    res.json({ 
        success: true, 
        state: { 
            totalDebtPaid: state.totalDebtPaid, 
            totalSalaryPaid: state.totalSalaryPaid 
        } 
    });
});

// POST: Record extra payment by partner
app.post('/api/extra-payment', (req, res) => {
    const { partner, amount, recordedBy, telegramId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!partner || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid input' });
    }

    if (!['A', 'B', 'C'].includes(partner)) {
        return res.status(400).json({ error: 'Invalid partner' });
    }

    state.extraPayments[partner] += parseFloat(amount);
    state.totalExtraPayments += parseFloat(amount);

    state.payments.push({
        type: 'extra',
        partner,
        amount: parseFloat(amount),
        recordedBy: recordedBy || 'Unknown',
        timestamp: new Date().toISOString(),
        telegramId
    });

    const partnerNames = { A: 'Bhargav', B: 'Sagar', C: 'Bharat' };
    console.log(`💵 Extra Payment: ₹${amount} by ${partnerNames[partner]}`);

    res.json({ 
        success: true, 
        extraPayments: state.extraPayments,
        totalExtraPayments: state.totalExtraPayments
    });
});

app.post('/api/admin/login', (req, res) => {
    const { password, telegramId } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
    if (!ADMIN_TELEGRAM_ID && telegramId) {
        ADMIN_TELEGRAM_ID = telegramId.toString();
        return res.json({ success: true, isAdmin: true });
    }
    if (isAdmin(telegramId)) return res.json({ success: true, isAdmin: true });
    res.status(403).json({ error: 'Admin already set' });
});

app.get('/api/admin/check', (req, res) => {
    res.json({ isAdmin: isAdmin(req.query.telegramId), hasAdmin: !!ADMIN_TELEGRAM_ID });
});

app.post('/api/admin/reset', (req, res) => {
    const { password, telegramId } = req.body;
    if (password !== ADMIN_PASSWORD || !isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    state = { 
        totalDebtPaid: 0, 
        totalSalaryPaid: 0, 
        totalExtraPayments: 0,
        extraPayments: { A: 0, B: 0, C: 0 },
        payments: [], 
        initialDebts: INITIAL_DEBTS 
    };
    res.json({ success: true });
});

app.listen(process.env.PORT || 10000, () => {
    console.log('🚀 Partnership Calculator Server (FINAL CORRECTED)');
    console.log('💰 Total Debt: ₹' + TOTAL_DEBT.toLocaleString());
    console.log('   • Bhargav: ₹66,250 (30% shareholding)');
    console.log('   • Sagar: ₹66,250 (30% shareholding)');
    console.log('   • Bharat: ₹17,450 (40% shareholding)');
    console.log('📊 Logic:');
    console.log('   1. Divide payment by shareholding (30/30/40)');
    console.log('   2. Calculate debt clear rate (ensures 50% to Person X)');
    console.log('   3. Each pays: their_debt × clear_rate');
    console.log('   4. Each keeps: their_share - their_debt_payment');
    console.log('✅ Bharat gets HIGHER salary (40% share, low debt)');
    console.log('✅ All partners clear debt at SAME % rate!');
});
