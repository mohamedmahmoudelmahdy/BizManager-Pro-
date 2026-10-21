import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import ar from "./ar.json";

const defaultLanguage = "en";
const storedLanguage = localStorage.getItem("language");
const initialLanguage = storedLanguage || defaultLanguage;

const setDocumentDirection = (lang: string) => {
  const isRtl = lang === "ar";
  document.documentElement.lang = lang;
  document.documentElement.dir = isRtl ? "rtl" : "ltr";
  document.body.dir = isRtl ? "rtl" : "ltr";
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    lng: initialLanguage,
    fallbackLng: defaultLanguage,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

setDocumentDirection(i18n.language);

i18n.on("languageChanged", (lang) => {
  localStorage.setItem("language", lang);
  setDocumentDirection(lang);
});

export default i18n;
