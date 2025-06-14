const mongoose = require('mongoose');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    default: uuidv4,
    required: true,
    unique: true
  },
  email: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    lowercase: true
  },
  password: { 
    type: String, 
    required: true 
  },
  name: { 
    type: String, 
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['student', 'instructor'],
    default: 'student',
    required: true
  },
  created: { 
    type: Date, 
    default: Date.now 
  },
  lastLogin: { 
    type: Date, 
    default: null 
  }
});

userSchema.pre('save', function(next) {
  if (!this.userId) {
    this.userId = uuidv4();
  }
  
  if (this.isModified('password')) {
    this.password = hashPassword(this.password);
  }
  
  next();
});

userSchema.methods.comparePassword = function(candidatePassword) {
  const hashedPassword = hashPassword(candidatePassword);
  return this.password === hashedPassword;
};

function hashPassword(password) {
  if (!password) return null;
  return crypto.createHash('sha256').update(password).digest('hex');
}

const User = mongoose.model('User', userSchema);

module.exports = User; 