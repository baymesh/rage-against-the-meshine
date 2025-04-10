# Stage 1: Build the application
FROM node:20 AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install
RUN npm install -g tsx

COPY . .

RUN git clone https://github.com/meshtastic/protobufs.git src/protobufs

# Stage 2: Create the final image
FROM node:20-slim

WORKDIR /app

COPY --from=builder /app /app

CMD [ "tsx", "index.ts" ]
