const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// 1) Webhook verification (Meta sends hub.challenge)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// 2) Receive messages and reply
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    const from = message?.from;           // user phone (international format)
    const text = message?.text?.body;     // text body

    if (from && text) {
      // Simple commands
      const lower = text.trim().toLowerCase();
      let reply = `You said: "${text}"`;

      if (lower === 'hi' || lower === 'hello') {
        reply = `Hello! 👋 Send "help" to see what I can do.`;
      } else if (lower === 'help') {
        reply = [
          `Try:`,
          `• ac filter?  → I’ll show the value once we store it (Day-2)`,
          `• set key value → Coming Day-2 (store household data)`,
          `For now, I echo your message.`
        ].join('\n');
      }

      await sendText(from, reply);
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('webhook error', e?.response?.data || e.message);
    res.sendStatus(200);
  }
});

async function sendText(to, message) {
  // WhatsApp messages endpoint: POST /{PHONE_NUMBER_ID}/messages
  // (use the latest Graph API version; v21.0 shown as example)
  const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;
  await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to,
      text: { body: message }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

app.listen(PORT, () => console.log(`Bot running on http://localhost:${PORT}`));
