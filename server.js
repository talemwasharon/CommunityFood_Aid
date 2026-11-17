const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const User = require('./models/User');
const FoodRecord = require('./models/FoodRecord');
const Household = require('./models/Household');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-before-deploying';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/login.html'));

/* ---------- helpers ---------- */
const bad = msg => Object.assign(new Error(msg), { status: 400 });

const wrap = fn => (req, res) =>
    fn(req, res).catch(err => {
        if (err.status) return res.status(err.status).json({ message: err.message });
        if (err.code === 11000) return res.status(409).json({ message: 'That email is already registered.' });
        if (err.name === 'ValidationError') return res.status(400).json({ message: err.message });
        if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid ID.' });
        console.error(err);
        res.status(500).json({ message: 'Server error.' });
    });

function auth(req, res, next) {
    const header = req.headers.authorization || '';
    try {
        req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ message: 'Please log in again.' });
    }
}

const only = role => (req, res, next) =>
    req.user.role === role ? next() : res.status(403).json({ message: 'Not allowed.' });

// Validates a record from the browser and works out unsupplied households and current stock
function cleanRecord(b) {
    const total = Number(b.totalHouseholds);
    const supplied = Number(b.householdsSupplied);
    if (!b.location || !b.date) throw bad('Location and date are required.');
    if (!(total >= 0) || !(supplied >= 0)) throw bad('Enter valid household numbers.');
    if (supplied > total) throw bad('Households supplied cannot be more than the total households in the village.');
    if (!Array.isArray(b.items) || !b.items.length) throw bad('Add at least one food item.');

    const items = b.items.map(i => {
        const name = String(i.name || '').trim();
        const initialStock = Number(i.initialStock);
        const distributedStock = Number(i.distributedStock);
        if (!name) throw bad('Every food item needs a name.');
        if (!(initialStock >= 0) || !(distributedStock >= 0)) throw bad(`Enter valid stock numbers for "${name}".`);
        if (distributedStock > initialStock) throw bad(`Distributed stock for "${name}" cannot be more than its initial stock.`);
        return {
            name, category: i.category || 'Other', unit: i.unit || 'kg',
            initialStock, distributedStock, currentStock: initialStock - distributedStock
        };
    });

    return {
        location: b.location, date: b.date, notes: b.notes,
        totalHouseholds: total, householdsSupplied: supplied, totalUnsupplied: total - supplied, items
    };
}

// records must be sorted newest first; returns each agent's newest record
function latestPerAgent(records) {
    const seen = new Set();
    return records.filter(r => {
        const k = String(r.agent);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

// validates a household from the browser
function cleanHousehold(b) {
    const name = String(b.name || '').trim();
    const village = String(b.village || '').trim();
    if (!name || !village) throw bad('Household head name and village are required.');
    const members = Number(b.members || 1);
    if (!(members >= 1)) throw bad('Number of people must be at least 1.');
    const status = b.status === 'supplied' ? 'supplied' : 'unsupplied';
    const out = { name, village, phone: b.phone, members, status };
    if (status === 'supplied') {
        out.suppliedDate = b.suppliedDate || new Date();
        out.itemsReceived = b.itemsReceived || '';
    } else {                                   // moved back to the unsupplied list
        out.suppliedDate = null;
        out.itemsReceived = '';
    }
    return out;
}

// household counts per agent from the register: { agentId: {total, supplied, unsupplied} }
async function householdCounts() {
    const rows = await Household.aggregate([{ $group: { _id: { a: '$agent', s: '$status' }, n: { $sum: 1 } } }]);
    const map = {};
    rows.forEach(r => {
        const k = String(r._id.a);
        map[k] = map[k] || { supplied: 0, unsupplied: 0 };
        map[k][r._id.s] = r.n;
    });
    Object.values(map).forEach(v => { v.total = v.supplied + v.unsupplied; });
    return map;
}

// uses the household register when the agent has one, otherwise the latest supply report
function figures(latestRecord, c) {
    if (c && c.total) return { total: c.total, supplied: c.supplied, unsupplied: c.unsupplied };
    if (latestRecord) return {
        total: latestRecord.totalHouseholds || 0,
        supplied: latestRecord.householdsSupplied,
        unsupplied: latestRecord.totalUnsupplied
    };
    return { total: 0, supplied: 0, unsupplied: 0 };
}

/* ---------- LOGIN ---------- */
app.post('/api/login', wrap(async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'Agent not found. Ask the relief provider to register you.' });

    let ok;
    if (user.password.startsWith('$2')) {
        ok = await bcrypt.compare(password, user.password);
    } else {
        ok = password === user.password;
        if (ok) { user.password = await bcrypt.hash(password, 10); await user.save(); }
    }
    if (!ok) return res.status(401).json({ message: 'Incorrect password.' });

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
    res.json({
        token,
        user: { id: user._id, name: user.name, email: user.email, role: user.role, location: user.location }
    });
}));

/* ---------- AGENTS (admin only) : CRUD ---------- */
app.post('/api/agents', auth, only('admin'), wrap(async (req, res) => {
    const { name, email, password, phone, location } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'Name, email and password are required.' });
    const agent = await User.create({
        name, email, phone, location, role: 'agent',
        password: await bcrypt.hash(password, 10)
    });
    res.status(201).json({ ...agent.toObject(), password: undefined });
}));

app.get('/api/agents', auth, only('admin'), wrap(async (req, res) => {
    res.json(await User.find({ role: 'agent' }).select('-password').sort({ createdAt: -1 }));
}));

app.put('/api/agents/:id', auth, only('admin'), wrap(async (req, res) => {
    const { name, email, password, phone, location } = req.body;
    const update = { name, email, phone, location };
    if (password) update.password = await bcrypt.hash(password, 10);
    const agent = await User.findOneAndUpdate(
        { _id: req.params.id, role: 'agent' }, update, { new: true, runValidators: true }
    ).select('-password');
    if (!agent) return res.status(404).json({ message: 'Agent not found.' });
    res.json(agent);
}));

app.delete('/api/agents/:id', auth, only('admin'), wrap(async (req, res) => {
    const agent = await User.findOneAndDelete({ _id: req.params.id, role: 'agent' });
    if (!agent) return res.status(404).json({ message: 'Agent not found.' });
    await FoodRecord.deleteMany({ agent: agent._id });
    res.json({ message: 'Agent deleted.' });
}));

/* ---------- FOOD RECORDS : CRUD ---------- */
app.post('/api/records', auth, only('agent'), wrap(async (req, res) => {
    const record = await FoodRecord.create({ ...cleanRecord(req.body), agent: req.user.id });
    res.status(201).json(record);
}));

app.get('/api/records', auth, wrap(async (req, res) => {
    const filter = req.user.role === 'agent' ? { agent: req.user.id } : {};
    res.json(await FoodRecord.find(filter).populate('agent', 'name location').sort({ date: -1, createdAt: -1 }));
}));

app.put('/api/records/:id', auth, wrap(async (req, res) => {
    const record = await FoodRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: 'Record not found.' });
    if (req.user.role === 'agent' && String(record.agent) !== req.user.id)
        return res.status(403).json({ message: 'You can only edit your own records.' });
    record.set(cleanRecord(req.body));
    await record.save();
    res.json(record);
}));

app.delete('/api/records/:id', auth, wrap(async (req, res) => {
    const record = await FoodRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: 'Record not found.' });
    if (req.user.role === 'agent' && String(record.agent) !== req.user.id)
        return res.status(403).json({ message: 'You can only delete your own records.' });
    await record.deleteOne();
    res.json({ message: 'Record deleted.' });
}));

/* ---------- HOUSEHOLD REGISTER : CRUD ---------- */
app.post('/api/households', auth, only('agent'), wrap(async (req, res) => {
    const h = await Household.create({ ...cleanHousehold(req.body), agent: req.user.id });
    res.status(201).json(h);
}));

app.get('/api/households', auth, wrap(async (req, res) => {
    const filter = req.user.role === 'agent' ? { agent: req.user.id } : {};
    res.json(await Household.find(filter).populate('agent', 'name').sort({ createdAt: -1 }));
}));

// also used to mark a household as supplied (status: 'supplied') or move it back
app.put('/api/households/:id', auth, wrap(async (req, res) => {
    const h = await Household.findById(req.params.id);
    if (!h) return res.status(404).json({ message: 'Household not found.' });
    if (req.user.role === 'agent' && String(h.agent) !== req.user.id)
        return res.status(403).json({ message: 'You can only edit your own households.' });
    h.set(cleanHousehold(req.body));
    await h.save();
    res.json(h);
}));

app.delete('/api/households/:id', auth, wrap(async (req, res) => {
    const h = await Household.findById(req.params.id);
    if (!h) return res.status(404).json({ message: 'Household not found.' });
    if (req.user.role === 'agent' && String(h.agent) !== req.user.id)
        return res.status(403).json({ message: 'You can only delete your own households.' });
    await h.deleteOne();
    res.json({ message: 'Household deleted.' });
}));

/* ---------- SUMMARY (admin): based on each agent's latest report / register ---------- */
app.get('/api/summary', auth, only('admin'), wrap(async (req, res) => {
    const agents = await User.find({ role: 'agent' }).select('_id');
    const records = await FoodRecord.find().sort({ date: -1, createdAt: -1 });
    const latest = latestPerAgent(records);
    const latestBy = {};
    latest.forEach(r => { latestBy[String(r.agent)] = r; });
    const counts = await householdCounts();

    let totalHouseholds = 0, householdsSupplied = 0, totalUnsupplied = 0;
    agents.forEach(a => {
        const f = figures(latestBy[String(a._id)], counts[String(a._id)]);
        totalHouseholds += f.total; householdsSupplied += f.supplied; totalUnsupplied += f.unsupplied;
    });

    const stock = {};                                   // combine the same item + unit across agents
    latest.forEach(r => r.items.forEach(i => {
        const k = i.name.toLowerCase() + '|' + i.unit;
        if (!stock[k]) stock[k] = { name: i.name, category: i.category, unit: i.unit, initialStock: 0, distributedStock: 0, currentStock: 0 };
        stock[k].initialStock += i.initialStock;
        stock[k].distributedStock += i.distributedStock;
        stock[k].currentStock += i.currentStock;
    }));

    res.json({
        agents: agents.length,
        records: records.length,
        totalHouseholds, householdsSupplied, totalUnsupplied,
        stock: Object.values(stock)
    });
}));

/* ---------- AGENT PROGRESS REPORT (admin) ---------- */
app.get('/api/progress', auth, only('admin'), wrap(async (req, res) => {
    const agents = await User.find({ role: 'agent' }).select('-password').sort({ name: 1 });
    const records = await FoodRecord.find().sort({ date: -1, createdAt: -1 });
    const counts = await householdCounts();

    res.json(agents.map(a => {
        const mine = records.filter(r => String(r.agent) === String(a._id));
        const latest = mine[0] || null;
        const f = figures(latest, counts[String(a._id)]);
        return {
            id: a._id,
            name: a.name,
            location: a.location,
            reports: mine.length,
            totalHouseholds: f.total,
            householdsSupplied: f.supplied,
            totalUnsupplied: f.unsupplied,
            coverage: f.total ? Math.round((f.supplied / f.total) * 100) : 0,
            items: latest ? latest.toObject().items || [] : [],
            lastReportDate: latest ? latest.date : null,
            lastLocation: latest ? latest.location : null
        };
    }));
}));

/* ---------- default admin ---------- */
async function createDefaultAdmin() {
    const email = 'talemwasharon08@gmail.com';        // your admin email
    const exists = await User.findOne({ email });
    if (!exists) {
        await User.create({
            name: 'Sharon',
            email,
            password: await bcrypt.hash('Admin12345', 10),   // change this password
            role: 'admin',
            location: 'Headquarters',
            phone: '0700000000'
        });
        console.log('Admin created: ' + email + ' / Admin12345');
    }
}

/* ---------- start ---------- */
const mongoURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/foodAidDB';
mongoose.connect(mongoURI)
    .then(async () => {
        console.log('Connected to MongoDB successfully!');
        await createDefaultAdmin();
        app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
    })
    .catch(err => console.error('MongoDB connection error:', err));