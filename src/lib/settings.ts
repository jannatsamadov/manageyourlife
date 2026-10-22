const STORAGE_KEY = "stratify_settings";

// "-latest" names follow Google's newest model
export const AI_MODELS = [
  { value: "gemini-flash-latest", label: "Gemini Flash — free" },
  { value: "gemini-flash-lite-latest", label: "Gemini Flash Lite — fastest" },
  { value: "gemini-pro-latest", label: "Gemini Pro — needs Google billing" },
] as const;

export type AIModelId = (typeof AI_MODELS)[number]["value"];

export interface Settings {
  aiModel: AIModelId;
  compactView: boolean;
  showProgressBars: boolean;
  blinkEffect: boolean;
  birthdate: string;
}

const defaults: Settings = {
  aiModel: "gemini-flash-latest",
  compactView: false,
  showProgressBars: true,
  blinkEffect: true,
  birthdate: "",
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
      birthdate: parsed.birthdate ?? defaults.birthdate,
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
