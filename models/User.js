const mongoose = require('mongoose');

// One collection for both relief providers (role: admin) and local food providers (role: agent)
const userSchema = new mongoose.Schema({
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role:     { type: String, enum: ['admin', 'agent'], default: 'agent' },
    location: { type: String, trim: true },
    phone:    { type: String, trim: true },
    createdAt:{ type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);