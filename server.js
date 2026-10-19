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
  lot1: { currentBid: 410, currentBidder: "", currentBidderID: "", status: "closed", timerRunning: false, startingBid: 410, headCount: 85, avgWeight: 625, timerEnd: null, timerInterval: null, bidHistory: [], adminAdjusted: false },
  lot2: { currentBid: 325, currentBidder: "", currentBidderID: "", status: "closed", timerRunning: false, startingBid: 325, headCount: 74, avgWeight: 750, timerEnd: null, timerInterval: null, bidHistory: [], adminAdjusted: false },
  lot3: { currentBid: 460, currentBidder: "", currentBidderID: "", status: "closed", timerRunning: false, startingBid: 460, headCount: 105, avgWeight: 550, timerEnd: null, timerInterval: null, bidHistory: [], adminAdjusted: false },
  lot4: { currentBid: 380, currentBidder: "", currentBidderID: "", status: "closed", timerRunning: false, startingBid: 380, headCount: 63, avgWeight: 675, timerEnd: null, timerInterval: null, bidHistory: [], adminAdjusted: false },
};

const TIMER_DURATION = 30; // seconds

function startLotTimer(lotId) {
  const lot = lots[lotId];
  if (!lot) return;

  if (lot.timerInterval) {
    clearInterval(lot.timerInterval);
    lot.timerInterval = null;
  }

  lot.timerEnd = Date.now() + TIMER_DURATION * 1000;
  lot.timerRunning = true;

  console.log(`⏱️ Timer started for ${lotId} — ${TIMER_DURATION} seconds`);

  lot.timerInterval = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((lot.timerEnd - Date.now()) / 1000));
    io.emit('timerTick', { lotId, remaining });

    if (remaining <= 0) {
      clearInterval(lot.timerInterval);
      lot.timerInterval = null;
      lot.timerRunning = false;
      lot.timerEnd = null;
      lot.status = "bidding_closed";
      console.log(`⏰ Timer expired for ${lotId} — closing lot`);
      io.emit('lotBiddingClosed', { lotId });
    }
  }, 1000);
}

function stopLotTimer(lotId) {
  const lot = lots[lotId];
  if (!lot) return;
  if (lot.timerInterval) {
    clearInterval(lot.timerInterval);
    lot.timerInterval = null;
  }
  lot.timerRunning = false;
  lot.timerEnd = null;
}

let auctionState = {
  currentLotIndex: 0,
  phase: 'waiting'
};

io.on('connection', (socket) => {
  console.log("✅ Client connected:", socket.id);
  console.log("📋 Registering socket handlers for:", socket.id);

  socket.onAny((event, ...args) => {
    if (event !== 'joinLot') {
      console.log(`📨 Event received from ${socket.id}: ${event}`, JSON.stringify(args));
    } else {
      console.log(`🔗 ${socket.id} joined lot: ${args[0]}`);
    }
  });

  // Join a lot
  socket.on('joinLot', (lotId) => {
    console.log(`📍 Client ${socket.id} joining lot: ${lotId}`);

    if (!lots[lotId]) {
      lots[lotId] = { currentBid: 0, currentBidder: "", currentBidderID: "", status: "closed", timerRunning: false, timerEnd: null, timerInterval: null, bidHistory: [], adminAdjusted: false };
    }

    socket.join(lotId);
    console.log(`Current status for ${lotId}:`, lots[lotId].status);

    // ✅ Include adminAdjustment and hasRealBid for late joiners
    // adminAdjustment: true if current bid is below starting bid (floor was lowered)
    // hasRealBid: true if a real bid has been placed above the floor
    socket.emit('bidUpdate', {
      lotId,
      currentBid: lots[lotId].currentBid,
      name: lots[lotId].currentBidder,
      bidderID: lots[lotId].currentBidderID,
      adminAdjustment: lots[lotId].adminAdjusted || false,
      hasRealBid: lots[lotId].bidHistory.length > 0
    });

    if (lots[lotId].timerRunning && lots[lotId].timerEnd) {
      const remaining = Math.max(0, Math.ceil((lots[lotId].timerEnd - Date.now()) / 1000));
      socket.emit('timerTick', { lotId, remaining });
      console.log(`Sent timerTick to late joiner: ${remaining}s remaining`);
    }

    const status = lots[lotId].status;
    if (status === "open") {
      socket.emit('lotOpen', { lotId });
    } else if (status === "bidding_closed") {
      socket.emit('lotBiddingClosed', { lotId });
    } else if (status === "sold") {
      socket.emit('lotSold', {
        lotId,
        winnerName: lots[lotId].winnerName || "",
        finalBid: lots[lotId].finalBid || lots[lotId].currentBid
      });
    } else if (status === "cancelled") {
      socket.emit('lotCancelled', { lotId });
    }
  });

  // Open lot
  socket.on('openLot', (lotId) => {
    console.log(`🟢 OPEN LOT received for: ${lotId}`);
    if (!lots[lotId]) {
      lots[lotId] = { currentBid: 0, currentBidder: "", status: "closed", timerRunning: false, adminAdjusted: false };
    }
    lots[lotId].status = "open";
    console.log(`Broadcasting lotOpen for ${lotId}`);
    io.emit('lotOpen', { lotId });
    auctionState.phase = 'bidding';
    const lotIndex = parseInt(lotId.replace('lot', '')) - 1;
    auctionState.currentLotIndex = lotIndex;
  });

  // Close lot
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

    stopLotTimer(lotId);
    lots[lotId].winnerName = lots[lotId].currentBidder;
    lots[lotId].finalBid = lots[lotId].currentBid;
    lots[lotId].status = 'sold';

    const lot = lots[lotId];

    io.emit('lotSold', {
      lotId,
      winnerName: lot.currentBidder,
      winnerBidderID: lot.currentBidderID,
      finalBid: lot.currentBid
    });

    console.log(`🔨 Lot ${lotId} sold to ${lot.currentBidder}`);

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
  });

  // Cancel lot
  socket.on('cancelLot', (lotId) => {
    console.log(`⚫ CANCEL LOT received for: ${lotId}`);
    if (!lots[lotId]) return;
    stopLotTimer(lotId);
    lots[lotId].status = "cancelled";
    console.log(`Broadcasting lotCancelled for ${lotId}`);
    io.emit('lotCancelled', { lotId });
  });

  // Scroll to lot
  socket.on('scrollToLot', (data) => {
    console.log(`📜 Scrolling all viewers to lot index: ${data.lotIndex}`);
    auctionState.currentLotIndex = data.lotIndex;
    auctionState.phase = 'preview';
    io.emit('scrollToLot', { lotIndex: data.lotIndex });
  });

  // Reset to waiting
  socket.on('resetToWaiting', () => {
    console.log('⏹ Resetting to waiting state');
    auctionState.phase = 'waiting';
    auctionState.currentLotIndex = 0;
    io.emit('resetToWaiting');
  });

  socket.on('getAuctionState', () => {
    socket.emit('auctionState', auctionState);
  });

  // Reset lot
  socket.on('resetLot', (lotId) => {
    console.log(`🟠 RESET LOT received for: ${lotId}`);
    if (!lots[lotId]) return;
    stopLotTimer(lotId);
    lots[lotId].currentBid = lots[lotId].startingBid;
    lots[lotId].currentBidder = "";
    lots[lotId].currentBidderID = "";
    lots[lotId].status = "closed";
    lots[lotId].timerRunning = false;
    lots[lotId].bidHistory = [];
    lots[lotId].adminAdjusted = false; // ✅ clear on reset
    console.log(`Broadcasting lotReset for ${lotId}`);
    io.emit('lotReset', { lotId });
  });

  // ✅ Lower bid TO a specific amount
  socket.on('lowerBid', ({ lotId, amount }) => {
    console.log(`📉 LOWER BID received for: ${lotId} — setting to $${amount}`);
    if (!lots[lotId]) return;

    const newBid = Math.max(0, amount);
    lots[lotId].currentBid = newBid;
    lots[lotId].currentBidder = "";
    lots[lotId].currentBidderID = "";
    lots[lotId].adminAdjusted = true; // ✅ flag for late joiners

    console.log(`Broadcasting new bid: $${newBid}`);
    io.emit('bidUpdate', { lotId, currentBid: newBid, name: "", bidderID: "", adminAdjustment: true });
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

    if (bidderID) {
      try {
        const lot = lots[lotId];
        const totalLotValue = (lot.headCount * (lot.avgWeight / 100)) * bidAmount;

        if (totalLotValue > creditLimit) {
          const maxBid = (creditLimit / (lot.headCount * (lot.avgWeight / 100))).toFixed(2);
          socket.emit('bidRejected', {
            message: `Bid exceeds your credit limit of $${Number(creditLimit).toLocaleString()}. Max bid for this lot: $${maxBid}/cwt.`
          });
          return;
        }

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
      }
    }

    if (bidAmount > lots[lotId].currentBid) {
      lots[lotId].currentBid = bidAmount;
      lots[lotId].currentBidder = name;
      lots[lotId].currentBidderID = bidderID;
      lots[lotId].timerRunning = true;
      lots[lotId].bidHistory.push({ name, bidderID, amount: bidAmount });
      lots[lotId].adminAdjusted = false; // ✅ clear once a real bid comes in
      io.emit('bidUpdate', { lotId, currentBid: bidAmount, name, bidderID });
      startLotTimer(lotId);
      console.log(`✅ Bid accepted: ${name} (${bidderID}) - $${bidAmount}`);
    } else {
      console.log(`⏭️ Bid too low, silently ignored: $${bidAmount} vs current $${lots[lotId].currentBid}`);
    }
  });

  socket.on('disconnect', () => {
    console.log("❌ Client disconnected:", socket.id);
  });

}); // closes io.on('connection')

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Initial lots:`, lots);
});