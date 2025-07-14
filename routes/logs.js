const express = require('express');
const router = express.Router();
const AttentionLog = require('../models/Log');
const Meeting = require('../models/Meeting');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Store attention log from attention server
router.post('/attention', async (req, res) => {
  try {
    const {
      meetingId,
      userId,
      userName,
      attentionState,
      attentionPercentage,
      confidence,
      measurements,
      sessionId,
      roomId
    } = req.body;

    if (!meetingId || !userId || !attentionState || !sessionId || !roomId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const log = new AttentionLog({
      meetingId,
      userId,
      userName: userName || 'Anonymous',
      attentionState,
      attentionPercentage: attentionPercentage || 0,
      confidence: confidence || 0,
      measurements: measurements || {},
      sessionId,
      roomId,
      timestamp: new Date()
    });

    await log.save();

    res.status(201).json({
      success: true,
      message: 'Log stored successfully'
    });

  } catch (error) {
    console.error('Error storing attention log:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get analytics data from logs for a meeting
router.get('/meeting/:meetingId/analytics', auth, async (req, res) => {
  try {
    const { meetingId } = req.params;

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    const logs = await AttentionLog.find({ meetingId }).sort({ timestamp: 1 });

    if (logs.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          overview: {
            totalLogs: 0,
            totalParticipants: 0,
            averageAttention: 0,
            stateBreakdown: {}
          },
          participantData: [],
          timeSeriesData: [],
          attentionStates: {}
        }
      });
    }

    // Create mapping from socket IDs to user names using meeting participants
    const participantNameMap = {};
    if (meeting.participants && meeting.participants.length > 0) {
      meeting.participants.forEach(participant => {
        if (participant.userId && participant.name) {
          participantNameMap[participant.userId] = participant.name;
        }
      });
    }

    // Calculate analytics from logs
    const participantData = {};
    const stateBreakdown = {
      attentive: 0,
      active: 0,
      looking_away: 0,
      drowsy: 0,
      absent: 0,
      darkness: 0
    };

    let totalAttentionPercentage = 0;
    let totalLogs = 0;

    logs.forEach(log => {
      // Get user name from meeting participants or fallback to log userName
      const userName = participantNameMap[log.userId] || log.userName || 'Anonymous';
      
      if (!participantData[log.userId]) {
        participantData[log.userId] = {
          userId: log.userId,
          userName: userName,
          totalLogs: 0,
          attentionStates: { ...stateBreakdown },
          totalAttentionPercentage: 0,
          averageAttention: 0,
          firstSeen: log.timestamp,
          lastSeen: log.timestamp
        };
      }

      participantData[log.userId].totalLogs++;
      participantData[log.userId].attentionStates[log.attentionState]++;
      participantData[log.userId].totalAttentionPercentage += log.attentionPercentage;
      participantData[log.userId].lastSeen = log.timestamp;

      stateBreakdown[log.attentionState]++;
      totalAttentionPercentage += log.attentionPercentage;
      totalLogs++;
    });

    const averageAttention = totalLogs > 0 ? totalAttentionPercentage / totalLogs : 0;

    // Calculate meeting duration
    let duration = 0;
    if (meeting.startTime) {
      console.log(`Calculating duration for meeting ${meeting._id} (logs analytics):`, {
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        isActive: meeting.isActive
      });
      
      if (meeting.endTime) {
        const endTime = new Date(meeting.endTime);
        const startTime = new Date(meeting.startTime);
        
        console.log(`Meeting has end time. Calculating duration (logs):`, {
          startTime: startTime,
          endTime: endTime,
          startTimeMs: startTime.getTime(),
          endTimeMs: endTime.getTime()
        });
        
        if (!isNaN(endTime.getTime()) && !isNaN(startTime.getTime())) {
          const durationMs = endTime.getTime() - startTime.getTime();
          duration = Math.max(0, Math.floor(durationMs / 1000));
          
          console.log(`Duration calculation (logs):`, {
            durationMs: durationMs,
            durationSeconds: duration
          });
          
          const MAX_DURATION = 2 * 60 * 60; // 2 hours max
          if (duration > MAX_DURATION) {
            console.warn(`Meeting ${meeting._id} has excessive duration: ${duration}s. Capping to ${MAX_DURATION}s`);
            duration = MAX_DURATION;
          }
        } else {
          console.warn(`Invalid timestamps for meeting ${meeting._id} (logs):`, {
            startTimeValid: !isNaN(startTime.getTime()),
            endTimeValid: !isNaN(endTime.getTime())
          });
        }
      } else {    
        const now = new Date();
        const startTime = new Date(meeting.startTime);
        
        console.log(`Meeting is active. Calculating current duration (logs):`, {
          startTime: startTime,
          now: now,
          startTimeMs: startTime.getTime(),
          nowMs: now.getTime()
        });
        
        if (!isNaN(startTime.getTime())) {
          const durationMs = now.getTime() - startTime.getTime();
          duration = Math.max(0, Math.floor(durationMs / 1000));
          
          console.log(`Current duration calculation (logs):`, {
            durationMs: durationMs,
            durationSeconds: duration
          });
          
          const MAX_DURATION = 2 * 60 * 60; // 2 hours max
          if (duration > MAX_DURATION) {
            console.warn(`Meeting ${meeting._id} has excessive duration: ${duration}s. Capping to ${MAX_DURATION}s`);
            duration = MAX_DURATION;
          }
        } else {
          console.warn(`Invalid start time for meeting ${meeting._id} (logs):`, startTime);
        }
      }
    } else {
      console.warn(`Meeting ${meeting._id} has no start time (logs)`);
    }
    
    console.log(`Final duration for meeting ${meeting._id} (logs): ${duration} seconds`);

    const processedParticipantData = Object.values(participantData).map(participant => {
      const totalParticipantLogs = participant.totalLogs;
      const averageParticipantAttention = totalParticipantLogs > 0 
        ? participant.totalAttentionPercentage / totalParticipantLogs 
        : 0;

      return {
        ...participant,
        averageAttention: Math.round(averageParticipantAttention * 100) / 100
      };
    });

    // Generate time series data
    const timeSeriesData = [];
    const timeGroups = {};

    logs.forEach(log => {
      const timestamp = new Date(log.timestamp);
      timestamp.setSeconds(0, 0);
      const timeKey = timestamp.toISOString();

      if (!timeGroups[timeKey]) {
        timeGroups[timeKey] = {
          timestamp: timeKey,
          total: 0,
          attentive: 0,
          active: 0,
          looking_away: 0,
          drowsy: 0,
          absent: 0,
          darkness: 0
        };
      }

      timeGroups[timeKey].total++;
      timeGroups[timeKey][log.attentionState]++;
    });

    Object.values(timeGroups).forEach(group => {
      const dataPoint = { timestamp: group.timestamp };
      
      if (group.total > 0) {
        Object.keys(stateBreakdown).forEach(state => {
          dataPoint[state] = Math.round((group[state] / group.total) * 100 * 100) / 100;
        });
      } else {
        Object.keys(stateBreakdown).forEach(state => {
          dataPoint[state] = 0;
        });
      }
      
      timeSeriesData.push(dataPoint);
    });

    timeSeriesData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalLogs,
          totalParticipants: processedParticipantData.length,
          averageAttention: Math.round(averageAttention * 100) / 100,
          stateBreakdown
        },
        participantData: processedParticipantData,
        timeSeriesData,
        attentionStates: stateBreakdown,
        duration: duration
      }
    });

  } catch (error) {
    console.error('Error fetching analytics from logs:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router; 