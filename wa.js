// wa.js
const axios = require('axios');

const GRAPH = 'https://graph.facebook.com/v20.0';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WA_TOKEN = process.env.WHATSAPP_TOKEN;

function waPost(path, payload) {
  return axios.post(`${GRAPH}/${path}`, payload, {
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' }
  });
}

async function sendText(to, text) {
  return waPost(`${PHONE_NUMBER_ID}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text }
  });
}

async function sendButtons(to, bodyText, buttons) {
  // buttons: [{ id:'save_item', title:'Save' }, ...]
  return waPost(`${PHONE_NUMBER_ID}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText.slice(0,1024) },
      action: {
        buttons: buttons.map(b => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0,20) }
        }))
      }
    }
  });
}

async function sendLocationList(to, locations) {
  const rows = locations.slice(0,10).map((loc, i) => ({
    id: `loc_${i}_${loc}`,
    title: loc
  }));
  return waPost(`${PHONE_NUMBER_ID}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: 'Choose a location' },
      action: { button: 'Pick', sections: [{ title: 'Recent Locations', rows }] }
    }
  });
}

async function downloadMediaById(mediaId) {
  // 1) get temporary URL for the media
  const meta = await axios.get(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` }
  });
  const url = meta.data.url;

  // 2) download the bytes
  const img = await axios.get(url, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` },
    responseType: 'arraybuffer'
  });
  return Buffer.from(img.data);
}

module.exports = { sendText, sendButtons, sendLocationList, downloadMediaById };
