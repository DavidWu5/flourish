import '../env.js';
import { GoogleGenAI } from '@google/genai';

const apiKey = String(process.env.GEMINI_API_KEY || '').trim();

export const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

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
  if (typeof response.text === 'string') return stripCodeFences(response.text);
  return '';
}

export async function generateText({ model, prompt, config } = {}) {
  if (!ai) return null;
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config,
    });
    return await responseText(response);
  } catch (error) {
    console.error('[Gemini] Text generation failed:', error?.message || error);
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
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        ...config,
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    });

    const text = await responseText(response);
    return text ? JSON.parse(text) : null;
  } catch (error) {
    console.error('[Gemini] Structured generation failed:', error?.message || error);
    return null;
  }
}
