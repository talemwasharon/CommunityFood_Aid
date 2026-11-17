const mongoose = require('mongoose');

// One household on an agent's register. status moves from 'unsupplied' to 'supplied'.
const householdSchema = new mongoose.Schema({
    agent:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name:          { type: String, required: true, trim: true },     // head of household
    village:       { type: String, required: true, trim: true },
    phone:         { type: String, trim: true },
    members:       { type: Number, min: 1, default: 1 },             // people in the household
    status:        { type: String, enum: ['unsupplied', 'supplied'], default: 'unsupplied' },
    suppliedDate:  { type: Date },
    itemsReceived: { type: String, trim: true },
    createdAt:     { type: Date, default: Date.now }
});

module.exports = mongoose.model('Household', householdSchema);