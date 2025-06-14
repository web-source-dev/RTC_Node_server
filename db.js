const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const User = require('./models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/rtc_app';

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('MongoDB connected successfully');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  userName: { type: String, default: 'Anonymous' },
  lastActive: { type: Date, default: Date.now },
  created: { type: Date, default: Date.now }
});

const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  creatorId: { type: String, required: true },
  password: { type: String, default: '' },
  isPasswordProtected: { type: Boolean, default: false },
  created: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },
  participants: [
    {
      userId: { type: String, required: true },
      displayName: { type: String, default: 'Anonymous' },
      joinedAt: { type: Date, default: Date.now },
      inactive: { type: Boolean, default: false },
      disconnectedAt: { type: Date, default: null },
      previousId: { type: String, default: null },
      previousSocketId: { type: String, default: null }
    }
  ]
});

const Session = mongoose.model('Session', sessionSchema);
const Room = mongoose.model('Room', roomSchema);

const SessionService = {
  create: async function(userId, userName = 'Anonymous') {
    const sessionId = uuidv4();
    const session = new Session({
      sessionId,
      userId,
      userName,
      lastActive: new Date(),
      created: new Date()
    });
    
    await session.save();
    return session;
  },
  
  findById: async function(sessionId) {
    return Session.findOne({ sessionId });
  },
  
  findByUserId: async function(userId) {
    return Session.findOne({ userId });
  },
  
  updateLastActive: async function(sessionId) {
    return Session.findOneAndUpdate(
      { sessionId },
      { lastActive: new Date() },
      { new: true }
    );
  },
  
  updateUserName: async function(sessionId, userName) {
    return Session.findOneAndUpdate(
      { sessionId },
      { 
        userName,
        lastActive: new Date() 
      },
      { new: true }
    );
  },
  
  delete: async function(sessionId) {
    return Session.deleteOne({ sessionId });
  },
  
  cleanUp: async function() {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    return Session.deleteMany({ lastActive: { $lt: oneDayAgo } });
  }
};

const RoomService = {
  create: async function(creatorId, password = '', roomId = null) {
    roomId = roomId || generateRoomId();
    const isPasswordProtected = !!password;
    
    const room = new Room({
      roomId,
      creatorId,
      password,
      isPasswordProtected,
      created: new Date(),
      lastActive: new Date(),
      participants: []
    });
    
    await room.save();
    return room;
  },
  
  findById: async function(roomId) {
    return Room.findOne({ roomId });
  },
  
  findRoomsByUserId: async function(userId) {
    return Room.find({
      $or: [
        { creatorId: userId },
        { 'participants.userId': userId }
      ]
    }).sort({ lastActive: -1 });
  },
  
  updateLastActive: async function(roomId) {
    return Room.findOneAndUpdate(
      { roomId },
      { lastActive: new Date() },
      { new: true }
    );
  },
  
  addParticipant: async function(roomId, userId, displayName = 'Anonymous') {
    const now = new Date();
    
    return Room.findOneAndUpdate(
      { roomId },
      { 
        lastActive: now,
        $addToSet: { 
          participants: {
            userId,
            displayName,
            joinedAt: now
          }
        }
      },
      { new: true }
    );
  },
  
  removeParticipant: async function(roomId, userId) {
    return Room.findOneAndUpdate(
      { roomId },
      { 
        lastActive: new Date(),
        $pull: { participants: { userId } }
      },
      { new: true }
    );
  },
  
  updateParticipantName: async function(roomId, userId, displayName) {
    return Room.findOneAndUpdate(
      { roomId, 'participants.userId': userId },
      { 
        lastActive: new Date(),
        $set: { 'participants.$.displayName': displayName }
      },
      { new: true }
    );
  },
  
  updateParticipantStatus: async function(roomId, userId, statusUpdate) {
    const updateObj = { lastActive: new Date() };
    
    Object.keys(statusUpdate).forEach(key => {
      updateObj[`$set`] = updateObj[`$set`] || {};
      updateObj[`$set`][`participants.$.${key}`] = statusUpdate[key];
    });
    
    return Room.findOneAndUpdate(
      { roomId, 'participants.userId': userId },
      updateObj,
      { new: true }
    );
  },
  
  verifyRoom: async function(roomId, password = '') {
    const room = await Room.findOne({ roomId });
    
    if (!room) {
      return { exists: false, passwordCorrect: false };
    }
    
    const passwordCorrect = !room.isPasswordProtected || room.password === password;
    
    return { exists: true, passwordCorrect };
  },
  
  delete: async function(roomId) {
    return Room.deleteOne({ roomId });
  },
  
  cleanUp: async function() {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    return Room.deleteMany({ lastActive: { $lt: oneDayAgo } });
  }
};

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
}

module.exports = {
  mongoose,
  Session,
  Room,
  User,
  SessionService,
  RoomService
}; 