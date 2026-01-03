const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const ADMIN_PASSWORD = 'admin123';
const PRESET_ADMIN_ID = null;

let ADMIN_TELEGRAM_ID = PRESET_ADMIN_ID;

// PostgreSQL Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? {
        rejectUnauthorized: false
    } : false
});

// CONFIGURABLE DEBTS
let INITIAL_DEBTS = {
    A: 66250,
    B: 66250,
    C: 17450
};

const SHAREHOLDING = {
    A: 0.30,
    B: 0.30,
    C: 0.40
};

// Initialize Database Tables
async function initDatabase() {
    const client = await pool.connect();
    try {
        // Create tables if they don't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS config (
                id SERIAL PRIMARY KEY,
                key VARCHAR(50) UNIQUE NOT NULL,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS payments (
                id VARCHAR(100) PRIMARY KEY,
                type VARCHAR(20) NOT NULL,
                amount DECIMAL(12, 2) NOT NULL,
                partner VARCHAR(10),
                to_person_x DECIMAL(12, 2),
                to_salary DECIMAL(12, 2),
                partner_details JSONB,
                recorded_by VARCHAR(100),
                telegram_id VARCHAR(50),
                comment TEXT,
                payment_start_date DATE,
                payment_end_date DATE,
                timestamp TIMESTAMP NOT NULL,
                edited_at TIMESTAMP
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                telegram_id VARCHAR(50) PRIMARY KEY,
                user_name VARCHAR(100),
                is_admin BOOLEAN DEFAULT false,
                is_approved BOOLEAN DEFAULT false,
                requested_at TIMESTAMP,
                approved_at TIMESTAMP
            );
        `);

        // Create indexes for better performance
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_payments_timestamp ON payments(timestamp DESC);
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_payments_dates ON payments(payment_start_date, payment_end_date);
        `);

        console.log('✅ Database tables initialized');

        // Load initial configuration
        await loadConfigFromDB();

    } catch (error) {
        console.error('❌ Database initialization error:', error);
    } finally {
        client.release();
    }
}

// Load configuration from database
async function loadConfigFromDB() {
    const client = await pool.connect();
    try {
        const result = await client.query(`SELECT key, value FROM config`);

        for (const row of result.rows) {
            if (row.key === 'initial_debts') {
                INITIAL_DEBTS = JSON.parse(row.value);
            } else if (row.key === 'admin_telegram_id') {
                ADMIN_TELEGRAM_ID = row.value;
            }
        }

        // If no config exists, save defaults
        if (result.rows.length === 0) {
            await saveConfigToDB();
        }
    } catch (error) {
        console.error('Error loading config:', error);
    } finally {
        client.release();
    }
}

// Save configuration to database
async function saveConfigToDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            INSERT INTO config (key, value, updated_at)
            VALUES ('initial_debts', $1, CURRENT_TIMESTAMP)
            ON CONFLICT (key) 
            DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP
        `, [JSON.stringify(INITIAL_DEBTS)]);

        if (ADMIN_TELEGRAM_ID) {
            await client.query(`
                INSERT INTO config (key, value, updated_at)
                VALUES ('admin_telegram_id', $1, CURRENT_TIMESTAMP)
                ON CONFLICT (key) 
                DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP
            `, [ADMIN_TELEGRAM_ID]);
        }
    } catch (error) {
        console.error('Error saving config:', error);
    } finally {
        client.release();
    }
}

function getTotalDebt() {
    return INITIAL_DEBTS.A + INITIAL_DEBTS.B + INITIAL_DEBTS.C;
}

function isAdmin(telegramId) {
    if (!ADMIN_TELEGRAM_ID) return false;
    return telegramId?.toString() === ADMIN_TELEGRAM_ID?.toString();
}

async function isApprovedUser(telegramId) {
    if (isAdmin(telegramId)) return true;

    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT is_approved FROM users WHERE telegram_id = $1`,
            [telegramId?.toString()]
        );
        return result.rows.length > 0 && result.rows[0].is_approved;
    } catch (error) {
        console.error('Error checking approval:', error);
        return false;
    } finally {
        client.release();
    }
}

// Calculate state from database
async function calculateStateFromDB() {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT * FROM payments ORDER BY timestamp ASC
        `);

        let totalDebtPaid = 0;
        let totalSalaryPaid = 0;
        let totalExtraPayments = 0;
        let extraPayments = { A: 0, B: 0, C: 0 };

        for (const payment of result.rows) {
            if (payment.type === 'regular') {
                totalDebtPaid += parseFloat(payment.to_person_x || 0);
                totalSalaryPaid += parseFloat(payment.to_salary || 0);
            } else if (payment.type === 'extra') {
                const amount = parseFloat(payment.amount);
                extraPayments[payment.partner] += amount;
                totalExtraPayments += amount;
            }
        }

        const remainingDebt = Math.max(0, getTotalDebt() - totalDebtPaid - totalExtraPayments);
        const debtFullyPaid = remainingDebt <= 0;

        return {
            totalDebtPaid,
            totalSalaryPaid,
            totalExtraPayments,
            extraPayments,
            remainingDebt,
            debtFullyPaid
        };
    } catch (error) {
        console.error('Error calculating state:', error);
        return null;
    } finally {
        client.release();
    }
}

// Calculate individual debt paid
async function calculateIndividualDebtPaid() {
    const state = await calculateStateFromDB();
    const totalDebt = getTotalDebt();

    if (totalDebt === 0) return { A: 0, B: 0, C: 0 };

    const debtClearRate = state.totalDebtPaid / totalDebt;

    return {
        A: INITIAL_DEBTS.A * debtClearRate,
        B: INITIAL_DEBTS.B * debtClearRate,
        C: INITIAL_DEBTS.C * debtClearRate
    };
}

function calculatePartnerDetails(amount, remainingDebt) {
    const totalDebt = getTotalDebt();

    const shareA = amount * SHAREHOLDING.A;
    const shareB = amount * SHAREHOLDING.B;
    const shareC = amount * SHAREHOLDING.C;

    let debtA, debtB, debtC, salaryA, salaryB, salaryC;
    let toPersonX, toSalary;
    let debtClearRate;

    if (remainingDebt <= 0) {
        debtA = debtB = debtC = 0;
        salaryA = shareA;
        salaryB = shareB;
        salaryC = shareC;
        toPersonX = 0;
        toSalary = amount;
        debtClearRate = 0;
    } else if (remainingDebt < amount * 0.5) {
        debtClearRate = remainingDebt / totalDebt;

        debtA = INITIAL_DEBTS.A * debtClearRate;
        debtB = INITIAL_DEBTS.B * debtClearRate;
        debtC = INITIAL_DEBTS.C * debtClearRate;

        toPersonX = remainingDebt;
        toSalary = amount - remainingDebt;

        salaryA = shareA - debtA;
        salaryB = shareB - debtB;
        salaryC = shareC - debtC;
    } else {
        debtClearRate = (amount * 0.5) / totalDebt;

        debtA = INITIAL_DEBTS.A * debtClearRate;
        debtB = INITIAL_DEBTS.B * debtClearRate;
        debtC = INITIAL_DEBTS.C * debtClearRate;

        salaryA = shareA - debtA;
        salaryB = shareB - debtB;
        salaryC = shareC - debtC;

        toPersonX = debtA + debtB + debtC;
        toSalary = salaryA + salaryB + salaryC;
    }

    return {
        A: { share: shareA, debt: debtA, salary: salaryA },
        B: { share: shareB, debt: debtB, salary: salaryB },
        C: { share: shareC, debt: debtC, salary: salaryC },
        debtClearRate: debtClearRate * 100,
        toPersonX,
        toSalary,
        isDebtComplete: remainingDebt <= toPersonX
    };
}

// Recalculate all payments (used after edit/delete)
async function recalculateAllPayments() {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT * FROM payments WHERE type = 'regular' ORDER BY timestamp ASC
        `);

        let cumulativeDebtPaid = 0;
        let cumulativeExtraPayments = 0;

        // Get extra payments first
        const extraResult = await client.query(`
            SELECT partner, SUM(amount) as total 
            FROM payments 
            WHERE type = 'extra' 
            GROUP BY partner
        `);

        for (const row of extraResult.rows) {
            cumulativeExtraPayments += parseFloat(row.total);
        }

        for (const payment of result.rows) {
            const remainingDebt = Math.max(0, getTotalDebt() - cumulativeDebtPaid - cumulativeExtraPayments);
            const details = calculatePartnerDetails(parseFloat(payment.amount), remainingDebt);

            await client.query(`
                UPDATE payments 
                SET to_person_x = $1, to_salary = $2, partner_details = $3
                WHERE id = $4
            `, [details.toPersonX, details.toSalary, JSON.stringify(details), payment.id]);

            cumulativeDebtPaid += details.toPersonX;
        }

        console.log('✅ All payments recalculated');
    } catch (error) {
        console.error('Error recalculating payments:', error);
    } finally {
        client.release();
    }
}

// ACCESS CONTROL
app.post('/api/access/request', async (req, res) => {
    const { telegramId, userName } = req.body;

    if (!telegramId) {
        return res.status(400).json({ error: 'Telegram ID required' });
    }

    const client = await pool.connect();
    try {
        const existing = await client.query(
            `SELECT * FROM users WHERE telegram_id = $1`,
            [telegramId.toString()]
        );

        if (existing.rows.length > 0) {
            const user = existing.rows[0];
            if (user.is_approved) {
                return res.json({ approved: true });
            } else {
                return res.json({ pending: true, message: 'Request pending approval' });
            }
        }

        await client.query(`
            INSERT INTO users (telegram_id, user_name, is_approved, requested_at)
            VALUES ($1, $2, false, CURRENT_TIMESTAMP)
        `, [telegramId.toString(), userName || 'Unknown User']);

        console.log('🔔 NEW ACCESS REQUEST: ' + userName);

        res.json({ pending: true, message: 'Access request sent to admin' });
    } catch (error) {
        console.error('Error requesting access:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

app.get('/api/access/pending', async (req, res) => {
    const { telegramId } = req.query;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT telegram_id, user_name, requested_at 
            FROM users 
            WHERE is_approved = false AND is_admin = false
            ORDER BY requested_at DESC
        `);

        res.json({ 
            pending: result.rows.map(row => ({
                telegramId: row.telegram_id,
                userName: row.user_name,
                requestedAt: row.requested_at
            }))
        });
    } catch (error) {
        console.error('Error fetching pending:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

app.post('/api/access/approve', async (req, res) => {
    const { telegramId, userId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const client = await pool.connect();
    try {
        await client.query(`
            UPDATE users 
            SET is_approved = true, approved_at = CURRENT_TIMESTAMP
            WHERE telegram_id = $1
        `, [userId.toString()]);

        console.log('✅ User approved: ' + userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error approving user:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

app.post('/api/access/reject', async (req, res) => {
    const { telegramId, userId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const client = await pool.connect();
    try {
        await client.query(`DELETE FROM users WHERE telegram_id = $1`, [userId.toString()]);
        console.log('❌ User rejected: ' + userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error rejecting user:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

app.get('/api/state', async (req, res) => {
    const { telegramId } = req.query;

    const approved = await isApprovedUser(telegramId);
    if (!approved) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const state = await calculateStateFromDB();
        const debtPaid = await calculateIndividualDebtPaid();

        res.json({
            ...state,
            debtPaid,
            initialDebts: INITIAL_DEBTS
        });
    } catch (error) {
        console.error('Error getting state:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/config', (req, res) => {
    res.json({
        initialDebts: INITIAL_DEBTS,
        shareholding: SHAREHOLDING
    });
});

app.post('/api/config/debts', async (req, res) => {
    const { debtA, debtB, debtC, telegramId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!debtA || !debtB || !debtC || debtA < 0 || debtB < 0 || debtC < 0) {
        return res.status(400).json({ error: 'Invalid debt amounts' });
    }

    INITIAL_DEBTS.A = parseFloat(debtA);
    INITIAL_DEBTS.B = parseFloat(debtB);
    INITIAL_DEBTS.C = parseFloat(debtC);

    await saveConfigToDB();
    await recalculateAllPayments();

    console.log('💰 Debts Updated & Recalculated');

    res.json({ success: true, initialDebts: INITIAL_DEBTS });
});

app.get('/api/history', async (req, res) => {
    const { telegramId, limit } = req.query;

    const approved = await isApprovedUser(telegramId);
    if (!approved) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const client = await pool.connect();
    try {
        const limitNum = parseInt(limit) || 50;

        const result = await client.query(`
            SELECT * FROM payments 
            ORDER BY timestamp DESC 
            LIMIT $1
        `, [limitNum]);

        const state = await calculateStateFromDB();
        const debtPaid = await calculateIndividualDebtPaid();

        const history = result.rows.map(row => ({
            id: row.id,
            type: row.type,
            amount: parseFloat(row.amount),
            partner: row.partner,
            toPersonX: row.to_person_x ? parseFloat(row.to_person_x) : null,
            toSalary: row.to_salary ? parseFloat(row.to_salary) : null,
            partnerDetails: row.partner_details,
            recordedBy: row.recorded_by,
            telegramId: row.telegram_id,
            comment: row.comment,
            paymentStartDate: row.payment_start_date,
            paymentEndDate: row.payment_end_date,
            timestamp: row.timestamp,
            editedAt: row.edited_at
        }));

        res.json({
            history,
            totalDebtPaid: state.totalDebtPaid,
            totalSalaryPaid: state.totalSalaryPaid,
            totalExtraPayments: state.totalExtraPayments,
            extraPayments: state.extraPayments,
            debtPaid,
            debtFullyPaid: state.debtFullyPaid
        });
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

app.get('/api/monthly', async (req, res) => {
    const { telegramId, month, year } = req.query;

    const approved = await isApprovedUser(telegramId);
    if (!approved) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const monthNum = parseInt(month);
    const yearNum = parseInt(year);

    if (!monthNum || !yearNum) {
        return res.status(400).json({ error: 'Month and year required' });
    }

    const client = await pool.connect();
    try {
        const startDate = new Date(yearNum, monthNum - 1, 1);
        const endDate = new Date(yearNum, monthNum, 0, 23, 59, 59);

        const result = await client.query(`
            SELECT * FROM payments 
            WHERE (
                (payment_start_date IS NOT NULL AND payment_end_date IS NOT NULL 
                 AND payment_start_date <= $2 AND payment_end_date >= $1)
                OR 
                (payment_start_date IS NULL AND timestamp >= $1 AND timestamp <= $2)
            )
            ORDER BY timestamp ASC
        `, [startDate, endDate]);

        let totalAmount = 0;
        let salaryA = 0, salaryB = 0, salaryC = 0;
        let debtPaid = 0;

        for (const payment of result.rows) {
            if (payment.type === 'regular') {
                totalAmount += parseFloat(payment.amount);
                const details = payment.partner_details;
                salaryA += details.A.salary;
                salaryB += details.B.salary;
                salaryC += details.C.salary;
                debtPaid += parseFloat(payment.to_person_x);
            }
        }

        res.json({
            month: monthNum,
            year: yearNum,
            totalPayments: result.rows.length,
            totalAmount,
            debtPaid,
            totalSalary: totalAmount - debtPaid,
            salaries: { A: salaryA, B: salaryB, C: salaryC }
        });
    } catch (error) {
        console.error('Error fetching monthly report:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

app.post('/api/payment', async (req, res) => {
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

    const client = await pool.connect();
    try {
        const state = await calculateStateFromDB();
        const partnerDetails = calculatePartnerDetails(parseFloat(amount), state.remainingDebt);

        const paymentId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

        await client.query(`
            INSERT INTO payments (
                id, type, amount, to_person_x, to_salary, partner_details,
                recorded_by, telegram_id, comment, payment_start_date, payment_end_date, timestamp
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
        `, [
            paymentId, 'regular', amount, partnerDetails.toPersonX, partnerDetails.toSalary,
            JSON.stringify(partnerDetails), recordedBy || 'Unknown', telegramId,
            comment || '', paymentStartDate || null, paymentEndDate || null
        ]);

        console.log(`💰 Payment: ₹${amount}`);
        if (paymentStartDate && paymentEndDate) {
            console.log(`   📅 Period: ${paymentStartDate} to ${paymentEndDate}`);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

app.put('/api/payment/:id', async (req, res) => {
    const { id } = req.params;
    const { amount, comment, telegramId, paymentStartDate, paymentEndDate } = req.body;

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

    const client = await pool.connect();
    try {
        const payment = await client.query(`SELECT * FROM payments WHERE id = $1`, [id]);

        if (payment.rows.length === 0) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        if (payment.rows[0].type === 'regular') {
            await client.query(`
                UPDATE payments 
                SET amount = $1, comment = $2, payment_start_date = $3, 
                    payment_end_date = $4, edited_at = CURRENT_TIMESTAMP
                WHERE id = $5
            `, [amount, comment || '', paymentStartDate || null, paymentEndDate || null, id]);

            await recalculateAllPayments();
        } else {
            await client.query(`
                UPDATE payments 
                SET amount = $1, comment = $2, edited_at = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [amount, comment || '', id]);
        }

        console.log(`✏️ Payment edited: ID ${id}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error editing payment:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

app.post('/api/extra-payment', async (req, res) => {
    const { partner, amount, recordedBy, telegramId, comment } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!partner || !['A', 'B', 'C'].includes(partner)) {
        return res.status(400).json({ error: 'Invalid partner' });
    }

    if (amount === undefined || amount === null) {
        return res.status(400).json({ error: 'Amount required' });
    }

    const amountNum = parseFloat(amount);

    if (isNaN(amountNum)) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    const client = await pool.connect();
    try {
        const paymentId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

        await client.query(`
            INSERT INTO payments (
                id, type, partner, amount, recorded_by, telegram_id, comment, timestamp
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        `, [paymentId, 'extra', partner, amountNum, recordedBy || 'Unknown', telegramId, comment || '']);

        const isNewDebt = amountNum < 0;
        console.log(`${isNewDebt ? '🆕 New Debt' : '💵 Extra Payment'}: ₹${Math.abs(amountNum)} for ${partner}`);

        res.json({ success: true });
    } catch (error) {
        console.error('Error recording extra payment:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

app.delete('/api/payment/:id', async (req, res) => {
    const { id } = req.params;
    const { telegramId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const client = await pool.connect();
    try {
        const result = await client.query(`DELETE FROM payments WHERE id = $1 RETURNING type`, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        if (result.rows[0].type === 'regular') {
            await recalculateAllPayments();
        }

        console.log(`🗑️ Payment deleted: ID ${id}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting payment:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// EXPORT DATA
app.get('/api/export', async (req, res) => {
    const { telegramId } = req.query;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const client = await pool.connect();
    try {
        const payments = await client.query(`SELECT * FROM payments ORDER BY timestamp ASC`);
        const users = await client.query(`SELECT * FROM users`);

        const exportData = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            config: {
                initialDebts: INITIAL_DEBTS,
                adminTelegramId: ADMIN_TELEGRAM_ID
            },
            payments: payments.rows,
            users: users.rows
        };

        console.log('📤 Data exported by admin');

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="partnership-backup-${Date.now()}.json"`);
        res.json(exportData);
    } catch (error) {
        console.error('Error exporting data:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// IMPORT DATA
app.post('/api/import', async (req, res) => {
    const { telegramId, data, replaceExisting } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!data || !data.version) {
        return res.status(400).json({ error: 'Invalid import data' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (replaceExisting) {
            await client.query('DELETE FROM payments');
            await client.query('DELETE FROM users WHERE is_admin = false');
            console.log('🗑️ Existing data cleared');
        }

        // Import config
        if (data.config) {
            INITIAL_DEBTS = data.config.initialDebts;
            await saveConfigToDB();
        }

        // Import payments
        if (data.payments && data.payments.length > 0) {
            for (const payment of data.payments) {
                await client.query(`
                    INSERT INTO payments (
                        id, type, amount, partner, to_person_x, to_salary, partner_details,
                        recorded_by, telegram_id, comment, payment_start_date, payment_end_date,
                        timestamp, edited_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    payment.id, payment.type, payment.amount, payment.partner,
                    payment.to_person_x, payment.to_salary, payment.partner_details,
                    payment.recorded_by, payment.telegram_id, payment.comment,
                    payment.payment_start_date, payment.payment_end_date,
                    payment.timestamp, payment.edited_at
                ]);
            }
        }

        // Import users (except admin)
        if (data.users && data.users.length > 0) {
            for (const user of data.users) {
                if (!user.is_admin) {
                    await client.query(`
                        INSERT INTO users (telegram_id, user_name, is_approved, requested_at, approved_at)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (telegram_id) DO NOTHING
                    `, [user.telegram_id, user.user_name, user.is_approved, user.requested_at, user.approved_at]);
                }
            }
        }

        await client.query('COMMIT');

        console.log('📥 Data imported successfully');
        console.log(`   Payments: ${data.payments?.length || 0}`);
        console.log(`   Users: ${data.users?.length || 0}`);

        res.json({ success: true, imported: { payments: data.payments?.length || 0, users: data.users?.length || 0 } });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error importing data:', error);
        res.status(500).json({ error: 'Import failed: ' + error.message });
    } finally {
        client.release();
    }
});

app.post('/api/admin/login', async (req, res) => {
    const { password, telegramId } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid password' });
    }

    if (!ADMIN_TELEGRAM_ID && telegramId) {
        ADMIN_TELEGRAM_ID = telegramId.toString();
        await saveConfigToDB();

        const client = await pool.connect();
        try {
            await client.query(`
                INSERT INTO users (telegram_id, user_name, is_admin, is_approved, approved_at)
                VALUES ($1, $2, true, true, CURRENT_TIMESTAMP)
                ON CONFLICT (telegram_id) 
                DO UPDATE SET is_admin = true, is_approved = true
            `, [telegramId.toString(), 'Admin']);
        } finally {
            client.release();
        }

        return res.json({ success: true, isAdmin: true });
    }

    if (isAdmin(telegramId)) {
        return res.json({ success: true, isAdmin: true });
    }

    res.status(403).json({ error: 'Admin already set' });
});

app.get('/api/admin/check', async (req, res) => {
    const telegramId = req.query.telegramId;
    const admin = isAdmin(telegramId);
    const approved = await isApprovedUser(telegramId);
    res.json({ isAdmin: admin, hasAdmin: !!ADMIN_TELEGRAM_ID, isApproved: approved });
});

app.post('/api/admin/reset', async (req, res) => {
    const { password, telegramId } = req.body;

    if (password !== ADMIN_PASSWORD || !isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const client = await pool.connect();
    try {
        await client.query('DELETE FROM payments');
        console.log('✅ All payment data reset');
        res.json({ success: true });
    } catch (error) {
        console.error('Error resetting data:', error);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Start server and initialize database
const PORT = process.env.PORT || 10000;

pool.connect()
    .then(client => {
        client.release();
        console.log('✅ PostgreSQL connected');
        return initDatabase();
    })
    .then(() => {
        app.listen(PORT, () => {
            console.log('🚀 Partnership Calculator Server (PostgreSQL + Export/Import)');
            console.log(`   Port: ${PORT}`);
            console.log('✅ Features:');
            console.log('   • PostgreSQL database (permanent storage)');
            console.log('   • Export/Import backup');
            console.log('   • All previous features');
        });
    })
    .catch(error => {
        console.error('❌ Startup error:', error);
        process.exit(1);
    });
