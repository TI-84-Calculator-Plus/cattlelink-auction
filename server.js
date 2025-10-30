const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// In-memory bids per lot
let lots = {}; // e.g., { "lot1": { currentBid: 0, currentBidder: "" } }

io.on('connection', (socket) => {
  console.log("Client connected:", socket.id);

  // Join a lot
  socket.on('joinLot', (lotId) => {
    if (!lots[lotId]) lots[lotId] = { currentBid: 0, currentBidder: "" };
    socket.emit('bidUpdate', { lotId, currentBid: lots[lotId].currentBid });
  });

  // Place a bid
  socket.on('placeBid', ({ lotId, bidAmount, name }) => {
    if (!lots[lotId]) lots[lotId] = { currentBid: 0, currentBidder: "" };

    if (bidAmount > lots[lotId].currentBid) {
      lots[lotId].currentBid = bidAmount;
      lots[lotId].currentBidder = name;

      // Broadcast bid to all clients
      io.emit('bidUpdate', { lotId, currentBid: bidAmount, name });
    } else {
      socket.emit('bidRejected', { message: "Bid too low" });
    }
  });

  // Reset lot
  socket.on('resetLot', (lotId) => {
    lots[lotId] = { currentBid: 0, currentBidder: "" };
    io.emit('bidUpdate', { lotId, currentBid: 0 });
  });
});

server.listen(3000, () => console.log("Server running on port 3000"));
