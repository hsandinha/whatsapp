(function initAppConfig() {
  // Para frontend separado:
  // - APP_BASE_URL = URL do frontend no Vercel
  // - API_BASE_URL = URL pública do backend via Cloudflare Tunnel
  // Se deixar vazio, o app usa a própria origem atual.
  const manualConfig = {
    APP_BASE_URL: "https://whatsappphebert.vercel.app",
    API_BASE_URL: "https://api.hebertsandinha.com",
  };

  // Exemplo:
  // const manualConfig = {
  //   APP_BASE_URL: "https://seu-frontend.vercel.app",
  //   API_BASE_URL: "https://seu-backend.trycloudflare.com",
  // };

  // Também é possível sobrescrever via window.__APP_CONFIG__ antes deste script.
  const defaults = {
    SUPABASE_URL: "https://piigfztyhymxrcrpavwq.supabase.co",
    SUPABASE_ANON_KEY:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpaWdmenR5aHlteHJjcnBhdndxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTkzNzQsImV4cCI6MjA4ODU3NTM3NH0.-nxRKReeM8blNKqw5kIEIHqolxRdOx800zwsmREOq4Y",
  };

  const runtime = {
    ...manualConfig,
    ...window.__APP_CONFIG__,
  };

  function normalizeBaseUrl(value, fallback) {
    const baseUrl = String(value || fallback || "").trim();
    return baseUrl.replace(/\/+$/, "");
  }

  function isAbsoluteUrl(value) {
    return /^(?:[a-z]+:)?\/\//i.test(value);
  }

  function joinUrl(baseUrl, resourcePath) {
    if (!resourcePath) return baseUrl;
    if (
      isAbsoluteUrl(resourcePath) ||
      resourcePath.startsWith("data:") ||
      resourcePath.startsWith("blob:")
    ) {
      return resourcePath;
    }

    if (!baseUrl) return resourcePath;
    if (resourcePath === "/") return `${baseUrl}/`;

    return `${baseUrl}${resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`}`;
  }

  const appBaseUrl = normalizeBaseUrl(runtime.APP_BASE_URL, window.location.origin);
  const apiBaseUrl = normalizeBaseUrl(
    runtime.API_BASE_URL || runtime.BACKEND_BASE_URL,
    window.location.origin
  );

  function resolveAppUrl(resourcePath = "/") {
    return joinUrl(appBaseUrl, resourcePath);
  }

  function resolveBackendUrl(resourcePath = "/") {
    return joinUrl(apiBaseUrl, resourcePath);
  }

  function resolveBackendAssetUrl(resourcePath = "") {
    if (!resourcePath) return "";
    if (!resourcePath.startsWith("/")) return resourcePath;
    return resolveBackendUrl(resourcePath);
  }

  function applyConfiguredLinks(root = document) {
    root.querySelectorAll("[data-app-path]").forEach((link) => {
      link.setAttribute("href", resolveAppUrl(link.getAttribute("data-app-path") || "/"));
    });
  }

  window.APP_CONFIG = {
    ...defaults,
    ...runtime,
    APP_BASE_URL: appBaseUrl,
    API_BASE_URL: apiBaseUrl,
    resolveAppUrl,
    resolveBackendUrl,
    resolveBackendAssetUrl,
    applyConfiguredLinks,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => applyConfiguredLinks());
  } else {
    applyConfiguredLinks();
  }
})();
