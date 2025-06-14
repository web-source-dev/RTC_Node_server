const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

const AuthService = {
  register: async function(userData) {
    try {
      const existingUser = await User.findOne({ email: userData.email });
      if (existingUser) {
        throw new Error('Email is already registered');
      }

      const user = new User({
        userId: uuidv4(),
        email: userData.email,
        password: userData.password,
        name: userData.name,
        role: userData.role || 'student'
      });

      await user.save();

      const userResponse = user.toObject();
      delete userResponse.password;
      
      return {
        user: userResponse,
        token: generateToken(user)
      };
    } catch (error) {
      throw error;
    }
  },

  login: async function(email, password) {
    try {
      const user = await User.findOne({ email });
      if (!user) {
        throw new Error('Invalid email or password');
      }

      const isMatch = user.comparePassword(password);
      if (!isMatch) {
        throw new Error('Invalid email or password');
      }

      user.lastLogin = new Date();
      await user.save();

      const userResponse = user.toObject();
      delete userResponse.password;

      return {
        user: userResponse,
        token: generateToken(user)
      };
    } catch (error) {
      throw error;
    }
  },

  verifyToken: function(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      throw new Error('Invalid token');
    }
  },

  getUser: async function(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const userResponse = user.toObject();
      delete userResponse.password;

      return userResponse;
    } catch (error) {
      throw error;
    }
  }
};

function generateToken(user) {
  return jwt.sign(
    { 
      id: user._id,
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role
    }, 
    JWT_SECRET, 
    { expiresIn: JWT_EXPIRES_IN }
  );
}

module.exports = AuthService; 