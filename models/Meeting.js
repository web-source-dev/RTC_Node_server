const mongoose = require('mongoose');
const { Schema } = mongoose;

const attendanceSnapshotSchema = new Schema({
  userId: String,
  attentionState: String,
  timestamp: { type: Date, default: Date.now }
});

const participantSchema = new Schema({
  userId: String,
  name: String,
  role: { type: String, default: 'student' },
  joinTime: Date,
  leaveTime: Date,
  attentionData: {
    attentive: { type: Number, default: 0 },
    active: { type: Number, default: 0 },
    looking_away: { type: Number, default: 0 },
    drowsy: { type: Number, default: 0 },
    sleeping: { type: Number, default: 0 },
    absent: { type: Number, default: 0 },
    darkness: { type: Number, default: 0 }
  },
  snapshots: [attendanceSnapshotSchema]
});

const meetingSchema = new Schema({
  roomId: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    default: 'Untitled Class'
  },
  creator: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  creatorName: String,
  password: String,
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: Date,
  isActive: {
    type: Boolean,
    default: true
  },
  participants: [participantSchema],
  attentionSnapshots: [attendanceSnapshotSchema],
  overallStats: {
    totalParticipants: { type: Number, default: 0 },
    maxConcurrentParticipants: { type: Number, default: 0 },
    averageAttention: { type: Number, default: 0 },
    attentiveCount: { type: Number, default: 0 },
    distractedCount: { type: Number, default: 0 },
    absentCount: { type: Number, default: 0 },
    stateBreakdown: {
      type: Map,
      of: Number
    },
    meetingDuration: { type: Number, default: 0 }
  }
});

meetingSchema.methods.saveAttentionSnapshot = async function(attentionData) {
  try {
    const timestamp = new Date();
    timestamp.setMilliseconds(0);
    console.log(`Processing attention snapshot at ${timestamp.toISOString()}`);
    
    console.log('Attention data format:', JSON.stringify(attentionData).substring(0, 200) + '...');
    
    const Meeting = this.constructor;
    
    const MAX_SNAPSHOTS = 1000;
    
    if (this.attentionSnapshots && this.attentionSnapshots.length > MAX_SNAPSHOTS) {
      console.log(`Trimming attention snapshots. Current count: ${this.attentionSnapshots.length}`);
      await Meeting.updateOne(
        { _id: this._id },
        { $push: { 
            attentionSnapshots: { 
              $each: [], 
              $slice: -MAX_SNAPSHOTS 
            } 
          }
        }
      );
    }

    let timeIncrement = 5;
    
    if (this.attentionSnapshots && this.attentionSnapshots.length > 0) {
      const lastSnapshot = this.attentionSnapshots[this.attentionSnapshots.length - 1];
      if (lastSnapshot && lastSnapshot.timestamp) {
        const lastTime = new Date(lastSnapshot.timestamp);
        const timeDiff = Math.floor((timestamp - lastTime) / 1000);
        
        if (timeDiff >= 1 && timeDiff <= 60) {
          timeIncrement = timeDiff;
          console.log(`Using actual time increment: ${timeIncrement}s`);
        } else {
          console.warn(`Unusual time increment detected: ${timeDiff}s, using default: ${timeIncrement}s`);
        }
      }
    }

    for (const userId of Object.keys(attentionData)) {
      try {
        const data = attentionData[userId];
        let state;
        
        if (typeof data === 'string') {
          state = data;
        } else if (typeof data === 'object') {
          state = data.attentionState || 
                 data.state || 
                 (data.data && data.data.attentionState) || 
                 (data.data && data.data.state);
        }
        
        const normalizedState = this.normalizeAttentionState(state);
        
        if (!normalizedState) {
          console.log(`Skipping invalid attention state for user ${userId}: ${state}`);
          continue;
        }
        
        console.log(`Recording state for user ${userId}: ${normalizedState}`);

        const participantExists = this.participants.some(p => p.userId === userId);
        
        if (!participantExists) {
          console.log(`Creating new participant record for ${userId}`);
          await Meeting.updateOne(
            { _id: this._id },
            { 
              $push: { 
                participants: {
                  userId,
                  name: 'Anonymous',
                  joinTime: timestamp,
                  attentionData: {
                    attentive: 0,
                    active: 0,
                    looking_away: 0,
                    drowsy: 0,
                    sleeping: 0,
                    absent: 0,
                    darkness: 0
                  },
                  snapshots: []
                }
              }
            }
          );
        }
        
        const updateObj = {};
        
        const MAX_PARTICIPANT_SNAPSHOTS = 200;
        
        const stateField = `participants.$[elem].attentionData.${normalizedState}`;
        
        updateObj.$inc = { [stateField]: timeIncrement };
        
        await Meeting.updateOne(
          { _id: this._id },
          { 
            $push: {
              attentionSnapshots: {
                userId,
                attentionState: normalizedState,
                timestamp
              }
            }
          }
        );
        
        await Meeting.updateOne(
          { _id: this._id },
          { 
            $push: {
              "participants.$[elem].snapshots": {
                $each: [{
                  userId,
                  attentionState: normalizedState,
                  timestamp
                }],
                $slice: -MAX_PARTICIPANT_SNAPSHOTS
              }
            },
            $inc: updateObj.$inc
          },
          { 
            arrayFilters: [{ "elem.userId": userId }],
            new: true 
          }
        );
        
        console.log(`Updated ${normalizedState} time for ${userId} by ${timeIncrement}s`);
      } catch (error) {
        console.error(`Error processing attention data for user ${userId}:`, error);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error in saveAttentionSnapshot:', error);
    return false;
  }
};

meetingSchema.methods.normalizeAttentionState = function(state) {
  if (!state) return null;
  
  const normalized = String(state).toLowerCase().trim();
  
  const validStates = {
    'attentive': 'attentive',
    'active': 'active',
    'looking_away': 'looking_away',
    'lookingaway': 'looking_away',
    'looking away': 'looking_away',
    'drowsy': 'drowsy',
    'sleeping': 'sleeping',
    'absent': 'absent',
    'darkness': 'darkness'
  };
  
  return validStates[normalized] || null;
};

meetingSchema.methods.calculateStats = async function() {
  try {
    if (!this.participants || this.participants.length === 0) {
      console.log('No participants found for stats calculation');
      return this;
    }
    
    console.log(`Calculating stats for meeting with ${this.participants.length} participants`);
    
    const Meeting = this.constructor;
    const freshMeeting = await Meeting.findById(this._id);
    
    if (!freshMeeting) {
      console.log('Meeting not found when calculating stats');
      return this;
    }

    this.participants = freshMeeting.participants;
    
    const totalParticipants = this.participants.length;
    
    const joinTimes = this.participants
      .filter(p => p.joinTime)
      .map(p => p.joinTime)
      .sort((a, b) => a - b);
      
    const leaveTimes = this.participants
      .filter(p => p.leaveTime)
      .map(p => p.leaveTime)
      .sort((a, b) => a - b);
    
    let maxConcurrent = totalParticipants;
    
    if (leaveTimes.length >= joinTimes.length / 2) {
      let current = 0;
      maxConcurrent = 0;
      
      let i = 0, j = 0;
      while (i < joinTimes.length || j < leaveTimes.length) {
        if (i >= joinTimes.length || (j < leaveTimes.length && joinTimes[i] > leaveTimes[j])) {
          current--;
          j++;
        } else {
          current++;
          maxConcurrent = Math.max(maxConcurrent, current);
          i++;
        }
      }
    }
    
    console.log(`Max concurrent participants: ${maxConcurrent}`);
    
    let meetingDuration = 0;
    if (this.startTime) {
      const endTime = this.endTime ? new Date(this.endTime) : new Date();
      const startTime = new Date(this.startTime);
      
      if (!isNaN(startTime.getTime()) && !isNaN(endTime.getTime())) {
        const durationMs = endTime.getTime() - startTime.getTime();
        
        meetingDuration = Math.max(0, Math.floor(durationMs / 1000));
        
        const MAX_DURATION = 2 * 60 * 60;
        if (meetingDuration > MAX_DURATION) {
          console.warn(`Meeting ${this._id} has excessive duration: ${meetingDuration}s. Capping to ${MAX_DURATION}s`);
          meetingDuration = MAX_DURATION;
        }
      }
    }
    
    console.log(`Meeting duration: ${meetingDuration} seconds`);
    
    let totalAttentiveTime = 0;
    let totalDistractionTime = 0;
    let totalAbsentTime = 0;
    let totalTime = 0;
    
    const stateBreakdown = {
      attentive: 0,
      active: 0,
      looking_away: 0,
      drowsy: 0,
      sleeping: 0,
      absent: 0,
      darkness: 0
    };
    
    this.participants.forEach(participant => {
      Object.keys(participant.attentionData || {}).forEach(state => {
        if (typeof participant.attentionData[state] !== 'number' || 
            isNaN(participant.attentionData[state]) ||
            participant.attentionData[state] < 0) {
          console.warn(`Invalid ${state} value for participant ${participant.userId}: ${participant.attentionData[state]}`);
          participant.attentionData[state] = 0;
        }
        
        const MAX_SECONDS = 24 * 60 * 60;
        if (participant.attentionData[state] > MAX_SECONDS) {
          console.warn(`Capping excessive ${state} time for participant ${participant.userId}: ${participant.attentionData[state]} -> ${MAX_SECONDS}`);
          participant.attentionData[state] = MAX_SECONDS;
        }
      });

      Object.keys(stateBreakdown).forEach(state => {
        const value = participant.attentionData[state] || 0;
        stateBreakdown[state] += value;
      });
      
      const attentiveTime = (participant.attentionData.attentive || 0) + (participant.attentionData.active || 0);
      const distractedTime = (participant.attentionData.looking_away || 0) + (participant.attentionData.drowsy || 0);
      const absentTime = (participant.attentionData.absent || 0) + (participant.attentionData.sleeping || 0) + (participant.attentionData.darkness || 0);
      
      const participantTotalTime = attentiveTime + distractedTime + absentTime;
      console.log(`Participant ${participant.userId} has ${participantTotalTime} seconds of attention data`);
      
      if (participantTotalTime > 0) {
        console.log(`Breakdown - Attentive: ${attentiveTime}s, Distracted: ${distractedTime}s, Absent: ${absentTime}s`);
      }
      
      totalAttentiveTime += attentiveTime;
      totalDistractionTime += distractedTime;
      totalAbsentTime += absentTime;
      totalTime += participantTotalTime;
    });
    
    if (meetingDuration > 0 && totalTime > meetingDuration) {
      const scaleFactor = meetingDuration / totalTime;
      console.log(`Scaling attention data by factor ${scaleFactor} to match meeting duration`);
      
      Object.keys(stateBreakdown).forEach(state => {
        stateBreakdown[state] = Math.floor(stateBreakdown[state] * scaleFactor);
      });
      
      totalAttentiveTime = Math.floor(totalAttentiveTime * scaleFactor);
      totalDistractionTime = Math.floor(totalDistractionTime * scaleFactor);
      totalAbsentTime = Math.floor(totalAbsentTime * scaleFactor);
      totalTime = meetingDuration;
      
      for (const participant of this.participants) {
        Object.keys(participant.attentionData).forEach(state => {
          participant.attentionData[state] = Math.floor(participant.attentionData[state] * scaleFactor);
        });
      }
    }
    
    console.log(`Total times - Attentive: ${totalAttentiveTime}s, Distracted: ${totalDistractionTime}s, Absent: ${totalAbsentTime}s`);
    
    const averageAttention = totalTime > 0 ? parseFloat(((totalAttentiveTime / totalTime) * 100).toFixed(2)) : 0;
    console.log(`Average attention: ${averageAttention}%`);
    
    for (const participant of this.participants) {
      await Meeting.updateOne(
        { 
          _id: this._id,
          "participants.userId": participant.userId
        },
        {
          $set: {
            "participants.$.attentionData": participant.attentionData
          }
        }
      );
    }
    
    await Meeting.updateOne(
      { _id: this._id },
      {
        $set: {
          'overallStats.totalParticipants': totalParticipants,
          'overallStats.maxConcurrentParticipants': maxConcurrent,
          'overallStats.averageAttention': averageAttention,
          'overallStats.attentiveCount': totalAttentiveTime,
          'overallStats.distractedCount': totalDistractionTime,
          'overallStats.absentCount': totalAbsentTime,
          'overallStats.stateBreakdown': stateBreakdown,
          'overallStats.meetingDuration': meetingDuration
        }
      }
    );
    
    console.log('Stats calculation complete');
    return this;
  } catch (error) {
    console.error('Error calculating stats:', error);
    return this;
  }
};

const Meeting = mongoose.model('Meeting', meetingSchema);

module.exports = Meeting; 