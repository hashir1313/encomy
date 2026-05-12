# Encomy — Coin Tracker & Store

## Concept & Vision

A personal coin management app with a clean, tactile feel. Think of a physical coin jar with a digital ledger — satisfying to use, clear at a glance. Two modes: drop coins in (log collections) or spend them at the store. All data syncs across devices via Google sign-in.

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite via Prisma ORM
- **Auth**: Google OAuth via Passport.js
- **Frontend**: Vanilla JS, served as static HTML
- **Sessions**: express-session
- **Deployment target**: Render (free tier, SQLite persistent volume)

## Design Language

- **Aesthetic**: Warm minimal — off-white background, dark text, gold accents for coins
- **Colors**: `#f5f0e8` bg, `#1a1a1a` text, `#d4a017` gold accent, `#4a90d9` blue for actions
- **Typography**: `DM Sans` (Google Fonts), clean and readable
- **Motion**: Subtle fade-in for page transitions, micro-bounce on button press
- **Icons**: Inline SVG coin icon

## Layout & Structure

Single HTML page served by Express, with 3 tabbed views:

1. **Wallet** — Current balance (large), quick-add form to log coin collections
2. **Logs** — Chronological history of all coin transactions (both collections and purchases)
3. **Store** — Two sub-modes: Setup mode (add/edit/delete store items) and Shop mode (purchase items)

Top navigation bar with tabs + user menu (avatar + logout). No routing — pure tab switching.

## Features & Interactions

### Auth
- Login page overlay shown when not authenticated
- "Sign in with Google" button redirects to Google OAuth
- On success, user is redirected back and app loads
- Session persists across page refreshes
- Logout clears session and returns to login overlay

### Wallet Tab
- Displays current balance as a large number with a coin icon
- Form: number input + "Add Coins" button
- On submit: POST /api/collect, updates balance, adds log entry, re-renders

### Logs Tab
- Reverse-chronological list of all transactions from /api/data
- Each entry: date, time, type (Collection/Purchase), amount, item name (if purchase)
- Collection entries in gold tint, purchase in blue tint
- "Clear All" button with confirm dialog → DELETE /api/logs

### Store Tab
- Segmented toggle between Setup and Shop modes
- **Setup Mode**: Add items (name + price), inline edit name/price (PUT /api/items/:id), delete items (DELETE /api/items/:id)
- **Shop Mode**: Grid of items with price + Buy button. Disabled if balance < price. Buy: confirm dialog → POST /api/buy → deducts balance, logs purchase

### Data Persistence
- All data in SQLite via Prisma. User isolation via `userId` on all models.
- Database: `prisma/dev.db` (local dev), mounted volume on Render for persistence

## API Routes

| Method | Path | Description |
|---|---|---|
| GET | /auth/google | Redirect to Google OAuth |
| GET | /auth/google/callback | OAuth callback, creates user, redirects home |
| GET | /auth/logout | Clears session, redirects home |
| GET | /api/me | Returns `{ loggedIn, user }` or `{ loggedIn: false }` |
| GET | /api/data | Returns `{ balance, logs[], items[] }` for current user |
| POST | /api/collect | Body: `{ amount }`. Increments balance, adds collection log |
| POST | /api/buy | Body: `{ itemId }`. Checks balance, deducts, logs purchase |
| POST | /api/items | Body: `{ name, price }`. Creates store item |
| PUT | /api/items/:id | Body: `{ name?, price? }`. Updates store item |
| DELETE | /api/items/:id | Deletes store item |
| DELETE | /api/logs | Clears all logs for current user |

## Database Schema

```
User      — id, googleId, email, name, picture, balance, createdAt, updatedAt
Log       — id, type (collection|purchase), amount, name?, timestamp, userId
StoreItem — id, name, price, userId, createdAt, updatedAt
```

## Component Inventory

| Component | States |
|---|---|
| Login overlay | shown (not logged in), hidden (logged in) |
| User menu | avatar + name + logout link |
| Balance display | 0 coins (empty state), has coins |
| Add Coins form | default, submitting, success |
| Log entry | collection (gold), purchase (blue) |
| Item card (Setup) | default, editing name, editing price |
| Item card (Shop) | default, disabled (can't afford) |
| Tab button | default, active |
| Action button | default, hover, active, disabled |
| Flash message | gold (collection), blue (purchase), red (error) |

## Google OAuth Setup

1. Go to https://console.cloud.google.com/
2. Create project → APIs & Services → Credentials
3. Create OAuth 2.0 Client ID
4. Authorized redirect URIs:
   - `http://localhost:3000/auth/google/callback` (local dev)
   - `https://your-app.onrender.com/auth/google/callback` (production)
5. Copy Client ID + Secret to `.env`