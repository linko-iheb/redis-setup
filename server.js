const express = require("express");
const Redis = require("ioredis");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

// Initialize express app
const app = express();
const port = 3001;

// Add timestamp to logs
function getTimestamp() {
  return new Date().toISOString();
}

// Colored console logs
const logger = {
  info: (message) =>
    console.log(`\x1b[36m[${getTimestamp()}] INFO: ${message}\x1b[0m`),
  success: (message) =>
    console.log(`\x1b[32m[${getTimestamp()}] SUCCESS: ${message}\x1b[0m`),
  error: (message) =>
    console.log(`\x1b[31m[${getTimestamp()}] ERROR: ${message}\x1b[0m`),
  warn: (message) =>
    console.log(`\x1b[33m[${getTimestamp()}] WARNING: ${message}\x1b[0m`),
};

// Redis client setup
const redis = new Redis({
  host: "localhost",
  port: 6379,
});

redis.on("connect", () => {
  logger.success("Redis connected successfully");
});

redis.on("error", (err) => {
  logger.error(`Redis connection error: ${err}`);
});

// Middleware
app.use(cors());
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Store active sessions
const activeSessions = new Map();

// Generate a random 6-digit code
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Start a new session
app.post("/events/:eventId/startSession", async (req, res) => {
  const { eventId } = req.params;
  const { expirationTime, eventSessionId, sessionId } = req.body;

  // Accept either eventSessionId or sessionId
  const actualSessionId = eventSessionId || sessionId;

  if (!actualSessionId) {
    return res.status(400).json({ error: "Event session ID is required" });
  }

  try {
    const redisSessionId = uuidv4(); // Generate Redis session ID
    let code = generateCode();

    logger.info(`Creating new session for event ${eventId}: ${redisSessionId}`);

    activeSessions.set(redisSessionId, {
      eventId,
      eventSessionId: actualSessionId,
      startTime: Date.now(),
      expirationTime,
    });

    // Set the new code with expiration
    await redis.set(
      `event:${eventId}:session:${redisSessionId}`,
      code,
      "EX",
      expirationTime
    );

    res.json({
      sessionId: redisSessionId,
      code,
      eventSessionId: actualSessionId,
    });

    logger.success(
      `Session started for event ${eventId}: ${redisSessionId}, Initial Code: ${code}, Expiration: ${expirationTime}s`
    );
  } catch (error) {
    logger.error(
      `Error creating session for event ${eventId}: ${error.message}`
    );
    res.status(500).json({ error: "Internal server error" });
  }
});

// Generate new code for a session
app.post(
  "/events/:eventId/sessions/:sessionId/generateCode",
  async (req, res) => {
    const { eventId, sessionId } = req.params;
    const { expirationTime } = req.body;

    if (!activeSessions.has(sessionId)) {
      logger.warn(
        `Attempt to generate code for non-existent session: ${sessionId}`
      );
      return res.status(404).json({ error: "Session not found" });
    }

    try {
      // Delete the old code immediately
      await redis.del(`event:${eventId}:session:${sessionId}`);

      const newCode = generateCode();

      // Set the new code with expiration
      await redis.set(
        `event:${eventId}:session:${sessionId}`,
        newCode,
        "EX",
        expirationTime
      );

      logger.success(
        `New code generated for event ${eventId}, session ${sessionId}: ${newCode}, Expiration: ${expirationTime}s`
      );
      res.json({ code: newCode });
    } catch (error) {
      logger.error(
        `Error generating new code for event ${eventId}, session ${sessionId}: ${error.message}`
      );
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Validate access code
app.post("/validate-code", async (req, res) => {
  const { code } = req.body;

  if (!code) {
    logger.warn("Attempt to validate without code");
    return res.status(400).json({ error: "Access code is required" });
  }

  logger.info(`Attempting to validate code: ${code}`);

  try {
    // Check all active sessions for matching code
    for (const [sessionId, session] of activeSessions) {
      const storedCode = await redis.get(
        `event:${session.eventId}:session:${sessionId}`
      );

      if (storedCode === code) {
        logger.success(
          `Valid code found for event ${session.eventId}, session ${sessionId}`
        );
        return res.json({
          valid: true,
          eventId: session.eventId,
          sessionId: sessionId,
          eventSessionId: session.eventSessionId,
        });
      }
    }

    // If we get here, no matching code was found
    logger.warn("No matching code found");
    return res.status(400).json({ error: "Invalid or expired access code" });
  } catch (error) {
    logger.error(`Error validating code: ${error.message}`);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Stop a session
app.post("/events/:eventId/sessions/:sessionId/stop", async (req, res) => {
  const { eventId, sessionId } = req.params;

  if (activeSessions.has(sessionId)) {
    activeSessions.delete(sessionId);
    await redis.del(`event:${eventId}:session:${sessionId}`);
    logger.success(`Session stopped for event ${eventId}: ${sessionId}`);
    res.json({ message: "Session stopped successfully" });
  } else {
    logger.warn(
      `Attempt to stop non-existent session for event ${eventId}: ${sessionId}`
    );
    res.status(404).json({ error: "Session not found" });
  }
});

// Get all active sessions
app.get("/active-sessions", (req, res) => {
  const sessionsArray = Array.from(activeSessions, ([sessionId, session]) => ({
    sessionId,
    ...session,
  }));
  res.json(sessionsArray);
});

// Track active sessions count
setInterval(async () => {
  logger.info(`Active sessions: ${activeSessions.size}`);
}, 30000); // Log every 30 seconds

app.listen(port, () => {
  logger.success(`Server running on port ${port}`);
  logger.info("=================================");
  logger.info("🚀 Redis Counter Server Started");
  logger.info("=================================");
});

// Handle graceful shutdown
process.on("SIGTERM", () => {
  logger.warn("Received SIGTERM. Performing graceful shutdown...");
  activeSessions.forEach((session, sessionId) => {
    redis.del(`event:${session.eventId}:session:${sessionId}`);
  });
  redis.disconnect();
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.warn("Received SIGINT. Performing graceful shutdown...");
  activeSessions.forEach((session, sessionId) => {
    redis.del(`event:${session.eventId}:session:${sessionId}`);
  });
  redis.disconnect();
  process.exit(0);
});
