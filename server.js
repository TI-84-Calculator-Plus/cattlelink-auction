const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// In-memory lots
let lots = {
  lot1: { currentBid: 0, currentBidder: "", status: "closed" }
};

io.on('connection', (socket) => {
  console.log("Client connected:", socket.id);

  // Join a lot
  socket.on('joinLot', (lotId) => {
    if (!lots[lotId]) lots[lotId] = { currentBid: 0, currentBidder: "", status: "closed" };
    socket.emit('bidUpdate', { lotId, currentBid: lots[lotId].currentBid });
    
    // Send current status when joining
    if (lots[lotId].status === "open") {
      socket.emit('lotOpen', { lotId });
    } else if (lots[lotId].status === "sold") {
      socket.emit('lotSold', { lotId });
    } else if (lots[lotId].status === "cancelled") {
      socket.emit('lotCancelled', { lotId });
    }
  });

  // Place a bid
  socket.on('placeBid', ({ lotId, bidAmount, name }) => {
    if (!lots[lotId] || lots[lotId].status !== "open") return;
    if (bidAmount > lots[lotId].currentBid) {
      lots[lotId].currentBid = bidAmount;
      lots[lotId].currentBidder = name;
      io.emit('bidUpdate', { lotId, currentBid: bidAmount, name });
    } else {
      socket.emit('bidRejected', { message: "Bid too low" });
    }
  });

  // Open lot
  socket.on('openLot', (lotId) => {
    if (!lots[lotId]) lots[lotId] = { currentBid: 0, currentBidder: "", status: "closed" };
    lots[lotId].status = "open";
    io.emit('lotOpen', { lotId });
    console.log(`Lot ${lotId} opened`);
  });

  // Sell lot
  socket.on('sellLot', (lotId) => {
    if (!lots[lotId]) return;
    lots[lotId].status = "sold";
    io.emit('lotSold', { lotId });
    console.log(`Lot ${lotId} sold`);
  });

  // Cancel lot
  socket.on('cancelLot', (lotId) => {
    if (!lots[lotId]) return;
    lots[lotId].status = "cancelled";
    io.emit('lotCancelled', { lotId });
    console.log(`Lot ${lotId} cancelled`);
  });

  // Reset lot
  socket.on('resetLot', (lotId) => {
    if (!lots[lotId]) return;
    lots[lotId].currentBid = 0;
    lots[lotId].currentBidder = "";
    lots[lotId].status = "closed";
    io.emit('lotReset', { lotId });
    console.log(`Lot ${lotId} reset`);
  });

  socket.on('disconnect', () => {
    console.log("Client disconnected:", socket.id);
  });
});

server.listen(3000, () => console.log("Server running on port 3000"));