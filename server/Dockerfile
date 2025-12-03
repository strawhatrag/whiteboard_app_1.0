# Use a lightweight Node.js image
FROM node:18-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy the server logic
COPY index.js .

# Expose the port (Docker will map this)
EXPOSE 3001

# Command to run the server
CMD ["node", "index.js"]