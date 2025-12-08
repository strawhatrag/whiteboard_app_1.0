# Use a slim Node.js base image (20-alpine is lightweight)
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first
# This allows Docker to cache the 'npm install' layer 
# unless the package files change.
COPY package*.json ./

# Install project dependencies. 
# We don't use --production here because we need the @socket.io/redis-adapter 
# which might be considered a development dependency by some systems, but it's 
# essential for the running server.
# NOTE: Make sure the adapter is listed in 'dependencies' in package.json
RUN npm install

# Copy the rest of the application source code (server.js, public/ folder, etc.)
COPY . .

# Expose the port the application listens on
EXPOSE 3000

# Define the command to run the application when the container starts
CMD ["node", "server.js"]