// server.js - OpenAI to NVIDIA NIM API Proxy
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// --- EARLY LOGGING & PRE-BODY BYTE COUNTER MIDDLEWARE ---
// Runs BEFORE body-parsers so we see Content-Length and can return a
// friendly 413 if a client is sending a huge payload. It also listens
// to the raw incoming stream to catch chunked requests where Content-Length
// is missing.
app.use((req, res, next) => {
  const lenHeader = req.headers['content-length'];
  const contentLength = lenHeader ? parseInt(lenHeader, 10) : NaN;
  console.log('Incoming', req.method, req.path, 'Content-Length=', contentLength, 'Content-Type=', req.headers['content-type']);

  // Configure a conservative default max size (bytes). You can override with env MAX_REQUEST_BYTES.
  const MAX_BYTES = process.env.MAX_REQUEST_BYTES ? parseInt(process.env.MAX_REQUEST_BYTES, 10) : 50 * 1024 * 1024; // 50 MB

  if (!isNaN(contentLength) && contentLength > MAX_BYTES) {
    console.log('Content-Length too large, rejecting early:', contentLength);
    return res.status(413).json({
      error: {
        message: `Payload too large. Content-Length = ${contentLength}. Max allowed = ${MAX_BYTES} bytes. If you need to upload files, upload to object storage (S3/R2) and send a URL instead.`,
        type: 'invalid_request_error',
        code: 413
      }
    });
  }

  // For chunked requests (no Content-Length), listen to the stream and count bytes.
  let received = 0;
  let exceeded = false;

  function onData(chunk) {
    received += chunk.length;
    if (!exceeded && received > MAX_BYTES) {
      exceeded = true;
      console.log('Pre-body limit exceeded', received);
      try {
        // Send friendly 413 and close the connection.
        res.status(413).json({
          error: {
            message: `Payload too large. Received ${received} bytes which exceeds the allowed ${MAX_BYTES} bytes.`,
            type: 'invalid_request_error',
            code: 413
          }
        });
      } catch (e) {
        console.error('Error sending 413 after pre-body exceeded:', e.message);
      }
      // Destroy the request to stop further processing and free memory.
      try { req.destroy(); } catch (e) {}
    }
  }

  function onEnd() {
    if (!exceeded) console.log('Pre-body total bytes:', received);
    // clean up listeners (defensive)
    req.removeListener('data', onData);
    req.removeListener('end', onEnd);
  }

  req.on('data', onData);
  req.on('end', onEnd);

  // continue to next middleware (body-parser will still run unless we destroyed the req above)
  next();
});

// Middleware
app.use(cors());
// Increase express.json limit (app-level). Note: platform front-proxies (Railway) may still reject larger requests before they reach the app.
// Set to 50mb per your request.
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// NVIDIA NIM API configuration
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// 🔥 REASONING DISPLAY TOGGLE - Shows/hides reasoning in output
const SHOW_REASONING = true; // Set to true to show reasoning with <think> tags

// 🔥 THINKING MODE TOGGLE - Enables thinking for specific models that support it
const ENABLE_THINKING_MODE = true; // Set to true to enable chat_template_kwargs thinking parameter

// Model mapping (adjust based on available NIM models)
const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4': 'qwen/qwen3-coder-480b-a35b-instruct',
  'gpt-4-turbo': 'moonshotai/kimi-k2-instruct-0905',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'claude-3-opus': 'openai/gpt-oss-120b',
  'claude-3-sonnet': 'openai/gpt-oss-20b',
  'gemini-pro': 'qwen/qwen3-next-80b-a3b-thinking',
  'glm-5.2': 'z-ai/glm-5.2'
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'OpenAI to NVIDIA NIM Proxy', 
    reasoning_display: SHOW_REASONING,
    thinking_mode: ENABLE_THINKING_MODE
  });
});

// List models endpoint (OpenAI compatible)
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model,
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim-proxy'
  }));
  
  res.json({
    object: 'list',
    data: models
  });
});

// Chat completions endpoint (main proxy)
app.post('/v1/chat/completions', async (req, res) => {
  try {
    // Defensive: ensure body exists
    const body = req.body || {};
    const { model, temperature, max_tokens, stream } = body;

    // Trim messages to last N to avoid large payloads coming from clients
    const KEEP_MESSAGES = process.env.KEEP_MESSAGES ? parseInt(process.env.KEEP_MESSAGES, 10) : 6; // default 6
    let messages = (body.messages || []).slice(-KEEP_MESSAGES);

    // Truncate very long individual messages to avoid huge single fields (chars)
    const MAX_MESSAGE_CHARS = process.env.MAX_MESSAGE_CHARS ? parseInt(process.env.MAX_MESSAGE_CHARS, 10) : 20000; // 20k chars
    messages = messages.map(m => {
      if (!m || typeof m.content !== 'string') return m;
      if (m.content.length > MAX_MESSAGE_CHARS) {
        return { ...m, content: m.content.slice(0, MAX_MESSAGE_CHARS) + '\n\n...[truncated]' };
      }
      return m;
    });

    // Smart model selection with fallback
    let nimModel = MODEL_MAPPING[model];
    if (!nimModel && typeof model === 'string') {
      try {
        await axios.post(`${NIM_API_BASE}/chat/completions`, {
          model: model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1
        }, {
          headers: { 'Authorization': `Bearer ${NIM_API_KEY}`, 'Content-Type': 'application/json' },
          validateStatus: (status) => status < 500
        }).then(res => {
          if (res.status >= 200 && res.status < 300) {
            nimModel = model;
          }
        });
      } catch (e) {}
      
      if (!nimModel) {
        const modelLower = String(model || '').toLowerCase();
        if (modelLower.includes('gpt-4') || modelLower.includes('claude-opus') || modelLower.includes('405b')) {
          nimModel = 'meta/llama-3.1-405b-instruct';
        } else if (modelLower.includes('claude') || modelLower.includes('gemini') || modelLower.includes('70b')) {
          nimModel = 'meta/llama-3.1-70b-instruct';
        } else {
          nimModel = 'meta/llama-3.1-8b-instruct';
        }
      }
    }
    
    // Transform OpenAI request to NIM format
    const nimRequest = {
      model: nimModel,
      messages: messages,
      temperature: temperature || 0.6,
      max_tokens: max_tokens || 9024,
      extra_body: ENABLE_THINKING_MODE ? { chat_template_kwargs: { thinking: true } } : undefined,
      stream: stream || false
    };
    
    // Make request to NVIDIA NIM API
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: stream ? 'stream' : 'json',
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
    
    if (stream) {
      // Handle streaming response with reasoning
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      let buffer = '';
      let reasoningStarted = false;
      
      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        lines.forEach(line => {
          if (line.startsWith('data: ')) {
            if (line.includes('[DONE]')) {
              res.write(line + '\n');
              return;
            }
            
            try {
              const data = JSON.parse(line.slice(6));
              if (data.choices?.[0]?.delta) {
                const reasoning = data.choices[0].delta.reasoning_content;
                const content = data.choices[0].delta.content;
                
                if (SHOW_REASONING) {
                  let combinedContent = '';
                  
                  if (reasoning && !reasoningStarted) {
                    combinedContent = '<think>\n' + reasoning;
                    reasoningStarted = true;
                  } else if (reasoning) {
                    combinedContent = reasoning;
                  }
                  
                  if (content && reasoningStarted) {
                    combinedContent += '</think>\n\n' + content;
                    reasoningStarted = false;
                  } else if (content) {
                    combinedContent += content;
                  }
                  
                  if (combinedContent) {
                    data.choices[0].delta.content = combinedContent;
                    delete data.choices[0].delta.reasoning_content;
                  }
                } else {
                  if (content) {
                    data.choices[0].delta.content = content;
                  } else {
                    data.choices[0].delta.content = '';
                  }
                  delete data.choices[0].delta.reasoning_content;
                }
              }
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            } catch (e) {
              res.write(line + '\n');
            }
          }
        });
      });
      
      response.data.on('end', () => res.end());
      response.data.on('error', (err) => {
        console.error('Stream error:', err);
        res.end();
      });
    } else {
      // Transform NIM response to OpenAI format with reasoning
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: response.data.choices.map(choice => {
          let fullContent = choice.message?.content || '';
          
          if (SHOW_REASONING && choice.message?.reasoning_content) {
            fullContent = '<think>\n' + choice.message.reasoning_content + '\n</think>\n\n' + fullContent;
          }
          
          return {
            index: choice.index,
            message: {
              role: choice.message.role,
              content: fullContent
            },
            finish_reason: choice.finish_reason
          };
        }),
        usage: response.data.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };
      
      res.json(openaiResponse);
    }
    
  } catch (error) {
    console.error('Proxy error:', error.message, error.response?.status, error.response?.data);
    
    // Friendly error for upstream 413
    if (error.response?.status === 413) {
      return res.status(413).json({
        error: {
          message: 'Upstream returned 413 Payload Too Large. Consider reducing request size or using object storage for large files.',
          type: 'invalid_request_error',
          code: 413
        }
      });
    }

    res.status(error.response?.status || 500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'invalid_request_error',
        code: error.response?.status || 500
      }
    });
  }
});

// Catch-all for unsupported endpoints
app.all('*', (req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint ${req.path} not found`,
      type: 'invalid_request_error',
      code: 404
    }
  });
});

// Express error handler - friendly message for body-parser's PayloadTooLargeError
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    console.error('PayloadTooLargeError caught by handler:', err.message);
    return res.status(413).json({
      error: {
        message: 'Payload too large. The server or platform rejected the request. Try sending less data or upload large files to object storage and send a URL instead.',
        type: 'invalid_request_error',
        code: 413
      }
    });
  }
  // Fall through to default Express handler
  next(err);
});

app.listen(PORT, () => {
  console.log(`OpenAI to NVIDIA NIM Proxy running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Reasoning display: ${SHOW_REASONING ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Thinking mode: ${ENABLE_THINKING_MODE ? 'ENABLED' : 'DISABLED'}`);
});
