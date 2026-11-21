import { beforeEach, describe, expect, it } from "vitest";
import { dropOldBirthdate, getSettings, oldBirthdate, saveSettings } from "./settings";

describe("settings: the old birth date goes to the profile (T-113)", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the old birth date through a settings change until the profile has it", () => {
    localStorage.setItem("stratify_settings", JSON.stringify({ compactView: true, birthdate: "1990-05-06" }));
    expect(oldBirthdate()).toBe("1990-05-06");
    saveSettings({ blinkEffect: false });
    expect(oldBirthdate()).toBe("1990-05-06");
    expect(getSettings()).toMatchObject({ compactView: true, blinkEffect: false });
    dropOldBirthdate();
    expect(oldBirthdate()).toBeNull();
    expect(getSettings().compactView).toBe(true);
  });

  it("ignores an empty or broken value", () => {
    localStorage.setItem("stratify_settings", JSON.stringify({ birthdate: "" }));
    expect(oldBirthdate()).toBeNull();
    localStorage.setItem("stratify_settings", "{not json");
    expect(oldBirthdate()).toBeNull();
  });
});
