# Use an official Node.js runtime as a base image
FROM node:16-slim

# Install Redis
RUN apt-get update && apt-get install -y redis-server && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install npm dependencies
RUN npm install express ioredis cors uuid

# Copy the rest of the app
COPY . .

# Expose ports for both the backend server and Redis
EXPOSE 3001 6379

# Start Redis and the backend server
CMD redis-server --daemonize yes && node server.js

