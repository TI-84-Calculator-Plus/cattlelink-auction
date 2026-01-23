const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: "*",
    methods: ["GET", "POST"]
  } 
});

// In-memory lots
let lots = {
  lot1: { currentBid: 380, currentBidder: "", status: "closed", timerRunning: false, startingBid: 380 },
  lot2: { currentBid: 340, currentBidder: "", status: "closed", timerRunning: false, startingBid: 340 }, 
  lot3: { currentBid: 430, currentBidder: "", status: "closed", timerRunning: false, startingBid: 430 },
};

io.on('connection', (socket) => {
  console.log("✅ Client connected:", socket.id);

  // Join a lot
  socket.on('joinLot', (lotId) => {
    console.log(`📍 Client ${socket.id} joining lot: ${lotId}`);
    
    if (!lots[lotId]) {
      lots[lotId] = { currentBid: 0, currentBidder: "", status: "closed", timerRunning: false };
    }
    
    socket.join(lotId);
    console.log(`Current status for ${lotId}:`, lots[lotId].status);
    
    // Send current bid
    socket.emit('bidUpdate', { 
      lotId, 
      currentBid: lots[lotId].currentBid,
      name: lots[lotId].currentBidder 
    });
    
    // Send timer status
    if (lots[lotId].timerRunning) {
      socket.emit('timerStarted', { lotId });
    }
    
    // Send current status
    const status = lots[lotId].status;
    if (status === "open") {
      socket.emit('lotOpen', { lotId });
      console.log(`Sent lotOpen to ${socket.id}`);
    } else if (status === "bidding_closed") {
      socket.emit('lotBiddingClosed', { lotId });
      console.log(`Sent lotBiddingClosed to ${socket.id}`);
    } else if (status === "sold") {
      socket.emit('lotSold', { lotId });
      console.log(`Sent lotSold to ${socket.id}`);
    } else if (status === "cancelled") {
      socket.emit('lotCancelled', { lotId });
      console.log(`Sent lotCancelled to ${socket.id}`);
    }
  });

  // Open lot
  socket.on('openLot', (lotId) => {
    console.log(`🟢 OPEN LOT received for: ${lotId}`);
    if (!lots[lotId]) {
      lots[lotId] = { currentBid: 0, currentBidder: "", status: "closed", timerRunning: false };
    }
    lots[lotId].status = "open";
    console.log(`Broadcasting lotOpen for ${lotId}`);
    io.emit('lotOpen', { lotId });
  });

  // Close lot (bidding ends, but not sold yet)
  socket.on('closeLot', (lotId) => {
    console.log(`🔵 CLOSE LOT received for: ${lotId}`);
    if (!lots[lotId]) return;
    lots[lotId].status = "bidding_closed";
    console.log(`Broadcasting lotBiddingClosed for ${lotId}`);
    io.emit('lotBiddingClosed', { lotId });
  });

  // Sell lot
  socket.on('sellLot', (lotId) => {
    console.log(`🔴 SELL LOT received for: ${lotId}`);
    if (!lots[lotId]) return;
    lots[lotId].status = "sold";
    console.log(`Broadcasting lotSold for ${lotId}`);
    io.emit('lotSold', { lotId });
  });

  // Cancel lot
  socket.on('cancelLot', (lotId) => {
    console.log(`⚫ CANCEL LOT received for: ${lotId}`);
    if (!lots[lotId]) return;
    lots[lotId].status = "cancelled";
    console.log(`Broadcasting lotCancelled for ${lotId}`);
    io.emit('lotCancelled', { lotId });
  });

  // Reset lot
  socket.on('resetLot', (lotId) => {
    console.log(`🟠 RESET LOT received for: ${lotId}`);
    if (!lots[lotId]) return;
    lots[lotId].currentBid = lots[lotId].startingBid;
    lots[lotId].currentBidder = "";
    lots[lotId].status = "closed";
    lots[lotId].timerRunning = false;
    console.log(`Broadcasting lotReset for ${lotId}`);
    io.emit('lotReset', { lotId });
  });

  // Lower bid by amount
socket.on('lowerBid', ({ lotId, amount }) => {
  console.log(`📉 LOWER BID received for: ${lotId} by $${amount}`);
  if (!lots[lotId]) return;
  
  // Lower the current bid
  const newBid = Math.max(0, lots[lotId].currentBid - amount); // Don't go below 0
  lots[lotId].currentBid = newBid;
  
  console.log(`Broadcasting new bid: $${newBid}`);
  io.emit('bidUpdate', { lotId, currentBid: newBid, name: lots[lotId].currentBidder, adminAdjustment: true });
});

  // Place a bid
  socket.on('placeBid', ({ lotId, bidAmount, name }) => {
    console.log(`💰 Bid received: ${name} bid $${bidAmount} on ${lotId}`);
    if (!lots[lotId] || lots[lotId].status !== "open") {
      console.log(`Bid rejected - lot status: ${lots[lotId]?.status}`);
      socket.emit('bidRejected', { message: "Bidding is not open" });
      return;
    }
    if (bidAmount > lots[lotId].currentBid) {
      lots[lotId].currentBid = bidAmount;
      lots[lotId].currentBidder = name;
      lots[lotId].timerRunning = true;
      io.emit('bidUpdate', { lotId, currentBid: bidAmount, name });
      io.emit('timerStarted', { lotId });
      console.log(`✅ Bid accepted: ${name} - $${bidAmount}`);
    } else {
      socket.emit('bidRejected', { message: "Bid too low" });
      console.log(`❌ Bid too low: $${bidAmount} vs current $${lots[lotId].currentBid}`);
    }
  });

  socket.on('disconnect', () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Initial lots:`, lots);
});