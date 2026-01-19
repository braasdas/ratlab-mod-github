#!/bin/bash

# Ratlab Server Deploy Script
# Stops, rebuilds, and restarts the Docker container with correct ports

set -e

CONTAINER_NAME="ratlab-server"
IMAGE_NAME="ratlab-server:latest"

echo "=== Ratlab Server Deployment ==="

# Stop and remove any existing containers
echo "Stopping existing containers..."
docker stop $CONTAINER_NAME 2>/dev/null || true
docker stop ratlab-server-container 2>/dev/null || true

echo "Removing old containers..."
docker rm $CONTAINER_NAME 2>/dev/null || true
docker rm ratlab-server-container 2>/dev/null || true

# Build new image
echo "Building new image..."
docker build -t $IMAGE_NAME .

# Run with correct ports
echo "Starting container..."
docker run -d \
  --name $CONTAINER_NAME \
  -p 3000:3000 \
  -p 3001:3001 \
  -e PORT=3000 \
  --restart unless-stopped \
  $IMAGE_NAME

echo "=== Deployment Complete ==="
echo "Main server: http://localhost:3000"
echo "Mod socket:  ws://localhost:3001"
docker ps | grep $CONTAINER_NAME
