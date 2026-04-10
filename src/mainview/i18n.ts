export type { Translations } from "./i18n/types";

import type { Translations } from "./i18n/types";
import it from "./i18n/it";
import en from "./i18n/en";
import es from "./i18n/es";
import fr from "./i18n/fr";
import de from "./i18n/de";
import pt from "./i18n/pt";
import ja from "./i18n/ja";

const translations: Record<string, Translations> = { it, en, es, fr, de, pt, ja };

let currentLang: string = "it";
let currentTranslations: Translations = it;

export function detectSystemLanguage(): string {
	const lang = (navigator.language || "en").split("-")[0]!.toLowerCase();
	return translations[lang] ? lang : "en";
}

export function setLanguage(lang: string) {
	currentLang = translations[lang] ? lang : "en";
	currentTranslations = translations[currentLang]!;
	localStorage.setItem("ingombro-lang", currentLang);
}

export function getLanguage(): string {
	return currentLang;
}

export function t(): Translations {
	return currentTranslations;
}

export function initI18n() {
	const saved = localStorage.getItem("ingombro-lang");
	if (saved && translations[saved]) {
		currentLang = saved;
	} else {
		currentLang = detectSystemLanguage();
	}
	currentTranslations = translations[currentLang]!;
}

export function getAvailableLanguages(): { code: string; label: string }[] {
	return [
		{ code: "it", label: "Italiano" },
		{ code: "en", label: "English" },
		{ code: "es", label: "Español" },
		{ code: "fr", label: "Français" },
		{ code: "de", label: "Deutsch" },
		{ code: "pt", label: "Português" },
		{ code: "ja", label: "日本語" },
	];
}
