export async function detectBraveBrowser(): Promise<boolean> {
  if (typeof navigator === "undefined") {
    return false;
  }

  const nav = navigator as Navigator & {
    brave?: { isBrave?: () => Promise<boolean> };
    userAgentData?: { brands?: Array<{ brand?: string }> };
  };

  if (nav.brave && typeof nav.brave.isBrave === "function") {
    try {
      const result = await nav.brave.isBrave();
      if (typeof result === "boolean") {
        return result;
      }
    } catch (error) {
      console.warn("[BrowserDetection] navigator.brave.isBrave threw", error);
    }
  }

  const brands = nav.userAgentData?.brands;
  if (brands?.some((entry) => entry.brand?.toLowerCase().includes("brave"))) {
    return true;
  }

  const userAgent = nav.userAgent?.toLowerCase?.() ?? "";
  if (userAgent.includes("brave/")) {
    return true;
  }

  const vendor = nav.vendor?.toLowerCase?.() ?? "";
  if (vendor.includes("brave")) {
    return true;
  }

  return false;
}
