export const MODEL_PRO =
  process.env.FLORISH_MODEL_PRO || 'gemini-2.5-flash-lite';
export const MODEL_FLASH =
  process.env.FLORISH_MODEL_FLASH || 'gemini-2.5-flash-lite';

export const groundedConfig = {
  tools: [{ googleSearch: {} }],
};

export function structuredConfig(responseSchema) {
  return {
    responseMimeType: 'application/json',
    responseSchema,
  };
}
