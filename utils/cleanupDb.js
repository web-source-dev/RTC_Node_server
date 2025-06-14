const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');
const User = require('../models/User');

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/rtc_app';

async function main() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB!');

    const users = await User.find({});
    console.log(`Found ${users.length} users`);

    const nullUserIdCount = await User.countDocuments({ userId: null });
    console.log(`Found ${nullUserIdCount} users with null userId`);

    if (nullUserIdCount > 0) {
      console.log('Fixing users with null userId...');
      const usersWithNullId = await User.find({ userId: null });
      
      for (let i = 0; i < usersWithNullId.length; i++) {
        const user = usersWithNullId[i];
        user.userId = uuidv4();
        await user.save();
        console.log(`Updated user ${user._id} with new userId: ${user.userId}`);
      }
    }

    const allUsers = await User.find({});
    const userIdMap = {};
    const duplicates = [];

    for (const user of allUsers) {
      if (user.userId) {
        if (userIdMap[user.userId]) {
          duplicates.push(user);
        } else {
          userIdMap[user.userId] = true;
        }
      }
    }

    console.log(`Found ${duplicates.length} users with duplicate userIds`);

    for (const user of duplicates) {
      user.userId = uuidv4();
      await user.save();
      console.log(`Updated user ${user._id} with new userId: ${user.userId}`);
    }

    console.log('Database cleanup complete!');
  } catch (error) {
    console.error('Error during database cleanup:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

main(); 