# Partnership Calculator Telegram Mini App

Complete Telegram Mini App with online data storage.

## Features
- 💰 Record payments with automatic split calculation
- 📊 Track total debt paid and salary distributed
- 📜 Payment history with timestamps
- 👥 Track Bhargav, Sagar, and Bharat debts/salaries
- 💾 Data stored online (accessible by all partners)

## Local Development

```bash
npm install
npm start
```

Visit: http://localhost:10000

## Deploy to Render (FREE)

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/partnership-bot.git
   git push -u origin main
   ```

2. **Deploy on Render:**
   - Go to https://render.com
   - Sign up (free)
   - Click "New +" → "Web Service"
   - Connect your GitHub repo
   - Settings:
     - Name: `partnership-bot`
     - Environment: `Node`
     - Build Command: `npm install`
     - Start Command: `npm start`
     - Plan: **Free**
   - Click "Create Web Service"
   - Wait 2-3 minutes for deployment

3. **Get your URL:**
   - Render will give you: `https://partnership-bot.onrender.com`

## Connect to Telegram

1. **Create bot:**
   - Open @BotFather in Telegram
   - Send `/newbot`
   - Follow instructions
   - Copy your bot token

2. **Set Menu Button:**
   - In @BotFather: `/mybots` → Select your bot
   - "Bot Settings" → "Menu Button" → "Configure Menu Button"
   - Enter: `https://partnership-bot.onrender.com`
   - Button text: "Open Calculator"

3. **Done!**
   - Open your bot in Telegram
   - Tap "Open Calculator"
   - Start recording payments!

## API Endpoints

- `GET /api/state` - Get current debts, totals, all data
- `POST /api/payment` - Record new payment
  ```json
  { "amount": 10000, "user": "Name" }
  ```
- `GET /api/history?limit=20` - Get payment history
- `POST /api/reset` - Reset all data (admin only)
  ```json
  { "password": "admin123" }
  ```
- `POST /api/update-debts` - Update initial debts (admin only)
  ```json
  { "password": "admin123", "debts": { "A": 68500, "B": 68500, "C": 19700 } }
  ```

## Data Storage

Currently uses **in-memory storage** (resets when server restarts).

For **permanent storage**, add a free database:
- **MongoDB Atlas** (free 512MB)
- **PostgreSQL on Render** (free 90 days)

See "Upgrade to Database" section below.

## Admin Password

Default: `admin123`

Change in `server.js` line 115 and 126.

## Partner Configuration

- Bhargav (A): ₹68,500 debt
- Sagar (B): ₹68,500 debt
- Bharat (C): ₹19,700 debt

Debt split: 46.28% / 46.28% / 7.43%
Salary split: 13.72% / 13.72% / 72.57%
