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
}

const defaults: Settings = {
  aiModel: "gemini-flash-latest",
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

const stored = (): Record<string, unknown> => {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};

export function saveSettings(settings: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...settings };
  // keys this version no longer knows stay (the old birth date until the profile has taken it)
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored(), ...next }));
  return next;
}

// The birth date lived here before the profile (T-113, table `profiles`): read once, dropped when the profile has it.
export function oldBirthdate() {
  const v = stored().birthdate;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
export function dropOldBirthdate() {
  try {
    const { birthdate: _, ...rest } = stored();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch {
    /* storage blocked */
  }
}
