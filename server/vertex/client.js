import '../env.js';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';

const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

if (credentialsJson && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const tmpPath = '/tmp/gcp-key.json';
  fs.writeFileSync(tmpPath, credentialsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
}

const hasVertexConfig = Boolean(
  process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_LOCATION,
);
const hasApiKey = Boolean(process.env.GEMINI_API_KEY);
const REQUEST_TIMEOUT_MS = Number(process.env.FLORISH_VERTEX_TIMEOUT_MS) || 3500;

export const ai =
  hasApiKey || hasVertexConfig
    ? new GoogleGenAI(
        hasApiKey
          ? { apiKey: process.env.GEMINI_API_KEY }
          : {
              vertexai: true,
              project: process.env.GOOGLE_CLOUD_PROJECT,
              location: process.env.GOOGLE_CLOUD_LOCATION,
            },
      )
    : null;

function stripCodeFences(text) {
  return String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export async function responseText(response) {
  if (!response) return '';

  if (typeof response.text === 'function') {
    return stripCodeFences(await response.text());
  }

  if (typeof response.text === 'string') {
    return stripCodeFences(response.text);
  }

  return '';
}

async function withTimeout(promise, label) {
  let timeoutId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms.`));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function generateText({ model, prompt, config } = {}) {
  if (!ai) return null;

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: prompt,
        config,
      }),
      'Vertex text generation',
    );
    return await responseText(response);
  } catch (error) {
    console.warn('Vertex text generation failed, using fallback.', error);
    return null;
  }
}

export async function generateStructuredJson({
  model,
  prompt,
  schema,
  config = {},
} = {}) {
  if (!ai) return null;

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          ...config,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
      'Vertex structured generation',
    );

    const text = await responseText(response);
    return text ? JSON.parse(text) : null;
  } catch (error) {
    console.warn('Vertex structured generation failed, using fallback.', error);
    return null;
  }
}
