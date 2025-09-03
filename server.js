const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json()); // built-in body parser

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ---- Startup checks ----
if (!VERIFY_TOKEN || !WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
  console.warn('[WARN] Missing one or more env vars:',
    { VERIFY_TOKEN: !!VERIFY_TOKEN, WHATSAPP_TOKEN: !!WHATSAPP_TOKEN, PHONE_NUMBER_ID: !!PHONE_NUMBER_ID }
  );
}

// (Optional) Health check
app.get('/', (req, res) => res.status(200).send('OK'));

// 1) Webhook verification (Meta sends hub.challenge)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[VERIFY] Success');
    return res.status(200).send(challenge);
  }

  console.log('[VERIFY] Failed:', { mode, token });
  return res.sendStatus(403);
});

// 2) Receive messages and reply
app.post('/webhook', async (req, res) => {
  // Log every webhook so you can see what Meta sends
  console.log('>>> Incoming Webhook:', JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value  = change?.value;

    // Check if it's a message event
    const message = value?.messages?.[0];
    const from = message?.from;                 // user phone in international format
    const text  = message?.text?.body;          // only present for text messages

    // You may also get status updates (delivery/read)
    // const statuses = value?.statuses;

    if (from) {
      let reply;

      if (text) {
        const lower = text.trim().toLowerCase();
        if (lower === 'hi' || lower === 'hello') {
          reply = `Hello! 👋 Send "help" to see what I can do.`;
        } else if (lower === 'help') {
          reply = [
            `Try:`,
            `• ac filter?  → I’ll show the value once we store it (Day-2)`,
            `• set key value → Coming Day-2 (store household data)`,
            `For now, I echo your message.`
          ].join('\n');
        } else {
          reply = `You said: "${text}"`;
        }
      } else {
        // Not a text message
        reply = `I received your message 👍 (non-text). Try sending a text like "hi" or "help".`;
      }

      await sendText(from, reply);
    }

    res.sendStatus(200);
  } catch (e) {
    // Print helpful error information if WhatsApp returns one
    if (e?.response?.data) {
      console.error('webhook error (API):', JSON.stringify(e.response.data, null, 2));
    } else {
      console.error('webhook error:', e.message);
    }
    res.sendStatus(200);
  }
});

async function sendText(to, message) {
  const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;
  return axios.post(
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
