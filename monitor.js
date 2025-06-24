const http = require('http');
const { spawn } = require('child_process');

let consecutiveFailures = 0;
const MAX_FAILURES = 3;

function checkServerHealth() {
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/health',
    method: 'GET',
    timeout: 5000
  };

  const req = http.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const health = JSON.parse(data);
        const timestamp = new Date().toLocaleTimeString();
        
        console.log(`\n[${timestamp}] Server Health Check:`);
        console.log(`  Status: ${health.status}`);
        console.log(`  Uptime: ${health.uptime}s`);
        console.log(`  Memory Usage:`);
        console.log(`    Heap Used: ${health.memory.heapUsed}MB`);
        console.log(`    Heap Total: ${health.memory.heapTotal}MB`);
        console.log(`    RSS: ${health.memory.rss}MB`);
        console.log(`    External: ${health.memory.external}MB`);
        console.log(`  Rooms: ${health.rooms.count}/${health.rooms.maxRooms}`);
        console.log(`  Sessions: ${health.sessions.count}`);
        
        // Calculate memory usage percentage
        const heapUsagePercent = (health.memory.heapUsed / health.memory.heapTotal * 100).toFixed(1);
        console.log(`  Heap Usage: ${heapUsagePercent}%`);
        
        // Alert if memory usage is high
        if (health.memory.heapUsed > 1500) {
          console.warn(`⚠️  HIGH MEMORY USAGE: ${health.memory.heapUsed}MB (${heapUsagePercent}%)`);
        }
        
        if (health.memory.heapUsed > 2000) {
          console.error(`🚨 CRITICAL MEMORY USAGE: ${health.memory.heapUsed}MB (${heapUsagePercent}%)`);
        }
        
        if (health.memory.heapUsed > 2500) {
          console.error(`💥 EMERGENCY MEMORY USAGE: ${health.memory.heapUsed}MB (${heapUsagePercent}%)`);
          console.error('Server may crash soon!');
        }
        
        // Reset failure counter on success
        consecutiveFailures = 0;
        
      } catch (error) {
        console.error('Error parsing health data:', error);
        handleFailure();
      }
    });
  });

  req.on('error', (error) => {
    console.error('Error checking server health:', error.message);
    handleFailure();
  });

  req.on('timeout', () => {
    console.error('Health check timeout');
    req.destroy();
    handleFailure();
  });

  req.end();
}

function handleFailure() {
  consecutiveFailures++;
  console.error(`Health check failed. Consecutive failures: ${consecutiveFailures}`);
  
  if (consecutiveFailures >= MAX_FAILURES) {
    console.error('Maximum consecutive failures reached. Server may be down.');
    console.error('Consider restarting the server manually.');
  }
}

function getSystemMemoryInfo() {
  return new Promise((resolve) => {
    const free = spawn('free', ['-m']);
    let output = '';
    
    free.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    free.on('close', () => {
      const lines = output.split('\n');
      if (lines.length > 1) {
        const memLine = lines[1].split(/\s+/);
        if (memLine.length > 3) {
          const total = parseInt(memLine[1]);
          const used = parseInt(memLine[2]);
          const free = parseInt(memLine[3]);
          resolve({ total, used, free, available: used + free });
        }
      }
      resolve(null);
    });
    
    free.on('error', () => {
      resolve(null);
    });
  });
}

async function checkSystemMemory() {
  const memInfo = await getSystemMemoryInfo();
  if (memInfo) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] System Memory: ${memInfo.used}MB used / ${memInfo.total}MB total (${(memInfo.used/memInfo.total*100).toFixed(1)}%)`);
    
    if (memInfo.used / memInfo.total > 0.9) {
      console.warn('⚠️  System memory usage is very high!');
    }
  }
}

// Check health every 30 seconds
setInterval(checkServerHealth, 30000);

// Check system memory every 2 minutes
setInterval(checkSystemMemory, 120000);

// Initial checks
checkServerHealth();
checkSystemMemory();

console.log('Enhanced memory monitor started. Press Ctrl+C to stop.');
console.log('Monitoring:');
console.log('- Server health every 30 seconds');
console.log('- System memory every 2 minutes');
console.log('- Automatic failure detection');
console.log('---'); 