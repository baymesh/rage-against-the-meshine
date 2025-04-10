# Stage 1: Build the application
FROM node:20 AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN git clone https://github.com/meshtastic/protobufs.git src/protobufs

# Stage 2: Create the final image
FROM node:20-slim

WORKDIR /app

RUN npm install -g tsx

COPY --from=builder /app /app

CMD [ "tsx", "index.ts" ]
