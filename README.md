# Partnership Calculator Telegram Mini App

A professional partnership payment calculator with admin controls and payment history.

## Features

✅ Beautiful UI matching your design
✅ Admin authentication (only you can record payments)
✅ Others can only view history
✅ Real-time debt tracking
✅ Payment history
✅ Data persistence
✅ Telegram Mini App integration

## Configuration

### Admin Setup
1. First person to enter correct password becomes admin
2. Default password:
3. Change password in `server.js` line 9:
   ```javascript
   const ADMIN_PASSWORD = 'your_secure_password_here';
   ```

### Partner Details
- ** (A)**: ₹66,250 debt
- ** (B)**: ₹66,250 debt  
- ** (C)**: ₹17,450 debt
- **Person X**: Receives 50% until all debt paid

## Deployment

### Files Included
- `server.js` - Backend API with admin authentication
- `package.json` - Node.js dependencies
- `public/index.html` - Mini App interface
- `README.md` - This file

### Deploy to Render
1. Push to GitHub
2. Connect to Render
3. Deploy as Web Service
4. Get your URL

### Setup Telegram Bot
1. Create bot with @BotFather
2. Set menu button URL to your Render URL
3. First user with password becomes admin

## Security

⚠️ **IMPORTANT**: Change the admin password in server.js before deploying!

## Usage

### For Admin (You)
1. Open bot → Enter admin password
2. Enter payment amount
3. Click "Record Payment"
4. View history anytime

### For Others
1. Open bot
2. View payment history only
3. See current debts
4. Cannot record payments

## API Endpoints

- `GET /api/state` - Get current state
- `GET /api/history` - Get payment history
- `POST /api/payment` - Record payment (admin only)
- `POST /api/admin/login` - Admin login
- `POST /api/admin/reset` - Reset data (admin only)

## License

Private - For internal use only
