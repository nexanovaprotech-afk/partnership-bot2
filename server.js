const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const ADMIN_PASSWORD = 'admin123';
const PRESET_ADMIN_ID = null;

let ADMIN_TELEGRAM_ID = PRESET_ADMIN_ID;

// APPROVED USERS (for private access)
let approvedUsers = new Set();
let pendingApprovals = [];

// Partnership configuration storage
let partnershipsConfig = { "Bhargav": 30, "Sagar": 30, "Bharat": 40 };

// DYNAMIC PARTNERS CONFIGURATION
let PARTNERS = {
    A: { name: 'Bhargav', debt: 66250, share: 0.30 },
    B: { name: 'Sagar', debt: 66250, share: 0.30 },
    C: { name: 'Bharat', debt: 17450, share: 0.40 }
};

let state = {
    totalDebtPaid: 0,
    totalSalaryPaid: 0,
    totalExtraPayments: 0,
    extraPayments: { A: 0, B: 0, C: 0 },
    payments: [],
    debtFullyPaid: false
};

function getTotalDebt() {
    return Object.values(PARTNERS).reduce((sum, p) => sum + p.debt, 0);
}

function getTotalShare() {
    return Object.values(PARTNERS).reduce((sum, p) => sum + p.share, 0);
}

function isAdmin(telegramId) {
    if (!ADMIN_TELEGRAM_ID) return false;
    return telegramId?.toString() === ADMIN_TELEGRAM_ID?.toString();
}

function isApprovedUser(telegramId) {
    if (isAdmin(telegramId)) return true;
    return approvedUsers.has(telegramId?.toString());
}

function getRemainingDebt() {
    const totalDebt = getTotalDebt();
    const totalPaid = state.totalDebtPaid + state.totalExtraPayments;
    return Math.max(0, totalDebt - totalPaid);
}

function calculateIndividualDebtPaid() {
    const totalDebt = getTotalDebt();
    if (totalDebt === 0) {
        const result = {};
        Object.keys(PARTNERS).forEach(key => result[key] = 0);
        return result;
    }

    const debtClearRate = state.totalDebtPaid / totalDebt;
    const result = {};

    Object.keys(PARTNERS).forEach(key => {
        result[key] = PARTNERS[key].debt * debtClearRate;
    });

    return result;
}

function calculatePartnerDetails(amount) {
    const totalDebt = getTotalDebt();
    const remainingDebt = getRemainingDebt();

    const partnerShares = {};
    const partnerDebts = {};
    const partnerSalaries = {};

    Object.keys(PARTNERS).forEach(key => {
        partnerShares[key] = amount * PARTNERS[key].share;
    });

    let toPersonX, toSalary;
    let debtClearRate;

    if (remainingDebt <= 0) {
        Object.keys(PARTNERS).forEach(key => {
            partnerDebts[key] = 0;
            partnerSalaries[key] = partnerShares[key];
        });
        toPersonX = 0;
        toSalary = amount;
        debtClearRate = 0;
    } else if (remainingDebt < amount * 0.5) {
        debtClearRate = remainingDebt / totalDebt;

        Object.keys(PARTNERS).forEach(key => {
            partnerDebts[key] = PARTNERS[key].debt * debtClearRate;
            partnerSalaries[key] = partnerShares[key] - partnerDebts[key];
        });

        toPersonX = remainingDebt;
        toSalary = amount - remainingDebt;
    } else {
        debtClearRate = (amount * 0.5) / totalDebt;

        Object.keys(PARTNERS).forEach(key => {
            partnerDebts[key] = PARTNERS[key].debt * debtClearRate;
            partnerSalaries[key] = partnerShares[key] - partnerDebts[key];
        });

        toPersonX = Object.values(partnerDebts).reduce((sum, d) => sum + d, 0);
        toSalary = Object.values(partnerSalaries).reduce((sum, s) => sum + s, 0);
    }

    const details = {};
    Object.keys(PARTNERS).forEach(key => {
        details[key] = {
            share: partnerShares[key],
            debt: partnerDebts[key],
            salary: partnerSalaries[key]
        };
    });

    return {
        partners: details,
        debtClearRate: debtClearRate * 100,
        toPersonX,
        toSalary,
        isDebtComplete: remainingDebt <= toPersonX
    };
}

function recalculateState() {
    state.totalDebtPaid = 0;
    state.totalSalaryPaid = 0;
    state.totalExtraPayments = 0;

    // Reset extra payments for all partners
    state.extraPayments = {};
    Object.keys(PARTNERS).forEach(key => {
        state.extraPayments[key] = 0;
    });

    for (let payment of state.payments) {
        if (payment.type === 'regular') {
            const details = calculatePartnerDetails(payment.amount);
            payment.toPersonX = details.toPersonX;
            payment.toSalary = details.toSalary;
            payment.partnerDetails = details.partners;

            state.totalDebtPaid += details.toPersonX;
            state.totalSalaryPaid += details.toSalary;
        } else if (payment.type === 'extra') {
            if (state.extraPayments[payment.partner] !== undefined) {
                state.extraPayments[payment.partner] += payment.amount;
                state.totalExtraPayments += payment.amount;
            }
        }
    }

    state.debtFullyPaid = getRemainingDebt() <= 0;
}

function getMonthlyBreakdown(month, year) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const monthlyPayments = state.payments.filter(p => {
        if (p.paymentStartDate && p.paymentEndDate) {
            const pStart = new Date(p.paymentStartDate);
            const pEnd = new Date(p.paymentEndDate);
            return (pStart <= endDate && pEnd >= startDate);
        } else {
            const paymentDate = new Date(p.timestamp);
            return paymentDate >= startDate && paymentDate <= endDate;
        }
    });

    let totalAmount = 0;
    let debtPaid = 0;

    const salaries = {};
    Object.keys(PARTNERS).forEach(key => {
        salaries[key] = 0;
    });

    for (let payment of monthlyPayments) {
        if (payment.type === 'regular') {
            totalAmount += payment.amount;
            Object.keys(PARTNERS).forEach(key => {
                if (payment.partnerDetails && payment.partnerDetails[key]) {
                    salaries[key] += payment.partnerDetails[key].salary;
                }
            });
            debtPaid += payment.toPersonX;
        }
    }

    return {
        month,
        year,
        totalPayments: monthlyPayments.length,
        totalAmount,
        debtPaid,
        totalSalary: totalAmount - debtPaid,
        salaries,
        payments: monthlyPayments
    };
}

// ACCESS CONTROL ENDPOINTS
app.post('/api/access/request', (req, res) => {
    const { telegramId, userName } = req.body;

    if (!telegramId) {
        return res.status(400).json({ error: 'Telegram ID required' });
    }

    if (isApprovedUser(telegramId)) {
        return res.json({ approved: true });
    }

    const alreadyPending = pendingApprovals.find(p => p.telegramId === telegramId);
    if (alreadyPending) {
        return res.json({ pending: true, message: 'Request pending approval' });
    }

    pendingApprovals.push({
        telegramId: telegramId.toString(),
        userName: userName || 'Unknown User',
        requestedAt: new Date().toISOString()
    });

    console.log('🔔 NEW ACCESS REQUEST: ' + userName);
    res.json({ pending: true, message: 'Access request sent to admin' });
});

app.get('/api/access/pending', (req, res) => {
    const { telegramId } = req.query;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    res.json({ pending: pendingApprovals });
});

app.post('/api/access/approve', (req, res) => {
    const { telegramId, userId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    approvedUsers.add(userId.toString());
    pendingApprovals = pendingApprovals.filter(p => p.telegramId !== userId);

    console.log('✅ User approved: ' + userId);
    res.json({ success: true });
});

app.post('/api/access/reject', (req, res) => {
    const { telegramId, userId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    pendingApprovals = pendingApprovals.filter(p => p.telegramId !== userId);
    console.log('❌ User rejected: ' + userId);
    res.json({ success: true });
});

// STATE & CONFIG ENDPOINTS
app.get('/api/state', (req, res) => {
    const { telegramId } = req.query;

    if (!isApprovedUser(telegramId)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const debtPaid = calculateIndividualDebtPaid();
    const remainingDebt = getRemainingDebt();

    res.json({
        ...state,
        debtPaid,
        remainingDebt,
        partners: PARTNERS,
        debtFullyPaid: state.debtFullyPaid
    });
});

app.get('/api/config', (req, res) => {
    res.json({
        partners: PARTNERS,
        initialDebts: { 
            A: PARTNERS.A.debt, 
            B: PARTNERS.B.debt, 
            C: PARTNERS.C.debt 
        }
    });
});

// UPDATE PARTNERS CONFIGURATION
app.post('/api/config/partners', (req, res) => {
    const { partners, telegramId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!partners || typeof partners !== 'object') {
        return res.status(400).json({ error: 'Invalid partners configuration' });
    }

    // Validate total share = 1.0 (100%)
    const totalShare = Object.values(partners).reduce((sum, p) => sum + p.share, 0);
    if (Math.abs(totalShare - 1.0) > 0.01) {
        return res.status(400).json({ error: 'Total share must equal 100%' });
    }

    PARTNERS = partners;

    // Update extra payments for new/removed partners
    const newExtraPayments = {};
    Object.keys(PARTNERS).forEach(key => {
        newExtraPayments[key] = state.extraPayments[key] || 0;
    });
    state.extraPayments = newExtraPayments;

    recalculateState();

    console.log('⚙️ Partners Configuration Updated');
    res.json({ success: true, partners: PARTNERS });
});


// UPDATE INITIAL DEBTS
app.post('/api/config/debts', (req, res) => {
    const { debtA, debtB, debtC, telegramId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (debtA === undefined || debtB === undefined || debtC === undefined) {
        return res.status(400).json({ error: 'All debt values required' });
    }

    // Update initial debts for all partners
    PARTNERS.A.debt = parseFloat(debtA);
    PARTNERS.B.debt = parseFloat(debtB);
    PARTNERS.C.debt = parseFloat(debtC);

    // Recalculate everything with new debt values
    recalculateState();

    console.log('⚙️ Initial Debts Updated');
    console.log(`  ${PARTNERS.A.name}: ₹${debtA}`);
    console.log(`  ${PARTNERS.B.name}: ₹${debtB}`);
    console.log(`  ${PARTNERS.C.name}: ₹${debtC}`);

    res.json({ success: true, partners: PARTNERS });
});

// PAYMENT ENDPOINTS
app.get('/api/history', (req, res) => {
    const { telegramId, limit } = req.query;

    if (!isApprovedUser(telegramId)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const limitNum = parseInt(limit) || 50;
    const debtPaid = calculateIndividualDebtPaid();

    res.json({
        history: state.payments.slice(-limitNum).reverse(),
        totalDebtPaid: state.totalDebtPaid,
        totalSalaryPaid: state.totalSalaryPaid,
        totalExtraPayments: state.totalExtraPayments,
        extraPayments: state.extraPayments,
        debtPaid,
        debtFullyPaid: state.debtFullyPaid,
        partners: PARTNERS
    });
});

app.get('/api/monthly', (req, res) => {
    const { telegramId, month, year } = req.query;

    if (!isApprovedUser(telegramId)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const monthNum = parseInt(month);
    const yearNum = parseInt(year);

    if (!monthNum || !yearNum) {
        return res.status(400).json({ error: 'Month and year required' });
    }

    const breakdown = getMonthlyBreakdown(monthNum, yearNum);
    res.json(breakdown);
});

app.post('/api/payment', (req, res) => {
    const { amount, recordedBy, telegramId, comment, paymentStartDate, paymentEndDate } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    if (paymentStartDate && paymentEndDate) {
        const startDate = new Date(paymentStartDate);
        const endDate = new Date(paymentEndDate);

        if (startDate > endDate) {
            return res.status(400).json({ error: 'Start date must be before end date' });
        }
    }

    const partnerDetails = calculatePartnerDetails(amount);
    const paymentId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

    state.payments.push({
        id: paymentId,
        type: 'regular',
        amount: parseFloat(amount),
        toPersonX: partnerDetails.toPersonX,
        toSalary: partnerDetails.toSalary,
        partnerDetails: partnerDetails.partners,
        recordedBy: recordedBy || 'Unknown',
        timestamp: new Date().toISOString(),
        telegramId,
        comment: comment || '',
        paymentStartDate: paymentStartDate || null,
        paymentEndDate: paymentEndDate || null
    });

    state.totalDebtPaid += partnerDetails.toPersonX;
    state.totalSalaryPaid += partnerDetails.toSalary;
    state.debtFullyPaid = getRemainingDebt() <= 0;

    console.log(`💰 Payment: ₹${amount}`);
    if (comment) console.log(`   💬 Comment: ${comment}`);

    res.json({ success: true });
});

app.put('/api/payment/:id', (req, res) => {
    const { id } = req.params;
    const { amount, comment, telegramId, paymentStartDate, paymentEndDate } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const payment = state.payments.find(p => p.id === id);

    if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.type === 'regular') {
        payment.amount = parseFloat(amount);
        payment.comment = comment || '';
        payment.paymentStartDate = paymentStartDate || null;
        payment.paymentEndDate = paymentEndDate || null;
        payment.editedAt = new Date().toISOString();

        recalculateState();
        console.log(`✏️ Payment edited: ID ${id}`);
    } else {
        payment.amount = parseFloat(amount);
        payment.comment = comment || '';
        payment.editedAt = new Date().toISOString();
        recalculateState();
    }

    res.json({ success: true });
});

app.post('/api/extra-payment', (req, res) => {
    const { partner, amount, recordedBy, telegramId, comment } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!partner || !PARTNERS[partner]) {
        return res.status(400).json({ error: 'Invalid partner' });
    }

    if (amount === undefined || amount === null) {
        return res.status(400).json({ error: 'Amount required' });
    }

    const amountNum = parseFloat(amount);

    if (isNaN(amountNum)) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    state.extraPayments[partner] += amountNum;
    state.totalExtraPayments += amountNum;

    const paymentId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

    state.payments.push({
        id: paymentId,
        type: 'extra',
        partner,
        amount: amountNum,
        recordedBy: recordedBy || 'Unknown',
        timestamp: new Date().toISOString(),
        telegramId,
        comment: comment || ''
    });

    state.debtFullyPaid = getRemainingDebt() <= 0;

    const isNewDebt = amountNum < 0;
    console.log(`${isNewDebt ? '🆕 New Debt' : '💵 Extra Payment'}: ₹${Math.abs(amountNum)} for ${PARTNERS[partner].name}`);

    res.json({ success: true });
});

app.delete('/api/payment/:id', (req, res) => {
    const { id } = req.params;
    const { telegramId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const paymentIndex = state.payments.findIndex(p => p.id === id);

    if (paymentIndex === -1) {
        return res.status(404).json({ error: 'Payment not found' });
    }

    state.payments.splice(paymentIndex, 1);
    recalculateState();

    console.log(`🗑️ Payment deleted: ID ${id}`);
    res.json({ success: true });
});

// EXPORT DATA
app.get('/api/export', (req, res) => {
    const { telegramId } = req.query;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const exportData = {
        version: '2.0',
        exportDate: new Date().toISOString(),
        partners: PARTNERS,
        state: state,
        approvedUsers: Array.from(approvedUsers),
        adminTelegramId: ADMIN_TELEGRAM_ID
    };

    console.log('📤 Data exported by admin');

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="partnership-backup-${Date.now()}.json"`);
    res.json(exportData);
});

// IMPORT DATA
app.post('/api/import', (req, res) => {
    const { telegramId, data } = req.body;

    console.log('📥 Import request received from:', telegramId);

    if (!isAdmin(telegramId)) {
        console.log('❌ Import denied: Not admin');
        return res.status(403).json({ error: 'Admin access required' });
    }

    try {
        // Parse if string
        let importData = data;
        if (typeof data === 'string') {
            try {
                importData = JSON.parse(data);
            } catch (parseError) {
                console.error('❌ JSON parse error:', parseError);
                return res.status(400).json({ error: 'Invalid backup file format' });
            }
        }

        // Validate structure
        if (!importData || typeof importData !== 'object') {
            console.log('❌ Import failed: Invalid data type');
            return res.status(400).json({ error: 'Invalid backup file format' });
        }

        // Check required fields
        if (!importData.partners || !importData.state) {
            console.log('❌ Import failed: Missing partners or state');
            console.log('   Received keys:', Object.keys(importData));
            return res.status(400).json({ error: 'Invalid backup file format - missing required fields' });
        }

        console.log('✅ Import validation passed');
        console.log('   Partners to import:', Object.keys(importData.partners).length);
        console.log('   Partner names:', Object.keys(importData.partners).map(k => importData.partners[k].name).join(', '));
        console.log('   Payments to import:', importData.state.payments ? importData.state.payments.length : 0);

        // Store old data for logging
        const oldPaymentCount = state.payments ? state.payments.length : 0;
        const oldDebtPaid = state.totalDebtPaid || 0;

        // Import partners configuration
        PARTNERS = importData.partners;
        console.log('   ✓ Partners imported');

        // Import state (all payment data)
        state = importData.state;
        console.log('   ✓ State imported');

        // Ensure extraPayments exists for all partners
        if (!state.extraPayments) {
            state.extraPayments = {};
        }
        Object.keys(PARTNERS).forEach(key => {
            if (state.extraPayments[key] === undefined) {
                state.extraPayments[key] = 0;
            }
        });
        console.log('   ✓ Extra payments initialized');

        // Ensure payments array exists
        if (!state.payments) {
            state.payments = [];
        }

        // Import approved users (optional)
        if (importData.approvedUsers && Array.isArray(importData.approvedUsers)) {
            approvedUsers = new Set(importData.approvedUsers);
            console.log('   ✓ Approved users imported:', approvedUsers.size);
        }

        console.log('✅ DATA IMPORT COMPLETE');
        console.log('   Payments: ' + oldPaymentCount + ' → ' + state.payments.length);
        console.log('   Total debt paid: ₹' + oldDebtPaid.toFixed(2) + ' → ₹' + (state.totalDebtPaid || 0).toFixed(2));
        console.log('   Total salary paid: ₹' + (state.totalSalaryPaid || 0).toFixed(2));
        console.log('   Remaining debt: ₹' + (state.remainingDebt || 0).toFixed(2));

        res.json({ 
            success: true, 
            message: 'Data imported successfully',
            imported: { 
                partners: Object.keys(PARTNERS).length,
                payments: state.payments.length,
                users: approvedUsers.size,
                totalDebtPaid: state.totalDebtPaid || 0,
                totalSalaryPaid: state.totalSalaryPaid || 0,
                remainingDebt: state.remainingDebt || 0
            } 
        });
    } catch (error) {
        console.error('❌ Import error:', error);
        console.error('   Stack:', error.stack);
        res.status(500).json({ error: 'Import failed: ' + error.message });
    }
});

// ADMIN ENDPOINTS
app.post('/api/admin/login', (req, res) => {
    const { password, telegramId } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
    if (!ADMIN_TELEGRAM_ID && telegramId) {
        ADMIN_TELEGRAM_ID = telegramId.toString();
        approvedUsers.add(telegramId.toString());
        return res.json({ success: true, isAdmin: true });
    }
    if (isAdmin(telegramId)) return res.json({ success: true, isAdmin: true });
    res.status(403).json({ error: 'Admin already set' });
});

app.get('/api/admin/check', (req, res) => {
    const telegramId = req.query.telegramId;
    const admin = isAdmin(telegramId);
    const approved = isApprovedUser(telegramId);
    res.json({ isAdmin: admin, hasAdmin: !!ADMIN_TELEGRAM_ID, isApproved: approved });
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
        extraPayments: {},
        payments: [],
        debtFullyPaid: false
    };

    Object.keys(PARTNERS).forEach(key => {
        state.extraPayments[key] = 0;
    });

    res.json({ success: true });
});


// ==================== CREATE DOWNLOADABLE BACKUP ENDPOINT ====================
app.post('/api/create-backup', (req, res) => {
    try {
        const { telegramId, backupData } = req.body;

        if (!telegramId) {
            return res.status(400).json({ success: false, message: 'Telegram ID required' });
        }

        if (!backupData) {
            return res.status(400).json({ success: false, message: 'Backup data required' });
        }

        console.log(`📦 Creating downloadable backup for ${telegramId}`);
        console.log(`   Records: ${backupData.history ? backupData.history.length : 0}`);

        const filename = `partnership-backup-${new Date().toISOString().split('T')[0]}.json`;

        // Set headers for file download
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

        // Send the backup data as downloadable file
        res.send(JSON.stringify(backupData, null, 2));

        console.log('✅ Backup file sent for download');

    } catch (error) {
        console.error('❌ Create backup error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== PARTNERSHIP CONFIGURATION API ====================
app.get('/api/partnerships', (req, res) => {
    try {
        const partnerships = partnershipsConfig;

        console.log('📊 Partnerships requested');
        res.json({ success: true, partnerships: partnerships });
    } catch (error) {
        console.error('Get partnerships error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/partnerships', (req, res) => {
    try {
        const { telegramId, partnerships } = req.body;

        if (!telegramId) {
            return res.status(400).json({ success: false, message: 'Telegram ID required' });
        }

        if (!partnerships || typeof partnerships !== 'object') {
            return res.status(400).json({ success: false, message: 'Invalid partnerships data' });
        }

        const totalPercentage = Object.values(partnerships).reduce((sum, val) => sum + parseFloat(val), 0);

        // Save the partnerships configuration
        partnershipsConfig = partnerships;


        console.log(`✅ Partnerships updated by ${telegramId}`);
        console.log(`   Total: ${totalPercentage.toFixed(2)}%`);

        res.json({ 
            success: true, 
            message: 'Partnerships configuration saved',
            totalPercentage: totalPercentage.toFixed(2)
        });
    } catch (error) {
        console.error('Update partnerships error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== DATA BACKUP & RESTORE API ====================
app.post('/api/import-backup', (req, res) => {
    try {
        const { telegramId, backupData } = req.body;

        if (!telegramId) {
            return res.status(400).json({ success: false, message: 'Telegram ID required' });
        }

        if (!backupData || !backupData.version || !backupData.history) {
            return res.status(400).json({ success: false, message: 'Invalid backup data format' });
        }

        console.log(`📥 Importing backup from ${backupData.exportDate || 'unknown'}`);
        console.log(`   History entries: ${backupData.history.length}`);

        // Clear current data
        data.payments = [];
        data.salaryPayments = [];
        data.extraPayments = [];

        // Import from backup
        backupData.history.forEach(item => {
            if (item.type === 'regular') {
                data.payments.push({
                    id: item.id || Date.now() + Math.random(),
                    amount: item.amount,
                    toPersonX: item.toPersonX,
                    toSalary: item.toSalary,
                    partnerDetails: item.partnerDetails,
                    timestamp: item.timestamp,
                    recordedBy: item.recordedBy,
                    comment: item.comment || '',
                    paymentStartDate: item.paymentStartDate || null,
                    paymentEndDate: item.paymentEndDate || null,
                    editedAt: item.editedAt || null
                });
            } else if (item.type === 'extra') {
                data.extraPayments.push({
                    id: item.id || Date.now() + Math.random(),
                    partner: item.partner,
                    amount: item.amount,
                    timestamp: item.timestamp,
                    recordedBy: item.recordedBy,
                    comment: item.comment || '',
                    editedAt: item.editedAt || null
                });
            }
        });

        if (backupData.initialDebts) {
            data.initialDebts = backupData.initialDebts;
        }

        saveData();

        console.log('✅ Backup imported successfully');
        console.log(`   Regular: ${data.payments.length}, Extra: ${data.extraPayments.length}`);

        res.json({ 
            success: true, 
            message: 'Backup imported successfully',
            imported: {
                regularPayments: data.payments.length,
                extraPayments: data.extraPayments.length
            }
        });
    } catch (error) {
        console.error('❌ Import backup error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


app.listen(process.env.PORT || 10000, () => {
    console.log('🚀 Partnership Calculator Server v2.0');
    console.log('✅ Features:');
    console.log('   • Export/Import backup');
    console.log('   • Dynamic partners');
    console.log('   • Configurable shares');
    console.log('   • All existing features');
});
