const STORAGE_KEY = "stratify_settings";

export const AI_MODELS = [
  { value: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { value: "google/gemini-flash-latest", label: "Gemini Flash (Latest)" },
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
] as const;

export type AIModelId = (typeof AI_MODELS)[number]["value"];

export interface Settings {
  aiModel: AIModelId;
  compactView: boolean;
  showProgressBars: boolean;
  blinkEffect: boolean;
}

const defaults: Settings = {
  aiModel: "google/gemini-2.0-flash",
  compactView: false,
  showProgressBars: true,
  blinkEffect: true,
};

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      aiModel: AI_MODELS.some((m) => m.value === parsed.aiModel) ? parsed.aiModel! : defaults.aiModel,
      compactView: parsed.compactView ?? defaults.compactView,
      showProgressBars: parsed.showProgressBars ?? defaults.showProgressBars,
      blinkEffect: parsed.blinkEffect ?? defaults.blinkEffect,
    };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings: Partial<Settings>): Settings {
  const current = getSettings();
  const next = { ...current, ...settings };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
