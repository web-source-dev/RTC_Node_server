const mongoose = require('mongoose');
const { Schema } = mongoose;

const attentionLogSchema = new Schema({
  meetingId: {
    type: Schema.Types.ObjectId,
    ref: 'Meeting',
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  userName: {
    type: String,
    default: 'Anonymous'
  },
  attentionState: {
    type: String,
    enum: ['attentive', 'active', 'looking_away', 'drowsy', 'absent', 'darkness'],
    required: true
  },
  attentionPercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  confidence: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  measurements: {
    brightness: Number,
    contrast: Number,
    facePresence: Number,
    eyeOpenness: Number,
    lookingScore: Number
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  sessionId: {
    type: String,
    required: true
  },
  roomId: {
    type: String,
    required: true
  }
});

// Indexes for efficient querying
attentionLogSchema.index({ meetingId: 1, timestamp: -1 });
attentionLogSchema.index({ userId: 1, timestamp: -1 });
attentionLogSchema.index({ roomId: 1, timestamp: -1 });
attentionLogSchema.index({ attentionState: 1, timestamp: -1 });

// Compound index for analytics queries
attentionLogSchema.index({ meetingId: 1, userId: 1, timestamp: -1 });

const AttentionLog = mongoose.model('AttentionLog', attentionLogSchema);

module.exports = AttentionLog; 