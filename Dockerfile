FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy app source
COPY . .

# Build frontend assets and bundle metadata used by Vite middleware
RUN npm run build

# App defaults
ENV NODE_ENV=production
ENV PORT=43000

EXPOSE 43000

CMD ["npm", "run", "start"]
