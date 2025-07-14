# Attention Logging System

This document describes the new attention logging system that stores detailed attention data in the database for accurate analytics.

## Overview

The logging system consists of:

1. **Log Model** (`models/Log.js`) - Stores detailed attention logs
2. **Log Routes** (`routes/logs.js`) - Handles log storage and retrieval
3. **Attention Server Integration** - Sends logs from attention detection
4. **Frontend Integration** - Passes meeting data for logging

## Database Schema

### AttentionLog Model

```javascript
{
  meetingId: ObjectId,        // Reference to meeting
  userId: String,             // User identifier
  userName: String,           // User display name
  attentionState: String,     // 'attentive', 'active', 'looking_away', 'drowsy', 'absent', 'darkness'
  attentionPercentage: Number, // 0-100
  confidence: Number,         // 0-100
  measurements: {             // Raw detection measurements
    brightness: Number,
    contrast: Number,
    facePresence: Number,
    eyeOpenness: Number,
    lookingScore: Number
  },
  timestamp: Date,            // When the log was created
  sessionId: String,          // Session identifier
  roomId: String             // Room identifier
}
```

## API Endpoints

### Store Attention Log
```
POST /api/logs/attention
Content-Type: application/json

{
  "meetingId": "meeting_id",
  "userId": "user_id",
  "userName": "User Name",
  "attentionState": "attentive",
  "attentionPercentage": 95,
  "confidence": 85,
  "measurements": {...},
  "sessionId": "session_id",
  "roomId": "room_id"
}
```

### Get Analytics from Logs
```
GET /api/logs/meeting/:meetingId/analytics
Authorization: Bearer <token>
```

Returns analytics calculated from stored logs instead of meeting snapshots.

## Integration Points

### Attention Server (Python)
- Modified `routes.py` to send logs to Node.js server
- Added `send_log_to_server()` function
- Updated `detect_attention` endpoint to include meeting data

### Frontend (React)
- Updated `attentionApi.js` to accept meeting data
- Modified `AttentionContext.js` to pass meeting data
- Updated `MeetingAnalytics.js` to use logs-based analytics

### Node.js Server
- Added log routes to main server
- Integrated with existing meeting system
- Provides fallback to meeting-based analytics

## Benefits

1. **Accurate Analytics** - Based on actual attention detection logs
2. **Detailed Data** - Stores raw measurements and confidence scores
3. **Real-time Processing** - Logs are stored as they're generated
4. **Scalable** - Efficient database queries with proper indexing
5. **Backward Compatible** - Falls back to meeting-based analytics if logs unavailable

## Usage

1. Start the attention server with `NODE_SERVER_URL` environment variable
2. Ensure MongoDB is running
3. The system will automatically start logging attention data
4. Analytics will be calculated from logs when available

## Testing

Run the test script to verify functionality:
```bash
node test_logs.js
```

## Environment Variables

- `NODE_SERVER_URL` - URL of the Node.js server (default: http://localhost:3001) 