# WebRTC Signaling Server

This is the signaling server for the WebRTC video conferencing application. It handles:

- WebSocket connections via Socket.io
- Room creation and management
- WebRTC signaling (offer/answer exchange, ICE candidates)
- Session persistence using MongoDB

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Configure environment variables by creating a `.env` file:
   ```
   PORT=3001
   MONGO_URI=mongodb://localhost:27017/rtc_app
   NODE_ENV=development
   ```

3. Start the server:
   ```
   npm start
   ```

## API

The server uses Socket.io for real-time communication with clients. Main events:

### Connection Events
- `connection` - New client connected
- `disconnect` - Client disconnected

### Session Events
- `restore-session` - Restore a previous session
- `session-restored` - Session restored successfully
- `session-created` - New session created

### Room Events
- `create-room` - Create a new room
- `join-room` - Join an existing room
- `leave-room` - Leave current room
- `room-created` - Room created successfully
- `room-joined` - Joined room successfully
- `user-joined` - New user joined room
- `user-left` - User left room

### WebRTC Signaling
- `offer` - WebRTC offer
- `answer` - WebRTC answer
- `ice-candidate` - ICE candidate
- `ready` - User ready for WebRTC connections

### Chat
- `chat-message` - Chat message
- `system-message` - System notification

## Database

The server uses MongoDB for data persistence. Main collections:

- `sessions` - User sessions
- `rooms` - Video conference rooms
- `participants` - Room participants

## Integration with React

This server is designed to work with the React frontend in the `rtc-app-react` directory. The server serves the built React app from `rtc-app-react/build`. 