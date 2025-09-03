// WhatsApp Bot com Z-API + n8n — server.js
// Requisitos: Node 18+, npm
// Instalação:
//   npm init -y
//   npm i express multer node-fetch

import dotenv from "dotenv";
dotenv.config();

import express, { response } from "express";
import multer from "multer";
import fs from "fs";
import fetch from "node-fetch";

const PORT = process.env.PORT || 3000;

// coloque os dados da sua instância Z-API aqui
const ZAPI_INSTANCE_ID = process.env.ZAPI_INSTANCE_ID; // ID da instância
const ZAPI_INSTANCE_TOKEN = process.env.ZAPI_INSTANCE_TOKEN; // Token da instância
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN;

// Log environment variables to check if they are being loaded
console.log("Environment variables check:");
console.log("ZAPI_INSTANCE_ID:", ZAPI_INSTANCE_ID ? "✓ Loaded" : "✗ Missing");
console.log(
  "ZAPI_INSTANCE_TOKEN:",
  ZAPI_INSTANCE_TOKEN ? "✓ Loaded" : "✗ Missing"
);
console.log("ZAPI_CLIENT_TOKEN:", ZAPI_CLIENT_TOKEN ? "✓ Loaded" : "✗ Missing");

// Configuração do multer para upload de imagens
const upload = multer({
  dest: "./uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) cb(null, true);
    else cb(new Error("Apenas imagens são permitidas"));
  },
});

// HTTP API para o n8n
const app = express();
app.use(express.json());

app.get("/groups", async (req, res) => {
  try {
    const response = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_INSTANCE_TOKEN}/groups`,
      {
        method: "GET",
        headers: {
          "client-token": `${ZAPI_CLIENT_TOKEN}`,
        },
      }
    );
    const data = await response.json();
    res.json({ ok: true, response: data });
  } catch (error) {
    console.log("Error fetching groups:", error.message);
    res.status(500).json({ error: "Failed to fetch groups" });
  }
});

// Enviar mensagem de texto ou imagem para grupo
app.post("/send-message", upload.single("image"), async (req, res) => {
  try {
    const { groupId, message } = req.body;
    const imageFile = req.file;

    if (!groupId) {
      return res.status(400).json({ error: "groupId é obrigatório" });
    }

    let response;

    if (imageFile) {
      // Enviar imagem com legenda
      const imageBuffer = fs.readFileSync(imageFile.path);
      const base64Image = imageBuffer.toString("base64");
      const mimeType = imageFile.mimetype;
      const imageDataUri = `data:${mimeType};base64,${base64Image}`;

      response = await fetch(
        `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_INSTANCE_TOKEN}/send-image`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "client-token": `${ZAPI_CLIENT_TOKEN}`,
          },
          body: JSON.stringify({
            phone: groupId,
            image: imageDataUri,
            caption: message || "",
          }),
        }
      );

      fs.unlinkSync(imageFile.path);
    } else {
      // Enviar só texto
      response = await fetch(
        `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_INSTANCE_TOKEN}/send-text`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "client-token": `${ZAPI_CLIENT_TOKEN}`,
          },
          body: JSON.stringify({
            phone: groupId,
            message,
          }),
        }
      );
    }

    const data = await response.json();
    res.json({ ok: true, response: data });
  } catch (e) {
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {}
    }
    res.status(500).json({ error: e.message || "Erro" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
