// WhatsApp Bot (Baileys) + n8n — server.js
// Requisitos: Node 18+, npm
// Instalação:
//   npm init -y
//   npm i express @whiskeysockets/baileys pino
// Execução:
//   node server.js

import express from "express";
import pino from "pino";
import qrcode from "qrcode-terminal";
import multer from "multer";
import fs from "fs";
import {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
} from "@whiskeysockets/baileys";

const PORT = process.env.PORT || 3000;

let sock;
let isReady = false;

async function startBot() {
  try {
    const logger = pino({ level: "silent" });
    const { state, saveCreds } = await useMultiFileAuthState("./auth");

    sock = makeWASocket({
      logger,
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: Browsers.appropriate("Desktop"),
      syncFullHistory: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("🔵 QR Code gerado! Escaneie com seu WhatsApp:");
        console.log("");
        qrcode.generate(qr, { small: true });
        console.log("");
        console.log("👆 Escaneie o QR Code acima com seu WhatsApp");
      }

      if (connection === "open") {
        isReady = true;
        console.log("✅ WhatsApp conectado com sucesso!");
      } else if (connection === "close") {
        isReady = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (!loggedOut) {
          startBot().catch((err) => console.error("Erro ao reconectar", err));
        } else {
          console.log(
            "❌ Sessão desconectada. Remova a pasta ./auth para reautenticar."
          );
        }
      }
    });
  } catch (error) {
    console.error("Erro ao criar WhatsApp socket:", error);
    return;
  }

  // Exemplo simples de comando (!ping)
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages && m.messages[0];
    if (!msg?.message || msg.key.fromMe) return;
    const remoteJid = msg.key.remoteJid;
    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (text && text.toLowerCase() === "!ping") {
      await sock.sendMessage(remoteJid, { text: "pong" });
    }
  });

  return sock;
}

// Helpers
async function listGroups() {
  const participating = await sock.groupFetchAllParticipating();
  return Object.values(participating).map((g) => ({
    id: g.id,
    name: g.subject,
  }));
}

async function findGroupIdByName(name) {
  const groups = await listGroups();
  const found = groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
  return found?.id;
}

// Configuração do multer para upload de imagens
const upload = multer({
  dest: "./uploads/",
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(
        new Error("Apenas imagens são permitidas (jpeg, jpg, png, gif, webp)")
      );
    }
  },
});

// HTTP API para o n8n
const app = express();
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: isReady });
});

app.get("/groups", async (req, res) => {
  try {
    if (!isReady)
      return res.status(503).json({ error: "WhatsApp não está pronto" });
    const groups = await listGroups();
    res.json(groups);
  } catch (e) {
    res.status(500).json({ error: e?.message || "Erro" });
  }
});

app.post("/send-group", upload.single("image"), async (req, res) => {
  try {
    if (!isReady)
      return res.status(503).json({ error: "WhatsApp não está pronto" });

    const { groupId, groupName, message } = req.body;
    const imageFile = req.file;

    // Validar se tem pelo menos mensagem ou imagem
    if (!message && !imageFile) {
      return res.status(400).json({ error: "message ou image é obrigatório" });
    }

    let jid = groupId;
    if (!jid && groupName) {
      jid = await findGroupIdByName(groupName);
    }
    if (!jid || !jid.endsWith("@g.us")) {
      return res
        .status(404)
        .json({ error: "Grupo não encontrado. Use /groups para listar." });
    }

    let result;

    if (imageFile) {
      // Enviar imagem
      const imageBuffer = fs.readFileSync(imageFile.path);

      const messageContent = {
        image: imageBuffer,
        mimetype: imageFile.mimetype,
        fileName: imageFile.originalname,
      };

      // Adicionar caption se houver mensagem
      if (message) {
        messageContent.caption = message;
      }

      result = await sock.sendMessage(jid, messageContent);

      // Limpar arquivo temporário
      fs.unlinkSync(imageFile.path);
    } else {
      // Enviar apenas texto
      result = await sock.sendMessage(jid, { text: message });
    }

    res.json({ ok: true, id: result?.key?.id || null });
  } catch (e) {
    // Limpar arquivo em caso de erro
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error("Erro ao limpar arquivo:", cleanupError);
      }
    }
    res.status(500).json({ error: e?.message || "Erro" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});

startBot().catch((err) => console.error("Falha ao iniciar bot", err));
