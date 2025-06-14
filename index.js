const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('./db');
const dotenv = require('dotenv');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const authRoutes = require('./routes/auth');
const auth = require('./middleware/auth');
const User = require('./models/User');
const AuthService = require('./services/AuthService');
const meetingRoutes = require('./routes/meetings');
const Meeting = require('./models/Meeting');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    allowedHeaders: ["my-custom-header", "Authorization"],
    credentials: true
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use('/api/auth', authRoutes);
app.use('/api/meetings', meetingRoutes);

if (process.env.NODE_ENV !== 'production') {
  app.get('/api/debug/rooms', (req, res) => {
    try {
      const roomList = Object.keys(rooms).map(roomId => {
        const room = rooms[roomId];
        return {
          id: roomId,
          creatorId: room.creatorId,
          hasPassword: !!room.password,
          participantCount: room.participants.length,
          participants: room.participants.map(p => ({
            id: p.id,
            displayName: p.displayName,
            inactive: p.inactive || false
          })),
          createdAt: room.createdAt
        };
      });

      res.json({
        success: true,
        count: roomList.length,
        rooms: roomList
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
}

app.get('/api/protected', auth, (req, res) => {
  res.json({
    success: true,
    message: 'This is a protected route',
    user: req.user
  });
});

const rooms = {};
const sessions = {};

async function loadActiveRoomsFromDatabase() {
  try {
    console.log('Loading active rooms from database...');
    
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const activeRooms = await db.Room.find({ lastActive: { $gt: oneDayAgo } });
    
    console.log(`Found ${activeRooms.length} active rooms in the database`);
    
    for (const dbRoom of activeRooms) {
      rooms[dbRoom.roomId] = {
        id: dbRoom.roomId,
        creatorId: dbRoom.creatorId,
        password: dbRoom.password || '',
        participants: dbRoom.participants.map(p => ({
          id: p.userId,
          displayName: p.displayName || 'Anonymous',
          inactive: true
        })),
        createdAt: dbRoom.created
      };
      
      console.log(`Loaded room ${dbRoom.roomId} with ${dbRoom.participants.length} participants`);
    }
    
    console.log('Finished loading active rooms');
  } catch (error) {
    console.error('Error loading active rooms from database:', error);
  }
}

loadActiveRoomsFromDatabase();

function hashPassword(password) {
  if (!password) return null;
  return crypto.createHash('sha256').update(password).digest('hex');
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../rtc-app-react/build/index.html'));
});

app.get('/room', (req, res) => {
  res.sendFile(path.join(__dirname, '../rtc-app-react/build/index.html'));
});

app.get('/join/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, '../rtc-app-react/build/index.html'));
});

app.get('/setup', (req, res) => {
  res.sendFile(path.join(__dirname, '../rtc-app-react/build/index.html'));
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../rtc-app-react/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../rtc-app-react/build', 'index.html'));
  });
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      socket.user = null;
      console.log(`Socket ${socket.id} connected without authentication`);
      return next();
    }
    
    try {
          const decoded = AuthService.verifyToken(token);
      
      socket.user = decoded;
      
      try {
        const user = await User.findById(decoded.id);
        if (user) {
          socket.user.userId = user.userId;
          console.log(`Socket ${socket.id} authenticated as user ${user.name} (${user.userId})`);
        } else {
          console.warn(`Socket ${socket.id} authenticated with valid token but user not found in DB`);
        }
      } catch (err) {
        console.error('Error finding user:', err);
      }
      
      return next();
    } catch (error) {
      console.error(`Socket ${socket.id} authentication error:`, error.message);
      socket.user = null;
      return next();
    }
  } catch (error) {
    console.error(`Socket middleware error:`, error.message);
    return next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  let currentUser = {
    id: socket.id,
    displayName: socket.user ? socket.user.name : 'Anonymous',
    room: null,
    sessionId: null,
    userId: socket.user ? socket.user.userId || socket.user.id : null
  };

  socket.on('restore-session', async ({ sessionId, userId, displayName }) => {
    try {
      let session = null;
      
      if (socket.user) {
        currentUser.displayName = socket.user.name;
        currentUser.userId = socket.user.userId || socket.user.id;
        
        const existingSession = await db.SessionService.findByUserId(currentUser.userId);
        if (existingSession) {
          session = existingSession;
          currentUser.sessionId = session.sessionId;
        }
      } else if (displayName && displayName.trim() !== '' && displayName !== 'Anonymous') {
        currentUser.displayName = displayName.trim();
      }
      
      if (sessionId && !session) {
        session = await db.SessionService.findById(sessionId);
        
        if (session) {
          await db.SessionService.updateLastActive(sessionId);
          
          currentUser.sessionId = session.sessionId;
          currentUser.id = session.userId || socket.id;
          
          if (session.userName && session.userName !== 'Anonymous') {
            currentUser.displayName = session.userName;
          }
          
          console.log(`Session restored: ${sessionId} for user ${currentUser.id} with name "${currentUser.displayName}"`);
          
          sessions[sessionId] = {
            userId: currentUser.id,
            userName: currentUser.displayName,
            lastActive: new Date()
          };
          
          const userRooms = await db.RoomService.findRoomsByUserId(currentUser.id);
          let recentRoom = null;
          
          if (userRooms && userRooms.length > 0) {
            recentRoom = userRooms[0];
            console.log(`Found recent room for user: ${recentRoom.roomId}`);
            
            if (!rooms[recentRoom.roomId]) {
              rooms[recentRoom.roomId] = {
                id: recentRoom.roomId,
                creatorId: recentRoom.creatorId,
                password: recentRoom.password,
                participants: recentRoom.participants.map(p => ({
                  id: p.userId,
                  displayName: p.displayName !== 'Anonymous' ? p.displayName : currentUser.displayName
                })),
                createdAt: recentRoom.created
              };
            }
            
            if (!rooms[recentRoom.roomId].participants.some(p => p.id === currentUser.id)) {
              rooms[recentRoom.roomId].participants.push({
                id: currentUser.id,
                displayName: currentUser.displayName
              });
            } else {
              const participant = rooms[recentRoom.roomId].participants.find(p => p.id === currentUser.id);
              if (participant) {
                participant.displayName = currentUser.displayName;
              }
            }
            
            socket.join(recentRoom.roomId);
            currentUser.room = recentRoom.roomId;
          }
          
          const responseData = {
            sessionId: session.sessionId,
            userId: currentUser.id,
            userName: currentUser.displayName
          };
          
          if (recentRoom) {
            responseData.roomId = recentRoom.roomId;
            responseData.isRoomCreator = recentRoom.creatorId === currentUser.id;
            responseData.isPasswordProtected = recentRoom.isPasswordProtected;
          }
          
          socket.emit('session-restored', responseData);
          return;
        }
      }
      
      if (!session) {
        const sessionUserId = currentUser.userId || socket.id;
        session = await db.SessionService.create(sessionUserId, currentUser.displayName);
        currentUser.sessionId = session.sessionId;
        
        sessions[session.sessionId] = {
          userId: sessionUserId,
          userName: currentUser.displayName,
          lastActive: new Date()
        };
      }
      
      socket.emit('session-created', {
        sessionId: session.sessionId,
        userId: currentUser.userId || socket.id,
        userName: currentUser.displayName
      });
      
      console.log(`New session created: ${session.sessionId} for user ${currentUser.userId || socket.id} with name "${currentUser.displayName}"`);
    } catch (error) {
      console.error('Error managing session:', error);
      socket.emit('error', { message: 'Session management error' });
    }
  });

  socket.on('set-display-name', async ({ displayName }) => {
    currentUser.displayName = displayName || 'Anonymous';
    
    if (currentUser.sessionId) {
      try {
        await db.SessionService.updateUserName(currentUser.sessionId, currentUser.displayName);
        
        if (sessions[currentUser.sessionId]) {
          sessions[currentUser.sessionId].userName = currentUser.displayName;
        }
      } catch (error) {
        console.error('Error updating display name in session:', error);
      }
    }
    
    if (currentUser.room && rooms[currentUser.room]) {
      const room = rooms[currentUser.room];
      const participant = room.participants.find(p => p.id === socket.id);
      if (participant) {
        participant.displayName = currentUser.displayName;
        
        try {
          await db.RoomService.updateParticipantName(
            currentUser.room, 
            socket.id, 
            currentUser.displayName
          );
        } catch (error) {
          console.error('Error updating participant name in room:', error);
        }
        
        socket.to(currentUser.room).emit('user-updated', {
          userId: socket.id,
          displayName: currentUser.displayName
        });
      }
    }
  });

  socket.on('user-joined', ({ userId, displayName }) => {
    if (currentUser.room) {
      const room = rooms[currentUser.room];
      if (room) {
        if (displayName) {
          currentUser.displayName = displayName;
          
          const participant = room.participants.find(p => p.id === socket.id);
          if (participant) {
            participant.displayName = displayName;
          }
        }
        
        socket.to(currentUser.room).emit('user-joined', {
          userId: socket.id,
          displayName: currentUser.displayName
        });
        
        socket.to(currentUser.room).emit('user-updated', {
          userId: socket.id,
          displayName: currentUser.displayName
        });
      }
    }
  });

  socket.on('create-room', async ({ roomId: requestedRoomId, password, reconnect, userId, title }) => {
    try {
      password = password || '';
      
      console.log(`User ${socket.id} is creating${reconnect ? ' (reconnecting to)' : ''} a room${requestedRoomId ? ` with ID ${requestedRoomId}` : ''}`);
      
      if (reconnect && requestedRoomId) {
        let existingRoom = rooms[requestedRoomId];
        
        if (!existingRoom) {
          console.log(`Room ${requestedRoomId} not found in memory for reconnection, checking database`);
          try {
            const dbRoom = await db.RoomService.findById(requestedRoomId);
            
            if (dbRoom) {
              console.log(`Room ${requestedRoomId} found in database, loading into memory`);
              
              rooms[requestedRoomId] = {
                id: dbRoom.roomId,
                creatorId: dbRoom.creatorId,
                password: dbRoom.password || '',
                participants: dbRoom.participants.map(p => ({
                  id: p.userId,
                  displayName: p.displayName || 'Anonymous',
                  inactive: p.inactive || false
                })),
                createdAt: dbRoom.created
              };
              
              existingRoom = rooms[requestedRoomId];
              console.log(`Room ${requestedRoomId} loaded into memory with ${existingRoom.participants.length} participants`);
            }
          } catch (dbError) {
            console.error(`Error fetching room ${requestedRoomId} from database:`, dbError);
          }
        }
        
        if (existingRoom) {
          console.log(`Room ${requestedRoomId} found for reconnection`);
          
          if (userId && existingRoom.creatorId === userId) {
            if (userId !== socket.id) {
              console.log(`Updating socket ID from ${socket.id} to ${userId} for creator reconnection`);
              currentUser.id = userId;
            }
            
            socket.join(requestedRoomId);
            currentUser.room = requestedRoomId;
            
            if (!existingRoom.participants.some(p => p.id === currentUser.id)) {
              existingRoom.participants.push({
                id: currentUser.id,
                displayName: currentUser.displayName
              });
            }
            
            socket.emit('room-created', {
              roomId: requestedRoomId,
              password: existingRoom.password,
              participants: existingRoom.participants.map(p => ({
                id: p.id,
                displayName: p.displayName
              }))
            });
            
            socket.to(requestedRoomId).emit('user-joined', {
              userId: currentUser.id,
              displayName: currentUser.displayName
            });
            
            try {
              await db.RoomService.updateLastActive(requestedRoomId);
              
              await db.RoomService.addParticipant(
                requestedRoomId,
                currentUser.id,
                currentUser.displayName
              );
            } catch (error) {
              console.warn(`Failed to update room in database: ${error.message}`);
            }
            
            console.log(`User ${currentUser.id} reconnected to room ${requestedRoomId} as creator`);
            return;
          } else {
            console.log(`User ${socket.id} attempted to reconnect as creator to room ${requestedRoomId} but is not the creator`);
          }
        } else {
          console.log(`Room ${requestedRoomId} not found for reconnection, creating new room`);
        }
      }

      const generateRoomId = () => {  
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let result = '';
        
        for (let i = 0; i < 6; i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        return result;
      };
      
      const roomId = requestedRoomId || generateRoomId();
      console.log(`Creating room with ID: ${roomId}`);
      
      rooms[roomId] = {
        id: roomId,
        creatorId: currentUser.id,
        password,
        participants: [{ 
          id: currentUser.id,
          displayName: currentUser.displayName 
        }],
        createdAt: new Date()
      };
    
      try {
        const dbRoom = await db.RoomService.create(currentUser.id, password, roomId);
        console.log(`Room ${roomId} created in database with ID: ${dbRoom.roomId}`);
        
        await db.RoomService.addParticipant(
          roomId,
          currentUser.id,
          currentUser.displayName
        );
        console.log(`Added creator ${currentUser.id} to room ${roomId} participants in database`);
      } catch (error) {
        console.warn(`Failed to store room in database: ${error.message}`);
      }
      
      socket.join(roomId);
      currentUser.room = roomId;
      
      socket.emit('room-created', { 
        roomId,
        password,
        participants: rooms[roomId].participants
      });
      
      console.log(`Room created: ${roomId} by user ${currentUser.id} with name "${currentUser.displayName}"`);

      try {
        let user = null;
        
        if (socket.user && socket.user.userId) {
          user = await User.findOne({ userId: socket.user.userId });
        }
        
        const meeting = new Meeting({
          roomId: roomId,
          title: title || 'Untitled Class',
          creator: user ? user._id : null,
          creatorName: currentUser.displayName || 'Anonymous',
          password: password || null,
          startTime: new Date(),
          isActive: true
        });
        
        meeting.participants.push({
          userId: socket.id,
          name: currentUser.displayName || 'Anonymous',
          role: user ? user.role || 'instructor' : 'instructor',
          joinTime: new Date(),
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
        });
        
        await meeting.save();
        console.log(`Created meeting record for room ${roomId}`);
      } catch (error) {
        console.error('Error creating meeting record:', error);
      }
    } catch (error) {
      console.error('Error creating room:', error);
      socket.emit('error', { message: 'Could not create room', details: error.message });
    }
  });

  socket.on('join-room', async ({ roomId, password, displayName, userId, rejoin }) => {
    try {
      console.log(`User ${socket.id} attempting to join room ${roomId}`);
      
      if (displayName) {
        currentUser.displayName = displayName;
      }
      
      if (currentUser.room) {
        console.log(`User ${socket.id} is already in room ${currentUser.room}, leaving first`);
        const prevRoom = rooms[currentUser.room];
        if (prevRoom) {
          prevRoom.participants = prevRoom.participants.filter(p => p.id !== socket.id);
          
          socket.to(currentUser.room).emit('user-left', {
            userId: socket.id,
            reason: 'joining_another_room'
          });
        }
        
        socket.leave(currentUser.room);
        currentUser.room = null;
      }
      
      if (userId) {
        console.log(`User provided ID: ${userId}, using instead of socket ID`);
        currentUser.id = userId;
      }
      
      let room = rooms[roomId];
      
      if (!room) {
        console.log(`Room ${roomId} not found in memory, checking database`);
        try {
          const dbRoom = await db.RoomService.findById(roomId);
          
          if (dbRoom) {
            console.log(`Room ${roomId} found in database, loading into memory`);
            
            rooms[roomId] = {
              id: dbRoom.roomId,
              creatorId: dbRoom.creatorId,
              password: dbRoom.password || '',
              participants: dbRoom.participants.map(p => ({
                id: p.userId,
                displayName: p.displayName || 'Anonymous'
              })),
              createdAt: dbRoom.created
            };
            
            room = rooms[roomId];
          } else {
            console.log(`Room ${roomId} not found in database`);
            socket.emit('room-error', { 
              code: 'room_not_found',
              message: 'The room does not exist' 
            });
            return;
          }
        } catch (error) {
          console.error(`Error fetching room ${roomId} from database:`, error);
          socket.emit('room-error', { 
            code: 'database_error',
            message: 'Error retrieving room information' 
          });
        return;
        }
      }
    
      if (room.password && room.password !== password) {
        console.log(`Incorrect password for room ${roomId}`);
        socket.emit('room-error', { 
          code: 'incorrect_password',
          message: 'Incorrect room password' 
        });
        return;
      }

      socket.join(roomId);
      currentUser.room = roomId;
    
      const participantsToSend = room.participants
        .filter(p => p.id !== socket.id)
        .map(p => ({
          id: p.id,
          displayName: p.displayName || 'Anonymous'
        }));
      
      const existingParticipant = room.participants.find(p => p.id === socket.id);
      if (!existingParticipant) {
        room.participants.push({
          id: socket.id,
          displayName: currentUser.displayName || 'Anonymous'
        });
      }
      
      socket.emit('room-joined', {
        roomId, 
        participants: participantsToSend,
        isPasswordProtected: !!room.password
      });
      
      socket.to(roomId).emit('user-joined', {
        userId: socket.id,
        displayName: currentUser.displayName || 'Anonymous'
      });
      
      socket.to(roomId).emit('user-updated', {
        userId: socket.id,
        displayName: currentUser.displayName || 'Anonymous'
      });
      
      try {
        await db.RoomService.updateLastActive(roomId);
        
        await db.RoomService.addParticipant(
          roomId,
          socket.id,
          currentUser.displayName || 'Anonymous'
        );
      } catch (error) {
        console.warn(`Failed to update room in database: ${error.message}`);
      }
      
      console.log(`User ${socket.id} joined room ${roomId}`);

      try {
        const meeting = await Meeting.findOne({ roomId });
        
        if (meeting) {
          let participant = meeting.participants.find(p => p.userId === socket.id);
          
          if (!participant) {
            console.log(`Adding new participant ${socket.id} to meeting ${roomId}`);
            
            meeting.participants.push({
              userId: socket.id,
              name: currentUser.displayName || 'Anonymous',
              role: socket.user?.role || 'student',
              joinTime: new Date(),
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
            });
            
            await meeting.save();
            console.log(`Added participant ${socket.id} to meeting ${roomId}`);
          } else {
            console.log(`Participant ${socket.id} already exists in meeting ${roomId}`);

            if (!participant.joinTime) {
              participant.joinTime = new Date();
            }
            
            if (participant.leaveTime) {
              console.log(`Participant ${socket.id} is rejoining, clearing leave time`);
              participant.leaveTime = null;
              await meeting.save();
            }
          }
        } else {
          console.log(`No meeting found for room ${roomId}`);
        }
      } catch (error) {
        console.error('Error adding participant to meeting:', error);
      }
    } catch (error) {
      console.error(`Error joining room ${roomId}:`, error);
      socket.emit('room-error', { 
        code: 'join_error', 
        message: 'Error joining room' 
      });
    }
  });

  socket.on('offer', ({ target, offer }) => {
    socket.to(target).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ target, answer }) => {
    socket.to(target).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ target, candidate, displayName }) => {
    socket.to(target).emit('ice-candidate', { 
      from: socket.id, 
      candidate,
      displayName: displayName || currentUser.displayName || 'Anonymous'
    });
  });

  socket.on('ready', ({ roomId, displayName }) => {
    try {
      console.log(`User ${socket.id} is ready for connections in room ${roomId}`);
      
      if (!currentUser.room || currentUser.room !== roomId) {
        console.warn(`User ${socket.id} is not in room ${roomId}`);
      return;
    }

      if (displayName) {
        currentUser.displayName = displayName;
        
        const room = rooms[roomId];
        if (room) {
          const participant = room.participants.find(p => p.id === socket.id);
        if (participant) {
            participant.displayName = displayName;
        }
      }
    }
    
    socket.to(roomId).emit('user-ready', {
      userId: socket.id,
        displayName: currentUser.displayName || 'Anonymous'
    });
      
      socket.to(roomId).emit('user-updated', {
        userId: socket.id,
        displayName: currentUser.displayName || 'Anonymous'
      });

      const room = rooms[roomId];
      if (room) {
        room.participants.forEach(participant => {
          if (participant.id !== socket.id) {
            socket.to(participant.id).emit('initiate-offer', { 
              target: socket.id,
              displayName: currentUser.displayName || 'Anonymous'
            });
          }
        });
      }
    } catch (error) {
      console.error('Error in ready event:', error);
    }
  });

  socket.on('chat-message', ({ message, displayName }) => {
    if (!currentUser.room) return;
    
    const senderName = displayName || currentUser.displayName || 'Anonymous';
    
    const messageData = {
      userId: socket.id,
      from: socket.id,
      displayName: senderName,
      text: message,
      timestamp: Date.now(),
      sender: {
        id: socket.id,
        displayName: senderName
      }
    };
    
    io.to(currentUser.room).emit('chat-message', messageData);
  });

  socket.on('rejoin-room', async ({ roomId, userId, sessionId, displayName }) => {
    try {
      if (displayName) {
        currentUser.displayName = displayName;
        console.log(`Updated display name for ${socket.id} to "${displayName}"`);
      }
      
      console.log(`User ${socket.id} is trying to rejoin room ${roomId}, with userId ${userId} and name "${currentUser.displayName}"`);
      
      const room = rooms[roomId];
      
      if (!room) {
        console.log(`Room ${roomId} not found for rejoin`);
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      
      const userId_to_find = userId || socket.id;
      
      console.log(`Looking for participant with ID ${userId_to_find} in room ${roomId}`);
      
      const userRooms = await db.RoomService.findRoomsByUserId(userId_to_find);
      let wasInRoom = userRooms && userRooms.some(r => r.roomId === roomId);
      
      let existingParticipant = room.participants.find(p => p.id === userId_to_find);

      let inactiveParticipant = room.participants.find(p => 
        p.inactive && (
          p.id === userId_to_find || 
          p.previousId === userId_to_find || 
          p.previousSocketId === userId_to_find ||
          (currentUser.displayName && p.displayName === currentUser.displayName)
        )
      );
      
      const isDuplicateName = currentUser.displayName && 
                              currentUser.displayName !== 'Anonymous' && 
                              room.participants.some(p => 
                                p.displayName === currentUser.displayName && 
                                p.id !== socket.id && 
                                p.id !== userId_to_find
                              );
      
      console.log(`Room ${roomId} check: wasInRoom=${wasInRoom}, existingParticipant=${!!existingParticipant}, inactiveParticipant=${!!inactiveParticipant}, isDuplicateName=${isDuplicateName}`);
      
      if (wasInRoom || existingParticipant || inactiveParticipant || isDuplicateName) {
        console.log(`User ${userId_to_find} found in room ${roomId} history, rejoining`);
        
        if (isDuplicateName && !inactiveParticipant) {
          inactiveParticipant = room.participants.find(p => 
            p.displayName === currentUser.displayName && 
            p.id !== socket.id && 
            p.id !== userId_to_find
          );
          console.log(`Found duplicate name match: ${inactiveParticipant?.id}`);
        }
        
        const originalId = inactiveParticipant ? inactiveParticipant.id : userId_to_find;
        
        const participantToUpdate = inactiveParticipant || existingParticipant;
        
        if (inactiveParticipant) {
          console.log(`Found inactive participant ${inactiveParticipant.id} with previous ID ${inactiveParticipant.previousId || inactiveParticipant.id}, replacing with new connection ${socket.id}`);
          
          const index = room.participants.findIndex(p => p.id === inactiveParticipant.id);
          if (index !== -1) {
            room.participants.splice(index, 1);
          }
          
          if (currentUser.displayName && currentUser.displayName !== 'Anonymous') {
            const staleIndices = [];
            room.participants.forEach((p, idx) => {
              if (p.displayName === currentUser.displayName && p.id !== socket.id && p.inactive) {
                staleIndices.push(idx);
              }
            });
            
            for (let i = staleIndices.length - 1; i >= 0; i--) {
              console.log(`Removing stale participant at index ${staleIndices[i]}`);
              room.participants.splice(staleIndices[i], 1);
            }
          }
        }
        
        const reconnectedUser = {
          id: socket.id,
          displayName: currentUser.displayName,
          previousId: originalId,
          previousSocketId: userId_to_find,
          inactive: false
        };
        
        currentUser.id = socket.id;
        currentUser.displayName = participantToUpdate ? participantToUpdate.displayName : currentUser.displayName;
        currentUser.room = roomId;
        
        const userExists = room.participants.some(p => p.id === socket.id);
        if (!userExists) {
          room.participants.push(reconnectedUser);
          console.log(`Added reconnected user to room participants: ${JSON.stringify(reconnectedUser)}`);
        }
        
        socket.join(roomId);
        
        socket.emit('room-joined', { 
          roomId, 
          participants: room.participants.map(p => ({
            id: p.id,
            displayName: p.displayName,
            inactive: p.inactive || false
          })),
          isPasswordProtected: !!room.password,
          isCreator: room.creatorId === originalId
        });
        
        socket.to(roomId).emit('user-rejoined', { 
          userId: socket.id,
          displayName: currentUser.displayName,
          previousId: originalId
        });
        
        try {
          if (inactiveParticipant) {
            await db.RoomService.removeParticipant(roomId, inactiveParticipant.id);
          }
          
          await db.RoomService.addParticipant(roomId, socket.id, currentUser.displayName);
          await db.RoomService.updateLastActive(roomId);
        } catch (error) {
          console.warn(`Failed to update room in database: ${error.message}`);
        }
        
        console.log(`User ${socket.id} (was ${originalId}) rejoined room ${roomId}`);
      } else {
        console.log(`User ${socket.id} not found in room ${roomId} history, joining as new user`);
        
        socket.emit('error', { 
          code: 'NOT_IN_ROOM',
          message: 'You were not in this room, please join normally'
        });
      }
    } catch (error) {
      console.error('Error rejoining room:', error);
      socket.emit('error', { message: 'Could not rejoin room' });
    }
  });

  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    
    if (currentUser.room) {
      const roomId = currentUser.room;
      const room = rooms[roomId];
      
      if (room) {
        const participant = room.participants.find(p => p.id === socket.id);
        
        if (participant) {
          participant.inactive = true;
          participant.disconnectedAt = new Date();
          participant.previousId = socket.id;
          
          console.log(`User ${socket.id} marked as inactive in room ${roomId}`);
          
          socket.to(roomId).emit('user-inactive', { 
            userId: socket.id,
            displayName: currentUser.displayName
          });
          
          try {
            await db.RoomService.updateParticipantStatus(
              roomId, 
              socket.id, 
              { 
                inactive: true, 
                disconnectedAt: new Date(),
                previousId: socket.id 
              }
            );
          } catch (error) {
            console.error('Error updating participant status in DB:', error);
          } 
          
          setTimeout(async () => {
            const currentRoom = rooms[roomId];
            if (!currentRoom) return;
            
            const participant = currentRoom.participants.find(p => p.id === socket.id);
            if (!participant) return;
            
            if (participant.inactive) {
              console.log(`User ${socket.id} did not reconnect after grace period, removing from room ${roomId}`);
              
              const index = currentRoom.participants.findIndex(p => p.id === socket.id);
              if (index !== -1) {
                currentRoom.participants.splice(index, 1);
              }
              
              try {
                await db.RoomService.removeParticipant(roomId, socket.id);
              } catch (error) {
                console.error('Error removing participant from room in DB:', error);
              }
              
              io.to(roomId).emit('user-left', { userId: socket.id });
              
              io.to(roomId).emit('system-message', {
                text: `${currentUser.displayName} has left the room`,
                timestamp: new Date().toISOString()
              });
              
              if (currentRoom.participants.length === 0) {
                delete rooms[roomId];
                console.log(`Room emptied: ${roomId}`);
              }
            }
          }, 30000);
        }
      }
    }
  });

  socket.on('leave-room', async () => {
    if (currentUser.room) {
      const roomId = currentUser.room;
      const room = rooms[roomId];
      
      if (room) {
        const index = room.participants.findIndex(p => p.id === socket.id);
        
        if (index !== -1) {
          room.participants.splice(index, 1);
          
          try {
            await db.RoomService.removeParticipant(roomId, socket.id);
          } catch (error) {
            console.error('Error removing participant from room in DB:', error);
          }
          
          socket.leave(roomId);
          
          socket.to(roomId).emit('user-left', { userId: socket.id });
          
          socket.to(roomId).emit('system-message', {
            text: `${currentUser.displayName} has left the room`,
            timestamp: new Date().toISOString()
          });
          
          if (room.participants.length === 0) {
            delete rooms[roomId];
            console.log(`Room emptied: ${roomId}`);
          }
          
          currentUser.room = null;
          socket.emit('left-room');
        }
      }

      try {
        const meeting = await Meeting.findOne({ roomId });
        
        if (meeting) {        
          await Meeting.updateOne(
            { 
              roomId, 
              "participants.userId": socket.id 
            },
            { 
              $set: { 
                "participants.$.leaveTime": new Date() 
              } 
            }
          );
          
          console.log(`Updated leave time for participant ${socket.id} in meeting ${roomId}`);
        }
      } catch (error) {
        console.error('Error updating participant leave time:', error);
      }
    }
  });

  socket.on('authenticate', async ({ token }) => {
    try {
      if (!token) {
        socket.emit('auth-error', { message: 'No token provided' });
        return;
      }
      
      const decoded = AuthService.verifyToken(token);
      socket.user = decoded;
      
      currentUser.displayName = decoded.name;
      currentUser.userId = decoded.id;
      
      socket.emit('authenticated', { 
        user: {
          id: decoded.id,
          name: decoded.name,
          email: decoded.email
        }
      });
    } catch (error) {
      socket.emit('auth-error', { message: 'Invalid token' });
    }
  });

  socket.on('attention-data', async (data) => {
    try {
      const roomId = data.roomId || currentUser.room;
      if (!roomId) {
        console.log('No roomId provided for attention data');
        return;
      }
      
      const meeting = await Meeting.findOne({ roomId });
      if (!meeting) {
        console.log(`No meeting found for room ${roomId}`);
        return;
      }
      
      const attentionData = data.attentionData || {};
      
      console.log(`Received attention data for room ${roomId}:`, 
        Object.keys(attentionData).map(id => `${id}: ${attentionData[id]?.attentionState || 'unknown'}`).join(', '));
      
      if (Object.keys(attentionData).length > 0) {
        const result = await meeting.saveAttentionSnapshot(attentionData);
        if (result) {
          console.log(`Saved attention snapshot for room ${roomId}`);
        } else {
          console.log(`Failed to save attention snapshot for room ${roomId}`);
        }
      } else {
        console.log(`No attention data to save for room ${roomId}`);
      }
    } catch (error) {
      console.error('Error saving attention data:', error);
    }
  });

  socket.on('close-room', async (data) => {
    try {
      const roomId = data?.roomId || currentUser.room;
      if (!roomId) {
        console.log('No roomId provided when closing room');
        return;
      }
      
      console.log(`Closing room ${roomId} and finalizing meeting records`);
      
      const meeting = await Meeting.findOne({ roomId });
      
      if (meeting) {
        if (!meeting.endTime) {
          await Meeting.updateOne(
            { _id: meeting._id },
            {
              $set: {
                endTime: new Date(),
                isActive: false
              }
            }
          );
          
          console.log(`Set end time for meeting ${meeting._id} (room ${roomId})`);
        } else {
          console.log(`Meeting ${meeting._id} already has an end time set`);
        }
        
        const bulkOps = [];
        let participantsUpdated = 0;
        
        for (const participant of meeting.participants) {
          if (!participant.leaveTime) {
            bulkOps.push({
              updateOne: {
                filter: { 
                  _id: meeting._id,
                  "participants._id": participant._id
                },
                update: {
                  $set: {
                    "participants.$.leaveTime": new Date()
                  }
                }
              }
            });
            participantsUpdated++;
          }
        }
        
        if (bulkOps.length > 0) {
          const result = await Meeting.bulkWrite(bulkOps);
          console.log(`Set leave time for ${participantsUpdated} participants in meeting ${meeting._id}`);
        }
        
        try {
          await meeting.calculateStats();
          console.log(`Calculated final stats for meeting ${meeting._id}`);
        } catch (statsError) {
          console.error(`Error calculating stats for meeting ${meeting._id}:`, statsError);
        }
        
        console.log(`Closed meeting record for room ${roomId}`);
      } else {
        console.log(`No meeting found for room ${roomId}`);
      }
                        
      if (rooms[roomId]) {
        delete rooms[roomId];
        console.log(`Removed room ${roomId} from memory`);
      }
      
      socket.emit('room-closed', { roomId });
    } catch (error) {
      console.error('Error closing meeting record:', error);
      socket.emit('error', { message: 'Error closing room' });
    }
  });
});

setInterval(async () => {
  try {
    const roomResult = await db.RoomService.cleanUp();
    console.log(`Cleaned up ${roomResult.deletedCount} old rooms from MongoDB`);
    
    const sessionResult = await db.SessionService.cleanUp();
    console.log(`Cleaned up ${sessionResult.deletedCount} old sessions from MongoDB`);
    
  const now = new Date();
  const expireTime = 24 * 60 * 60 * 1000;
  
  for (const roomId in rooms) {
    const room = rooms[roomId];
    const roomAge = now - room.createdAt;
    
    if (roomAge > expireTime && room.participants.length === 0) {
      delete rooms[roomId];
        console.log(`Room expired and deleted from memory: ${roomId}`);
      }
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 