const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { PrismaClient } = require('@prisma/client');
const path = require('path');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// ---- AUTH CONFIG ----
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ---- PASSPORT ----
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (err) { done(err); }
});

passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  callbackURL: `${BASE_URL}/auth/google/callback`
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await prisma.user.findUnique({ where: { googleId: profile.id } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          id: profile.id,
          googleId: profile.id,
          email: profile.emails[0].value,
          name: profile.displayName,
          picture: profile.photos[0]?.value
        }
      });
    } else {
      user = await prisma.user.update({
        where: { id: profile.id },
        data: { name: profile.displayName, picture: profile.photos[0]?.value }
      });
    }
    done(null, user);
  } catch (err) { done(err); }
}));

// ---- MIDDLEWARE ----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust proxy (for Render/Railway behind reverse proxy)
app.set('trust proxy', 1);

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// ---- AUTH HELPERS ----
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ---- AUTH ROUTES ----
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ loggedIn: false });
  res.json({
    loggedIn: true,
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      picture: req.user.picture
    }
  });
});

// ---- API ROUTES ----

// Get balance + items + logs (all in one for initial load)
app.get('/api/data', requireAuth, async (req, res) => {
  try {
    const [user, logs, items] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.user.id } }),
      prisma.log.findMany({
        where: { userId: req.user.id },
        orderBy: { timestamp: 'desc' },
        take: 100
      }),
      prisma.storeItem.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'asc' }
      })
    ]);
    res.json({
      balance: user.balance,
      logs: logs.map(l => ({ type: l.type, amount: l.amount, name: l.name, timestamp: l.timestamp })),
      items: items.map(i => ({ id: i.id, name: i.name, price: i.price }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load data' });
  }
});

// Collect coins
app.post('/api/collect', requireAuth, async (req, res) => {
  const amount = parseInt(req.body.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { balance: { increment: amount } }
    });
    await prisma.log.create({
      data: {
        type: 'collection',
        amount,
        userId: req.user.id
      }
    });
    res.json({ balance: user.balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to collect coins' });
  }
});

// Buy item
app.post('/api/buy', requireAuth, async (req, res) => {
  const { itemId, price } = req.body;
  if (!itemId) return res.status(400).json({ error: 'Missing itemId' });

  try {
    const item = await prisma.storeItem.findFirst({
      where: { id: itemId, userId: req.user.id }
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (user.balance < item.price) return res.status(400).json({ error: 'Insufficient balance' });

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { balance: { decrement: item.price } }
    });
    await prisma.log.create({
      data: {
        type: 'purchase',
        amount: item.price,
        name: item.name,
        userId: req.user.id
      }
    });
    res.json({ balance: updated.balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to purchase item' });
  }
});

// Add store item
app.post('/api/items', requireAuth, async (req, res) => {
  const { name, price } = req.body;
  if (!name || !price || price <= 0) return res.status(400).json({ error: 'Invalid input' });

  try {
    const item = await prisma.storeItem.create({
      data: { name: name.trim(), price: parseInt(price), userId: req.user.id }
    });
    res.json({ id: item.id, name: item.name, price: item.price });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

// Update store item
app.put('/api/items/:id', requireAuth, async (req, res) => {
  const { name, price } = req.body;
  try {
    const item = await prisma.storeItem.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const updated = await prisma.storeItem.update({
      where: { id: req.params.id },
      data: {
        name: name ? name.trim() : item.name,
        price: price ? parseInt(price) : item.price
      }
    });
    res.json({ id: updated.id, name: updated.name, price: updated.price });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// Delete store item
app.delete('/api/items/:id', requireAuth, async (req, res) => {
  try {
    const item = await prisma.storeItem.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    await prisma.storeItem.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// Clear logs
app.delete('/api/logs', requireAuth, async (req, res) => {
  try {
    await prisma.log.deleteMany({ where: { userId: req.user.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

// ---- STATIC FILES ----
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- START ----
app.listen(PORT, () => {
  console.log(`Encomy running at http://localhost:${PORT}`);
  if (!GOOGLE_CLIENT_ID) {
    console.log('\n⚠️  WARNING: GOOGLE_CLIENT_ID not set. Auth will not work.');
    console.log('   Copy .env.example to .env and fill in your Google OAuth credentials.\n');
  }
});