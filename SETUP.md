# 🚀 NIM Proxy Setup Guide

## ⚡ Quick Start

### 1. **Install Dependencies**
```bash
npm install
```

### 2. **Set Environment Variables**

Create a `.env` file in the root directory with these **REQUIRED** variables:

```bash
# REQUIRED - Get from https://build.nvidia.com/
NIM_API_KEY=nvapi-your-actual-key-here

# REQUIRED - Client authentication token (your proxy password)
# Generate one: openssl rand -hex 32
CLIENT_AUTH_KEY=your-secret-token-here
```

**Optional variables** (with defaults):
```bash
PORT=3000
NIM_API_BASE=https://integrate.api.nvidia.com/v1
SHOW_REASONING=false
ENABLE_THINKING_MODE=false
SKIP_VALIDATION=false
DISCORD_WEBHOOK_URL=
```

See `.env.example` for full documentation.

### 3. **Start the Server**
```bash
node server.js
```

You should see:
```
[PROXY] Hybrid proxy running on port 3000
[PROXY] Max tokens limit: 65536
[VALIDATION] Checking model availability via /v1/models...
```

---

## 🔧 Environment Variables Explained

### **Required Variables**

| Variable | Value | Where to Get |
|----------|-------|-------------|
| `NIM_API_KEY` | Your NVIDIA API key | [build.nvidia.com](https://build.nvidia.com/) |
| `CLIENT_AUTH_KEY` | Secret token for client auth | Generate: `openssl rand -hex 32` |

### **Optional Variables**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NIM_API_BASE` | `https://integrate.api.nvidia.com/v1` | NVIDIA NIM endpoint |
| `SHOW_REASONING` | `false` | Show thinking/reasoning in responses |
| `ENABLE_THINKING_MODE` | `false` | Enable advanced reasoning models |
| `SKIP_VALIDATION` | `false` | Skip model validation at startup |
| `DISCORD_WEBHOOK_URL` | (empty) | Discord alerts for validation errors |

---

## 🔐 How to Generate `CLIENT_AUTH_KEY`

### **Linux/Mac:**
```bash
openssl rand -hex 32
```

### **Windows (PowerShell):**
```powershell
[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

### **Node.js:**
```javascript
require('crypto').randomBytes(32).toString('hex')
```

**Example output:**
```
a7f3c9e2b1d4f6a8c5e7g9h1j2k3l4m5n6o7p8q9r0s1t2u3v4w5x6y7z8a9b
```

---

## 📝 Example `.env` File

```bash
# NVIDIA API
NIM_API_KEY=nvapi-dXNlcl9pZDo1MjQ2NzU5MDAwMDAwMDAwMDAwMDAwMDA=

# Proxy Authentication
CLIENT_AUTH_KEY=a7f3c9e2b1d4f6a8c5e7g9h1j2k3l4m5n6o7p8q9r0s1t2u3v4w5x6y7z8a9b

# Optional Settings
PORT=3000
SHOW_REASONING=true
ENABLE_THINKING_MODE=true
SKIP_VALIDATION=false
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/1234567890/aBcDeFgHiJkLmNoPqRsTuVwXyZ
```

---

## ✅ Test Your Setup

### **1. Health Check (No Auth Required)**
```bash
curl http://localhost:3000/health
```

**Expected Response:**
```json
{"status":"ok","version":"2.2.0"}
```

### **2. List Models (No Auth Required)**
```bash
curl http://localhost:3000/v1/models
```

**Expected Response:**
```json
{
  "object": "list",
  "data": [
    {"id": "gpt-3.5-turbo", "object": "model", "owned_by": "nim-proxy"},
    {"id": "gpt-4", "object": "model", "owned_by": "nim-proxy"},
    ...
  ]
}
```

### **3. Chat Completion (With Auth)**
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_CLIENT_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

**If you get 403 error:**
```json
{"error":{"message":"Forbidden: Invalid or missing authentication","type":"authentication_error","code":403}}
```

**Solution:** Check your `CLIENT_AUTH_KEY` is set and matches in the request.

---

## 🎯 Using with OpenAI Clients

### **Python (OpenAI SDK)**
```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_CLIENT_AUTH_KEY",
    base_url="http://localhost:3000/v1"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### **JavaScript/Node.js**
```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "YOUR_CLIENT_AUTH_KEY",
  baseURL: "http://localhost:3000/v1"
});

const response = await client.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Hello!" }]
});

console.log(response.choices[0].message.content);
```

### **cURL (Raw HTTP)**
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_CLIENT_AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "stream": false
  }'
```

---

## 🐛 Troubleshooting

### **Problem: `NIM_API_KEY is required` error**
```
[FATAL] NIM_API_KEY is required. Get one at https://build.nvidia.com/
```

**Solution:**
1. Go to [build.nvidia.com](https://build.nvidia.com/)
2. Get your API key
3. Add to `.env`: `NIM_API_KEY=nvapi-xxxxx`

---

### **Problem: `403 Forbidden: Invalid or missing authentication`**
```json
{"error":{"message":"Forbidden: Invalid or missing authentication","type":"authentication_error","code":403}}
```

**Solutions:**
1. Set `CLIENT_AUTH_KEY` in `.env`
2. Send correct header in request:
   ```bash
   Authorization: Bearer YOUR_CLIENT_AUTH_KEY
   ```
3. Make sure token is after `Bearer ` (with space)

---

### **Problem: `All models failed`**
```
[FALLBACK] Model failed: ...
```

**Solutions:**
1. Check your `NIM_API_KEY` is valid
2. Check `NIM_API_BASE` URL is correct
3. Verify you have access to requested model
4. Set `SKIP_VALIDATION=true` to bypass startup checks

---

### **Problem: Connection timeout**
```
Error: connect ECONNREFUSED 127.0.0.1:3000
```

**Solutions:**
1. Server not running: `node server.js`
2. Wrong port: Check `PORT` in `.env`
3. Wrong URL: Use correct host/port in client

---

## 📋 Available Models

| Alias | Backend Model |
|-------|---------------|
| `gpt-3.5-turbo` | nvidia/nemotron-3-super-120b-a12b |
| `gpt-4` | nvidia/nemotron-3-ultra-550b-a55b |
| `gpt-4o` | deepseek-ai/deepseek-v4-pro |
| `gpt-4-flash` | deepseek-ai/deepseek-v4-flash |
| `glm-5.2` | z-ai/glm-5.2 |
| `mistral` | mistralai/mistral-large-3-675b-instruct-2512 |
| `mistral-turbo` | mistralai/mistral-medium-3.5-128b |
| `gemini-pro` | nvidia/llama-3.3-nemotron-super-49b-v1.5 |
| `gemini-turbo` | meta/llama-3.3-70b-instruct |

See `/v1/models` endpoint for full list.

---

## 🔄 Advanced Features

### **Enable Reasoning Display**
```bash
SHOW_REASONING=true
ENABLE_THINKING_MODE=true
```

Then in your client, add header for inline format:
```bash
x-reasoning-format: inline
```

### **Discord Alerts**
Set `DISCORD_WEBHOOK_URL` to get alerts when model validation fails at startup:
```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/WEBHOOK_ID/TOKEN
```

### **Skip Validation**
If your NIM provider doesn't support `/v1/models`:
```bash
SKIP_VALIDATION=true
```

---

## 📚 API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | ❌ No | Health check |
| `GET` | `/v1/models` | ❌ No | List models |
| `POST` | `/v1/chat/completions` | ✅ Yes | Chat completions |

---

## 🚀 Deployment

### **Docker**
```bash
docker build -t nim-proxy .
docker run -d \
  -e NIM_API_KEY=nvapi-xxx \
  -e CLIENT_AUTH_KEY=your-secret \
  -p 3000:3000 \
  nim-proxy
```

### **PM2 (Node Process Manager)**
```bash
npm install -g pm2
pm2 start server.js --name "nim-proxy"
pm2 save
pm2 startup
```

---

## ❓ Need Help?

- 📖 Check logs: `node server.js` shows real-time errors
- 🔗 Visit: [build.nvidia.com](https://build.nvidia.com/)
- 📨 Create an issue on GitHub

---

**Happy proxying! 🎉**
