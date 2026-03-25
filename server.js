const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fetch = require('node-fetch');

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
  lot1: { currentBid: 410, currentBidder: "", currentBidderID: "", status: "closed", timerRunning: false, startingBid: 410, headCount: 85, avgWeight: 625 },
  lot2: { currentBid: 325, currentBidder: "", currentBidderID: "", status: "closed", timerRunning: false, startingBid: 325, headCount: 74, avgWeight: 750 }, 
  lot3: { currentBid: 460, currentBidder: "", currentBidderID: "", status: "closed", timerRunning: false, startingBid: 460, headCount: 105, avgWeight: 550 },
  lot4: { currentBid: 380, currentBidder: "", currentBidderID: "", status: "closed", timerRunning: false, startingBid: 380, headCount: 63, avgWeight: 675 },
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
  socket.on('sellLot', async (lotId) => {
    console.log(`🔴 sellLot handler triggered for: ${lotId}`);
    if (!lots[lotId] || (lots[lotId].status !== 'open' && lots[lotId].status !== 'bidding_closed')) return;

    lots[lotId].status = 'sold';
    io.emit('lotSold', { lotId });
    console.log(`🔨 Lot ${lotId} sold to ${lots[lotId].currentBidder}`);

    const lot = lots[lotId];
    if (lot.currentBidderID && lot.headCount && lot.avgWeight) {
      const totalValue = (lot.headCount * (lot.avgWeight / 100)) * lot.currentBid;

      try {
        const response = await fetch('https://www.cattlelink.net/_functions/updateUsedCredit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bidderID: lot.currentBidderID,
            amountToAdd: totalValue
          })
        });

        const data = await response.json();
        console.log(`💳 Updated used credit for ${lot.currentBidderID}: +$${totalValue} → Available: $${data.availableCredit}`);

      } catch (err) {
        console.error("Failed to update used credit:", err);
      }
    }
  }); // ✅ properly closed inside connection block

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
socket.on('placeBid', async ({ lotId, bidAmount, name, bidderID, creditLimit }) => {
  console.log(`💰 Bid received: ${name} (${bidderID}) bid $${bidAmount} on ${lotId}`);
  console.log(`💳 Credit check - bidderID: ${bidderID}, creditLimit: ${creditLimit}, type: ${typeof creditLimit}`);

  if (!lots[lotId] || lots[lotId].status !== "open") {
    console.log(`Bid rejected - lot status: ${lots[lotId]?.status}`);
    socket.emit('bidRejected', { message: "Bidding is not open" });
    return;
  }

  // ✅ Check available credit from Wix CMS in real time
  if (bidderID) {
    try {
      const lot = lots[lotId];
      const totalLotValue = (lot.headCount * (lot.avgWeight / 100)) * bidAmount;

      // Check single lot vs credit limit
      if (totalLotValue > creditLimit) {
        const maxBid = (creditLimit / (lot.headCount * (lot.avgWeight / 100))).toFixed(2);
        socket.emit('bidRejected', {
          message: `Bid exceeds your credit limit of $${Number(creditLimit).toLocaleString()}. Max bid for this lot: $${maxBid}/cwt.`
        });
        return;
      }

      // Check available credit from Wix in real time
      const creditResponse = await fetch(`https://www.cattlelink.net/_functions/getAvailableCredit?bidderID=${bidderID}`);
      const creditData = await creditResponse.json();

      if (creditData.success && totalLotValue > creditData.availableCredit) {
        socket.emit('bidRejected', {
          message: `Bid exceeds your available credit. Available: $${creditData.availableCredit.toLocaleString()}. This lot would cost approximately $${totalLotValue.toLocaleString()}.`
        });
        return;
      }

    } catch (err) {
      console.error("Credit check error:", err);
      // Don't block the bid if credit check fails — log and continue
    }
  }

  if (bidAmount > lots[lotId].currentBid) {
    lots[lotId].currentBid = bidAmount;
    lots[lotId].currentBidder = name;
    lots[lotId].currentBidderID = bidderID; // ✅ Track bidder ID
    lots[lotId].timerRunning = true;
    io.emit('bidUpdate', { lotId, currentBid: bidAmount, name });
    io.emit('timerStarted', { lotId });
    console.log(`✅ Bid accepted: ${name} (${bidderID}) - $${bidAmount}`);
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