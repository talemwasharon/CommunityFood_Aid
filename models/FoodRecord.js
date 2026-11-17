const mongoose = require('mongoose');

// One food item handled in a distribution (e.g. Maize flour, Cereals, kg)
const itemSchema = new mongoose.Schema({
    name:             { type: String, required: true, trim: true },
    category:         { type: String, default: 'Other' },
    unit:             { type: String, default: 'kg' },
    initialStock:     { type: Number, required: true, min: 0 },
    distributedStock: { type: Number, required: true, min: 0 },
    currentStock:     { type: Number, required: true, min: 0 }    // initial - distributed
}, { _id: false });

const foodRecordSchema = new mongoose.Schema({
    agent:              { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    location:           { type: String, required: true, trim: true },   // village
    date:               { type: Date, required: true },
    totalHouseholds:    { type: Number, min: 0 },                       // households in the village
    householdsSupplied: { type: Number, required: true, min: 0 },
    totalUnsupplied:    { type: Number, required: true, min: 0 },       // total - supplied
    items:              [itemSchema],
    notes:              { type: String, trim: true },
    createdAt:          { type: Date, default: Date.now }
});

module.exports = mongoose.model('FoodRecord', foodRecordSchema);