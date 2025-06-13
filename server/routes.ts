import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(app: Express): Promise<Server> {
  // API config endpoint to expose environment secrets
  app.get("/api/config", (req, res) => {
    res.json({
      DID_API_KEY: process.env.DID_API_KEY,
      GROQ_API_KEY: process.env.GROQ_API_KEY,
      ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY
    });
  });

  const httpServer = createServer(app);

  return httpServer;
}
