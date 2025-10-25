FROM node:20-slim

# Install Playwright dependencies
RUN apt-get update && \
    apt-get install -y wget ca-certificates libgtk-3-0 libx11-6 libxss1 libasound2 libnss3 libgbm1 libxshmfence1 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
RUN npx playwright install --with-deps

COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
