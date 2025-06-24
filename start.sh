#!/bin/bash

# Memory management startup script for RTC Node.js server

echo "Starting RTC Node.js server with enhanced memory management..."

# Set Node.js memory management flags
export NODE_OPTIONS="--expose-gc --max-old-space-size=3072 --optimize-for-size --max-semi-space-size=512"

# Set garbage collection flags
export NODE_GC_INTERVAL=30000  # 30 seconds

# Start the server
echo "Server starting with memory limits:"
echo "- Max heap size: 3GB"
echo "- Garbage collection: Enabled"
echo "- Memory optimization: Enabled"

# Start the server in the background
node index.js &

# Store the PID
SERVER_PID=$!

echo "Server started with PID: $SERVER_PID"

# Function to cleanup on exit
cleanup() {
    echo "Shutting down server..."
    kill $SERVER_PID
    wait $SERVER_PID
    echo "Server stopped."
    exit 0
}

# Trap SIGINT and SIGTERM
trap cleanup SIGINT SIGTERM

# Monitor memory usage
echo "Starting memory monitor..."
while kill -0 $SERVER_PID 2>/dev/null; do
    if command -v ps >/dev/null 2>&1; then
        MEMORY_USAGE=$(ps -o rss= -p $SERVER_PID | awk '{print $1/1024}')
        echo "$(date): Memory usage: ${MEMORY_USAGE}MB"
        
        # Alert if memory usage is high
        if (( $(echo "$MEMORY_USAGE > 2000" | bc -l) )); then
            echo "WARNING: High memory usage detected: ${MEMORY_USAGE}MB"
        fi
    fi
    sleep 30
done

echo "Server process ended." 